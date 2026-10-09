import { randomUUID } from "node:crypto";
import {
  advertiserDomainEvents, advertiserInvoiceLines, advertiserInvoices, advertiserPaymentAllocations, advertiserPayments, advertiserProposalAcceptances, advertiserProviderSyncReferences, advertiserTerms, advertiserTaxRates,
  advertisers, artworkRequirements, artworkVersions, auditEvents, commercialBookingItems, commercialBookings, commercialProductionRequests, commercialProposalItems, commercialProposals, createDb, fixtureIds,
  inventoryReservations, inventorySlots, organisations
} from "@raring2go/db";
import type { AccountingProvider } from "@raring2go/finance";
import { and, eq, inArray, like, sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AccountingNotConfiguredError, accountingProvider } from "./accounting-provider";
import { ACCOUNTING_MAX_ATTEMPTS, taxRateFor } from "@raring2go/advertising";
import { accountingBackoffMs, createSyncAccountingHandler } from "./accounting-jobs";
import { createAdvertiserRecord } from "./advertising-mutations";
import { allocatePaymentRecord, bookProposalRecord, createInvoiceRecord, createProposalRecord, issueInvoiceRecord, recordPaymentRecord, sendProposalRecord } from "./advertising-sales";
import { readFinanceConfig, retryAccountingSync, setTaxRateRecord } from "./finance-config-runtime";
import { withFinanceGuardsDisabled } from "./finance-test-support";

const handle = (provider: AccountingProvider, now = new Date()) =>
  (createSyncAccountingHandler(() => provider) as unknown as { handle: (context: { now: () => Date }) => Promise<{ claimed: number; synced: number; failed: number }> }).handle({ now: () => now });

describe("accounting provider and backoff", () => {
  it("fails closed in production and backs off exponentially to a ceiling", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(accountingProvider().pushInvoice({ id: "i", invoiceNumber: "N", issuerOrganisationId: "o", customerOrganisationId: "c", totalMinor: 1, currency: "GBP" })).rejects.toBeInstanceOf(AccountingNotConfiguredError);
    vi.unstubAllEnvs();
    expect([1, 2, 3].map(accountingBackoffMs)).toEqual([300_000, 600_000, 1_200_000]);
    expect(accountingBackoffMs(30)).toBe(6 * 3_600_000);
  });
});

/** Real database: money rules the database itself enforces, accounting hand-off, and tax configuration. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("finance wiring (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const product = fixtureIds.commercialProducts.fullPageAdvert;
  const advertiserIds: string[] = [];
  const organisationIds: string[] = [];
  const slotIds: string[] = [];
  const codes: string[] = [];
  let invoiceId = "";
  let creditless = "";
  let paymentId = "";
  let proposalId = "";
  const ok: AccountingProvider = { pushInvoice: async (invoice) => ({ providerKey: "t", providerEntityId: `ext-${invoice.idempotencyKey}`, status: "synced" }), pushCreditNote: async () => ({ providerKey: "t", providerEntityId: "c", status: "synced" }) };
  const down: AccountingProvider = { pushInvoice: async () => { throw new Error("accounting is down"); }, pushCreditNote: async () => { throw new Error("accounting is down"); } };
  const refFor = async (entityId: string) => (await db.select().from(advertiserProviderSyncReferences).where(eq(advertiserProviderSyncReferences.entityId, entityId)))[0];
  const rejects = (statement: ReturnType<typeof dsql>) => expect(db.execute(statement)).rejects.toThrow();

  beforeAll(async () => {
    // Leftovers from earlier runs whose invoices are gone would only fail forever; clear them so the job runs on a clean queue.
    await db.execute(dsql`delete from advertiser_provider_sync_references where provider_type = 'accounting' and entity_type = 'advertiser_invoice' and entity_id not in (select id from advertiser_invoices)`);
    const created = await createAdvertiserRecord(sutton, { newOrganisationName: `Finance Wiring ${tag}`, owningTerritoryId: fixtureIds.territories.suttonColdfield });
    advertiserIds.push(created.id);
    organisationIds.push(created.advertiserOrganisationId);
    const slotId = randomUUID();
    await db.insert(inventorySlots).values({ id: slotId, territoryId: fixtureIds.territories.suttonColdfield, productId: product, slotKey: `fw-${slotId.slice(0, 8)}`, inventoryClass: "page", exclusive: true, status: "available", metadata: {} });
    slotIds.push(slotId);
    const proposal = await createProposalRecord(sutton, { advertiserId: created.id, title: "Wiring", validUntil: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), lines: [{ productId: product, quantity: 1, unitPriceMinor: 50000, inventorySlotId: slotId }] });
    proposalId = proposal.id;
    await sendProposalRecord(sutton, proposal.id);
    const booking = await bookProposalRecord(sutton, proposal.id);
    const draft = await createInvoiceRecord(sutton, booking.id, { dueInDays: 30 });
    creditless = draft.id;
    const issued = await issueInvoiceRecord(sutton, draft.id);
    invoiceId = issued.id;
    const payment = await recordPaymentRecord(sutton, { advertiserId: created.id, amountMinor: 20000, receivedDate: new Date().toISOString().slice(0, 10), method: "bank_transfer", reference: "FW", idempotencyKey: `fw-${tag}` });
    paymentId = payment.id;
  });

  afterAll(async () => {
    await withFinanceGuardsDisabled(db, async () => {
      const bookings = await db.select({ id: commercialBookings.id }).from(commercialBookings).where(inArray(commercialBookings.advertiserId, advertiserIds));
      const invoices = await db.select({ id: advertiserInvoices.id }).from(advertiserInvoices).where(inArray(advertiserInvoices.advertiserId, advertiserIds));
      const invoiceIds = invoices.map((row) => row.id);
      if (invoiceIds.length) await db.delete(advertiserProviderSyncReferences).where(inArray(advertiserProviderSyncReferences.entityId, invoiceIds));
      await db.delete(advertiserPaymentAllocations).where(eq(advertiserPaymentAllocations.paymentId, paymentId));
      if (invoiceIds.length) await db.delete(advertiserInvoiceLines).where(inArray(advertiserInvoiceLines.invoiceId, invoiceIds));
      await db.delete(advertiserDomainEvents).where(inArray(advertiserDomainEvents.advertiserId, advertiserIds));
      await db.delete(advertiserPayments).where(inArray(advertiserPayments.advertiserId, advertiserIds));
      await db.delete(advertiserInvoices).where(inArray(advertiserInvoices.advertiserId, advertiserIds));
      await db.delete(advertiserProposalAcceptances).where(eq(advertiserProposalAcceptances.proposalId, proposalId));
      const requirements = await db.select({ id: artworkRequirements.id }).from(artworkRequirements).where(inArray(artworkRequirements.advertiserId, advertiserIds));
      if (requirements.length) await db.delete(artworkVersions).where(inArray(artworkVersions.artworkRequirementId, requirements.map((row) => row.id)));
      await db.delete(artworkRequirements).where(inArray(artworkRequirements.advertiserId, advertiserIds));
      await db.delete(commercialProductionRequests).where(inArray(commercialProductionRequests.advertiserId, advertiserIds));
      if (bookings.length) await db.delete(commercialBookingItems).where(inArray(commercialBookingItems.bookingId, bookings.map((row) => row.id)));
      await db.delete(commercialBookings).where(inArray(commercialBookings.advertiserId, advertiserIds));
      await db.delete(inventoryReservations).where(inArray(inventoryReservations.advertiserId, advertiserIds));
      await db.delete(commercialProposalItems).where(eq(commercialProposalItems.proposalId, proposalId));
      await db.delete(commercialProposals).where(inArray(commercialProposals.advertiserId, advertiserIds));
      await db.delete(inventorySlots).where(inArray(inventorySlots.id, slotIds));
      await db.delete(advertisers).where(inArray(advertisers.id, advertiserIds));
      await db.delete(organisations).where(inArray(organisations.id, organisationIds));
      if (codes.length) await db.delete(advertiserTaxRates).where(inArray(advertiserTaxRates.code, codes));
      await db.delete(auditEvents).where(and(like(auditEvents.action, "advertiser.tax_rate.%"), eq(auditEvents.actorUserId, hq.userId)));
    });
    await sql.end();
  });

  it("queues exactly one accounting hand-off when an invoice is issued", async () => {
    const refs = await db.select().from(advertiserProviderSyncReferences).where(eq(advertiserProviderSyncReferences.entityId, invoiceId));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ providerType: "accounting", entityType: "advertiser_invoice", status: "pending" });
    // A draft was never queued.
    expect(creditless).toBe(invoiceId);
  });

  it("refuses, in the database, to change an issued invoice, its lines, or a recorded acceptance", async () => {
    await rejects(dsql`update advertiser_invoices set total_minor = 1, subtotal_minor = 1, tax_minor = 0 where id = ${invoiceId}`);
    await rejects(dsql`update advertiser_invoices set invoice_number = 'HACKED-1' where id = ${invoiceId}`);
    await rejects(dsql`update advertiser_invoices set issued_snapshot = '{"x":1}'::jsonb where id = ${invoiceId}`);
    await rejects(dsql`update advertiser_invoices set status = 'draft' where id = ${invoiceId}`);
    await rejects(dsql`delete from advertiser_invoices where id = ${invoiceId}`);
    await rejects(dsql`update advertiser_invoice_lines set net_minor = 1 where invoice_id = ${invoiceId}`);
    await rejects(dsql`delete from advertiser_invoice_lines where invoice_id = ${invoiceId}`);
    const [terms] = await db.select({ id: advertiserTerms.id }).from(advertiserTerms).limit(1);
    await db.insert(advertiserProposalAcceptances).values({ id: randomUUID(), proposalId, advertiserId: advertiserIds[0]!, territoryId: fixtureIds.territories.suttonColdfield, termsId: terms!.id, method: "staff_recorded", status: "accepted", acceptedAt: new Date(), commercialSnapshot: { total: 1 }, idempotencyKey: `fw-accept-${tag}` });
    await rejects(dsql`update advertiser_proposal_acceptances set commercial_snapshot = '{"x":1}'::jsonb where proposal_id = ${proposalId}`);
    await rejects(dsql`delete from advertiser_proposal_acceptances where proposal_id = ${proposalId}`);
    const [invoice] = await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, invoiceId));
    expect(invoice!.status).toBe("issued");
    expect(invoice!.invoiceNumber).not.toBe("HACKED-1");
  });

  it("still lets payments move an invoice's state, and rejects impossible money", async () => {
    await allocatePaymentRecord(sutton, { paymentId, invoiceId, amountMinor: 20000 });
    const [invoice] = await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, invoiceId));
    expect(invoice).toMatchObject({ status: "part_paid", amountPaidMinor: 20000 });
    await rejects(dsql`delete from advertiser_payment_allocations where payment_id = ${paymentId}`);
    await rejects(dsql`update advertiser_invoices set balance_minor = total_minor + 1 where id = ${invoiceId}`);
    await rejects(dsql`update advertiser_payments set unallocated_minor = unallocated_minor + 5 where id = ${paymentId}`);
    await rejects(dsql`update advertiser_payments set provider_key = 'stripe', provider_event_id = null where id = ${paymentId}`);
  });

  it("pushes to accounting once, with a stable key, and never again once synced", async () => {
    const seen: string[] = [];
    const recording: AccountingProvider = { ...ok, pushInvoice: async (invoice) => { seen.push(invoice.idempotencyKey ?? ""); return ok.pushInvoice(invoice); } };
    const first = await handle(recording);
    expect(first.synced).toBeGreaterThanOrEqual(1);
    expect(seen).toContain(`invoice:${invoiceId}`);
    expect(await refFor(invoiceId)).toMatchObject({ status: "synced", providerEntityId: `ext-invoice:${invoiceId}` });
    seen.length = 0;
    await handle(recording);
    expect(seen).not.toContain(`invoice:${invoiceId}`);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.action, "advertiser.accounting.sync"), eq(auditEvents.entityId, invoiceId)))).toHaveLength(1);
  });

  it("keeps a failing hand-off queued with backoff, stops after the limit, and lets a person retry it", async () => {
    await db.update(advertiserProviderSyncReferences).set({ status: "pending", providerEntityId: null, metadata: { attempts: 0 } }).where(eq(advertiserProviderSyncReferences.entityId, invoiceId));
    await handle(down);
    const afterOne = await refFor(invoiceId);
    expect(afterOne).toMatchObject({ status: "pending", metadata: expect.objectContaining({ attempts: 1, lastError: "accounting is down" }) });

    // Not due yet, so a second tick leaves it alone.
    expect((await handle(down)).claimed).toBe(0);

    let at = new Date();
    for (let attempt = 2; attempt <= ACCOUNTING_MAX_ATTEMPTS; attempt += 1) {
      at = new Date(at.getTime() + 7 * 3_600_000);
      await handle(down, at);
    }
    const stopped = await refFor(invoiceId);
    expect(stopped).toMatchObject({ status: "failed" });
    expect((await handle(down, new Date(at.getTime() + 24 * 3_600_000))).claimed).toBe(0);

    expect((await readFinanceConfig(hq)).counts.failed).toBeGreaterThanOrEqual(1);
    await expect(retryAccountingSync(sutton, stopped!.id)).rejects.toThrow(/Not allowed/);
    await retryAccountingSync(hq, stopped!.id);
    await handle(ok);
    expect(await refFor(invoiceId)).toMatchObject({ status: "synced" });
  });

  it("lets only a network administrator change tax, starts a new rate instead of rewriting one, and prices with the rate in force", async () => {
    const code = `test_${tag}`;
    codes.push(code);
    const rate = (percent: number, from: string) => setTaxRateRecord(hq, { code, description: "Test rate", rateBps: percent * 100, effectiveFrom: from });
    await expect(setTaxRateRecord(sutton, { code, description: "x", rateBps: 500, effectiveFrom: "2030-01-01" })).rejects.toThrow();
    await expect(rate(101, "2030-01-01")).rejects.toThrow(/between 0%/);
    await expect(setTaxRateRecord(hq, { code: "Bad Code", description: "", rateBps: 100, effectiveFrom: "2030-01-01" })).rejects.toThrow(/tax code/);
    await expect(rate(5, "01/01/2030")).rejects.toThrow(/YYYY-MM-DD/);

    await rate(5, "2030-01-01");
    await rate(7.5, "2031-04-06");
    await expect(rate(9, "2031-04-06")).rejects.toThrow(/start after/);
    await expect(rate(9, "2029-01-01")).rejects.toThrow(/start after/);

    const { rates } = await readFinanceConfig(hq);
    const mine = rates.filter((candidate) => candidate.code === code).sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
    expect(mine.map((candidate) => [candidate.rateBps, candidate.effectiveFrom, candidate.effectiveTo ?? null])).toEqual([[500, "2030-01-01", "2031-04-05"], [750, "2031-04-06", null]]);
    const data = { taxRates: mine } as unknown as Parameters<typeof taxRateFor>[0];
    expect(taxRateFor(data, code, "2030-06-01")).toBe(500);
    expect(taxRateFor(data, code, "2031-04-06")).toBe(750);
    expect(() => taxRateFor(data, code, "2029-12-31")).toThrow(/No tax rate/);
    await expect(readFinanceConfig(sutton)).rejects.toThrow(/Not allowed/);
  });
});
