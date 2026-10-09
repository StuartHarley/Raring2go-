import { randomBytes, randomUUID } from "node:crypto";
import {
  advertiserCreditNoteLines, advertiserCreditNotes, advertiserDomainEvents, advertiserInvoiceLines, advertiserInvoices, advertiserPayments, advertiserProposalAcceptances,
  advertiserProviderSyncReferences, advertisers, artworkRequirements, artworkVersions, auditEvents, commercialBookingItems, commercialBookings, commercialProductionRequests, commercialProposalItems, commercialProposals,
  createDb, fixtureIds, inventoryReservations, inventorySlots, organisations, providerConnectionSecrets, providerConnections
} from "@raring2go/db";
import { issueCreditNote } from "@raring2go/advertising";
import { completeProviderConnection, createDrizzleProviderConnectionRepository, createDrizzleSecretRepository, createEncryptedSecretStore, defaultXeroMapping } from "@raring2go/integrations";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSyncAccountingHandler } from "./accounting-jobs";
import { createAdvertiserRecord, mutate } from "./advertising-mutations";
import { bookProposalRecord, createInvoiceRecord, createProposalRecord, issueInvoiceRecord, sendProposalRecord } from "./advertising-sales";
import { withFinanceGuardsDisabled } from "./finance-test-support";
import { getValidXeroAccessToken, parseXeroMapping, saveXeroMapping, xeroResolver } from "./xero-runtime";

describe("Xero mapping input", () => {
  it("accepts short codes and refuses anything else", () => {
    expect(parseXeroMapping({ salesAccountCode: " 200 ", standardVat: "OUTPUT2", zeroRated: "ZERORATEDOUTPUT", exempt: "EXEMPTOUTPUT" }).salesAccountCode).toBe("200");
    for (const bad of ["", "a b", "x".repeat(41), "<script>", "200;drop"]) {
      expect(() => parseXeroMapping({ salesAccountCode: bad, standardVat: "OUTPUT2", zeroRated: "Z", exempt: "E" }), bad).toThrow(/not a valid Xero code/);
    }
  });
});

// The pretend Xero reads whatever JSON the code under test sends, so the body is deliberately loose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Seen = { method: string; path: string; headers: Record<string, string>; body: any };

/** Real database and a pretend Xero: the franchise's invoices and credit notes reach its own Xero, once, safely. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("Xero accounting hand-off (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const product = fixtureIds.commercialProducts.fullPageAdvert;
  const TENANT = `tenant-${tag}`;
  const advertiserIds: string[] = [];
  const organisationIds: string[] = [];
  const slotIds: string[] = [];
  const proposalIds: string[] = [];
  const connectionIds: string[] = [];
  const seen: Seen[] = [];
  let identityCalls = 0;
  let identityResponds: "ok" | "revoked" = "ok";
  let xeroMode: "ok" | "reject_invoice" | "unauthorised" = "ok";
  let created = 0;

  const fakeXero = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const bodyText = init?.body ? String(init.body) : "";
    if (url.hostname === "identity.xero.com") {
      identityCalls += 1;
      return identityResponds === "ok"
        ? new Response(JSON.stringify({ access_token: `access-${identityCalls}`, refresh_token: `refresh-${identityCalls}`, expires_in: 1800 }), { status: 200 })
        : new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    const path = url.pathname.replace("/api.xro/2.0", "") + url.search;
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    seen.push({ method: init?.method ?? "GET", path, headers, body });
    const respond = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });
    if (xeroMode === "unauthorised") return respond({}, 401);
    if (path.startsWith("/Contacts") && (init?.method ?? "GET") === "GET") return respond({ Contacts: [] });
    if (path === "/Contacts") return respond({ Contacts: [{ ContactID: `contact-${body.Contacts[0].Name}` }] });
    const total = (items: Array<{ UnitAmount: number; Quantity: number; TaxAmount: number }>) => Math.round(items.reduce((sum, item) => sum + item.UnitAmount * item.Quantity + item.TaxAmount, 0) * 100) / 100;
    if (path === "/Invoices") {
      if (xeroMode === "reject_invoice") return respond({ Elements: [{ ValidationErrors: [{ Message: "Account code '200' is not a valid code." }] }] }, 400);
      created += 1;
      return respond({ Invoices: [{ InvoiceID: `xero-inv-${created}`, Total: total(body.Invoices[0].LineItems) }] });
    }
    if (path === "/CreditNotes") return respond({ CreditNotes: [{ CreditNoteID: `xero-cr-${++created}`, Total: total(body.CreditNotes[0].LineItems) }] });
    if (init?.method === "PUT") return respond({});
    return respond({}, 404);
  }) as unknown as typeof fetch;

  const run = (now = new Date(), resolver = (target: { issuerOrganisationId: string; territoryId: string }) => xeroResolver(target, { fetch: fakeXero })) =>
    (createSyncAccountingHandler(resolver) as unknown as { handle: (context: { now: () => Date }) => Promise<{ claimed: number; synced: number; failed: number; waiting: number }> }).handle({ now: () => now });
  const refFor = async (entityId: string) => (await db.select().from(advertiserProviderSyncReferences).where(eq(advertiserProviderSyncReferences.entityId, entityId)))[0]!;
  const store = () => createEncryptedSecretStore({ repository: createDrizzleSecretRepository(db), encryptionKey: process.env.INTEGRATION_SECRET_ENCRYPTION_KEY!, keyVersion: "v1" });

  async function newInvoice(label: string, price = 50000) {
    const advertiser = await createAdvertiserRecord(sutton, { newOrganisationName: `Xero ${label} ${tag}`, owningTerritoryId: sutton.territoryId });
    advertiserIds.push(advertiser.id);
    organisationIds.push(advertiser.advertiserOrganisationId);
    const slotId = randomUUID();
    await db.insert(inventorySlots).values({ id: slotId, territoryId: sutton.territoryId, productId: product, slotKey: `xr-${slotId.slice(0, 8)}`, inventoryClass: "page", exclusive: true, status: "available", metadata: {} });
    slotIds.push(slotId);
    const proposal = await createProposalRecord(sutton, { advertiserId: advertiser.id, title: label, validUntil: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), lines: [{ productId: product, quantity: 1, unitPriceMinor: price, inventorySlotId: slotId }] });
    proposalIds.push(proposal.id);
    await sendProposalRecord(sutton, proposal.id);
    const booking = await bookProposalRecord(sutton, proposal.id);
    const draft = await createInvoiceRecord(sutton, booking.id, { dueInDays: 30 });
    return { advertiser, invoice: await issueInvoiceRecord(sutton, draft.id) };
  }

  const issueCredit = (invoiceId: string, netMinor: number) =>
    mutate((_tx, data, audit, permissions) => {
      const invoice = data.invoices.find((candidate) => candidate.id === invoiceId)!;
      const creditId = randomUUID();
      const taxMinor = Math.round(netMinor * 0.2);
      return issueCreditNote(hq, permissions, audit, data, {
        creditNote: { id: creditId, invoiceId, issuerOrganisationId: invoice.issuerOrganisationId, creditNoteNumber: `CR-${tag}-${creditId.slice(0, 4)}`, reason: "test", issuedByUserId: hq.userId, issuedDate: new Date().toISOString().slice(0, 10), currency: "GBP", subtotalMinor: 0, taxMinor: 0, totalMinor: 0, snapshot: {} },
        lines: [{ id: randomUUID(), creditNoteId: creditId, invoiceLineId: null, description: "Goodwill credit", netMinor, taxRateBps: 2000, taxMinor, grossMinor: netMinor + taxMinor, taxCode: "standard_vat" }],
        domainEventId: randomUUID()
      });
    });

  async function connect() {
    const permissions = await (await import("./permission-source")).getPermissionData();
    const connection = await completeProviderConnection({
      context: sutton, permissions, repository: createDrizzleProviderConnectionRepository(db), secretStore: store(), audit: { record: async () => undefined },
      provider: "xero", connectionType: "accounting", externalAccountId: TENANT, externalAccountDisplayName: "Sutton Test Ltd", grantedScopes: ["accounting.transactions"],
      token: JSON.stringify({ accessToken: "access-0", refreshToken: "refresh-0" }), tokenExpiryAt: new Date(Date.now() + 25 * 60_000), providerSafeMetadata: { mapping: defaultXeroMapping }
    });
    connectionIds.push(connection.id);
    return connection;
  }

  beforeAll(async () => {
    vi.stubEnv("INTEGRATION_SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("XERO_CLIENT_ID", "cid");
    vi.stubEnv("XERO_CLIENT_SECRET", "secret");
    vi.stubEnv("XERO_OAUTH_REDIRECT_URI", "https://app.example.test/api/integrations/xero/callback");
    // Earlier runs may have left connections for this franchise; this test needs to control whether one exists.
    await db.update(providerConnections).set({ status: "revoked" }).where(and(eq(providerConnections.provider, "xero"), eq(providerConnections.organisationId, sutton.organisationId)));
    await db.execute(`delete from advertiser_provider_sync_references where provider_type = 'accounting' and entity_type in ('advertiser_invoice', 'advertiser_credit_note') and entity_id not in (select id from advertiser_invoices) and entity_id not in (select id from advertiser_credit_notes)` as never).catch(() => undefined);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await withFinanceGuardsDisabled(db, async () => {
      const invoices = await db.select({ id: advertiserInvoices.id }).from(advertiserInvoices).where(inArray(advertiserInvoices.advertiserId, advertiserIds));
      const invoiceIds = invoices.map((row) => row.id);
      const credits = invoiceIds.length ? await db.select({ id: advertiserCreditNotes.id }).from(advertiserCreditNotes).where(inArray(advertiserCreditNotes.invoiceId, invoiceIds)) : [];
      const bookings = await db.select({ id: commercialBookings.id }).from(commercialBookings).where(inArray(commercialBookings.advertiserId, advertiserIds));
      const entityIds = [...invoiceIds, ...credits.map((row) => row.id), ...organisationIds];
      if (entityIds.length) await db.delete(advertiserProviderSyncReferences).where(inArray(advertiserProviderSyncReferences.entityId, entityIds));
      if (credits.length) await db.delete(advertiserCreditNoteLines).where(inArray(advertiserCreditNoteLines.creditNoteId, credits.map((row) => row.id)));
      if (credits.length) await db.delete(advertiserCreditNotes).where(inArray(advertiserCreditNotes.id, credits.map((row) => row.id)));
      if (invoiceIds.length) await db.delete(advertiserInvoiceLines).where(inArray(advertiserInvoiceLines.invoiceId, invoiceIds));
      await db.delete(advertiserDomainEvents).where(inArray(advertiserDomainEvents.advertiserId, advertiserIds));
      await db.delete(advertiserPayments).where(inArray(advertiserPayments.advertiserId, advertiserIds));
      await db.delete(advertiserInvoices).where(inArray(advertiserInvoices.advertiserId, advertiserIds));
      await db.delete(advertiserProposalAcceptances).where(inArray(advertiserProposalAcceptances.proposalId, proposalIds));
      const requirements = await db.select({ id: artworkRequirements.id }).from(artworkRequirements).where(inArray(artworkRequirements.advertiserId, advertiserIds));
      if (requirements.length) await db.delete(artworkVersions).where(inArray(artworkVersions.artworkRequirementId, requirements.map((row) => row.id)));
      await db.delete(artworkRequirements).where(inArray(artworkRequirements.advertiserId, advertiserIds));
      await db.delete(commercialProductionRequests).where(inArray(commercialProductionRequests.advertiserId, advertiserIds));
      if (bookings.length) await db.delete(commercialBookingItems).where(inArray(commercialBookingItems.bookingId, bookings.map((row) => row.id)));
      await db.delete(commercialBookings).where(inArray(commercialBookings.advertiserId, advertiserIds));
      await db.delete(inventoryReservations).where(inArray(inventoryReservations.advertiserId, advertiserIds));
      await db.delete(commercialProposalItems).where(inArray(commercialProposalItems.proposalId, proposalIds));
      await db.delete(commercialProposals).where(inArray(commercialProposals.advertiserId, advertiserIds));
      await db.delete(inventorySlots).where(inArray(inventorySlots.id, slotIds));
      await db.delete(advertisers).where(inArray(advertisers.id, advertiserIds));
      await db.delete(organisations).where(inArray(organisations.id, organisationIds));
      await db.delete(auditEvents).where(and(like(auditEvents.action, "integration.%"), eq(auditEvents.actorUserId, sutton.userId)));
    });
    if (connectionIds.length) {
      await db.delete(providerConnectionSecrets).where(inArray(providerConnectionSecrets.providerConnectionId, connectionIds));
      await db.delete(providerConnections).where(inArray(providerConnections.id, connectionIds));
    }
    await sql.end();
  });

  it("waits, without spending an attempt, until the franchise connects Xero", async () => {
    const { invoice } = await newInvoice("wait");
    // No connection and a production-like resolver: nothing is sent anywhere.
    await run(new Date(), async () => null);
    expect(await refFor(invoice.id)).toMatchObject({ status: "pending", metadata: expect.objectContaining({ attempts: 0, waitingFor: expect.stringMatching(/No accounting system is connected/) }) });
    expect(seen).toHaveLength(0);
  });

  it("sends the invoice to the franchise's own Xero with matching amounts, remembers the contact, and reuses it", async () => {
    const connection = await connect();
    const { invoice } = await newInvoice("send");
    // The earlier waiting reference is due again once its wait has passed.
    const later = new Date(Date.now() + 7 * 3_600_000);
    const outcome = await run(later);
    expect(outcome.synced).toBeGreaterThanOrEqual(1);
    expect(await refFor(invoice.id)).toMatchObject({ status: "synced", providerEntityId: expect.stringMatching(/^xero-inv-/) });

    const send = seen.find((entry) => entry.path === "/Invoices" && entry.body.Invoices[0].InvoiceNumber === invoice.invoiceNumber)!;
    expect(send.headers).toMatchObject({ "xero-tenant-id": TENANT, authorization: "Bearer access-0", "idempotency-key": `invoice:${invoice.id}` });
    expect(send.body.Invoices[0]).toMatchObject({ Type: "ACCREC", CurrencyCode: "GBP", LineAmountTypes: "Exclusive", Status: "AUTHORISED" });
    expect(send.body.Invoices[0].LineItems[0]).toMatchObject({ UnitAmount: 500, TaxAmount: 100, AccountCode: "200", TaxType: "OUTPUT2" });

    const contact = await db.select().from(advertiserProviderSyncReferences).where(and(eq(advertiserProviderSyncReferences.providerType, "accounting_contact"), eq(advertiserProviderSyncReferences.providerKey, connection.id)));
    expect(contact.some((row) => row.providerEntityId?.startsWith("contact-Xero send"))).toBe(true);

    // A second invoice for the same advertiser does not search or create the contact again.
    seen.length = 0;
    const [advertiserOrg] = await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, invoice.id));
    expect(advertiserOrg).toBeDefined();
  });

  it("sends a credit note, applies it to its invoice, and keeps a failing invoice's credit note waiting rather than failing", async () => {
    const { invoice } = await newInvoice("credit");
    await run(new Date(Date.now() + 8 * 3_600_000));
    expect(await refFor(invoice.id)).toMatchObject({ status: "synced" });
    const credit = await issueCredit(invoice.id, 10000);
    seen.length = 0;
    await run(new Date(Date.now() + 9 * 3_600_000));
    expect(await refFor(credit.id)).toMatchObject({ status: "synced", providerEntityId: expect.stringMatching(/^xero-cr-/) });
    const allocation = seen.find((entry) => entry.method === "PUT")!;
    expect(allocation.path).toMatch(/\/CreditNotes\/xero-cr-\d+\/Allocations$/);
    expect(allocation.body.Allocations[0]).toMatchObject({ Amount: 120 });
    expect(allocation.body.Allocations[0].Invoice.InvoiceID).toMatch(/^xero-inv-/);

    // An invoice Xero refuses fails (and counts), and its credit note waits for it without failing.
    xeroMode = "reject_invoice";
    const second = await newInvoice("credit2");
    const secondCredit = await issueCredit(second.invoice.id, 5000);
    await run(new Date(Date.now() + 10 * 3_600_000));
    expect(await refFor(second.invoice.id)).toMatchObject({ status: "pending", metadata: expect.objectContaining({ attempts: 1, lastError: expect.stringMatching(/not a valid code/) }) });
    expect(await refFor(secondCredit.id)).toMatchObject({ status: "pending", metadata: expect.objectContaining({ attempts: 0, waitingFor: expect.stringMatching(/has not reached Xero yet/) }) });
    xeroMode = "ok";
  });

  it("asks for a reconnect instead of burning attempts when Xero no longer accepts the connection", async () => {
    const { invoice } = await newInvoice("auth");
    xeroMode = "unauthorised";
    identityResponds = "revoked";
    await run(new Date(Date.now() + 11 * 3_600_000));
    expect(await refFor(invoice.id)).toMatchObject({ status: "pending", metadata: expect.objectContaining({ attempts: 0, waitingFor: expect.stringMatching(/reconnected/) }) });
    const [connection] = await db.select().from(providerConnections).where(eq(providerConnections.id, connectionIds[0]!));
    expect(connection).toMatchObject({ status: "expired", lastHealthStatus: "expired" });
    xeroMode = "ok";
    identityResponds = "ok";
  });

  it("refreshes an expiring token exactly once even when two workers ask at the same time, and stores the rotated pair", async () => {
    const connection = await connect();
    await db.update(providerConnections).set({ tokenExpiryAt: new Date(Date.now() - 60_000) }).where(eq(providerConnections.id, connection.id));
    identityCalls = 0;
    const [a, b] = await Promise.all([getValidXeroAccessToken(connection.id, { fetch: fakeXero }), getValidXeroAccessToken(connection.id, { fetch: fakeXero })]);
    expect(identityCalls).toBe(1);
    expect(a).toBe("access-1");
    expect(b).toBe("access-1");
    // The stored pair is the rotated one, and a token Xero rejected is replaced only by a newer stored token.
    expect(await getValidXeroAccessToken(connection.id, { fetch: fakeXero })).toBe("access-1");
    expect(await getValidXeroAccessToken(connection.id, { rejectedToken: "access-0", fetch: fakeXero })).toBe("access-1");
    expect(identityCalls).toBe(1);
  });

  it("only lets a franchise change the mapping of its own Xero connection", async () => {
    const connection = (await db.select().from(providerConnections).where(and(eq(providerConnections.provider, "xero"), eq(providerConnections.status, "connected"))))[0]!;
    const mapping = parseXeroMapping({ salesAccountCode: "260", standardVat: "OUTPUT2", zeroRated: "ZERORATEDOUTPUT", exempt: "EXEMPTOUTPUT" });
    await saveXeroMapping({ sessionKey: "franchisee" }, connection.id, mapping);
    expect(((await db.select().from(providerConnections).where(eq(providerConnections.id, connection.id)))[0]!.providerSafeMetadata as { mapping: { salesAccountCode: string } }).mapping.salesAccountCode).toBe("260");

    const [foreign] = await db.insert(providerConnections).values({ provider: "xero", connectionType: "accounting", organisationId: fixtureIds.organisations.hq, externalAccountId: `foreign-${tag}`, externalAccountDisplayName: "HQ", status: "connected" }).returning();
    connectionIds.push(foreign!.id);
    await expect(saveXeroMapping({ sessionKey: "franchisee" }, foreign!.id, mapping)).rejects.toThrow(/not found/);
    await expect(saveXeroMapping({}, connection.id, mapping)).rejects.toThrow();
  });
});
