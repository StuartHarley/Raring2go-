import { randomUUID } from "node:crypto";
import {
  advertiserActivityEvents, advertiserDomainEvents, advertiserInvoiceLines, advertiserInvoiceSequences, advertiserInvoices, advertiserPaymentAllocations, advertiserPayments,
  advertisers, auditEvents, commercialBookingItems, commercialBookings, commercialProductionRequests, commercialProposalItems, commercialProposals, createDb, fixtureIds,
  inventoryReservations, inventorySlots, organisations, artworkRequirements, artworkVersions
} from "@raring2go/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createAdvertiserRecord } from "./advertising-mutations";
import { allocatePaymentRecord, bookProposalRecord, createInvoiceRecord, createProposalRecord, issueInvoiceRecord, recordPaymentRecord, sendProposalRecord } from "./advertising-sales";

/** Real database: selling and billing persist, are priced by the server, and stay territory-scoped. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("advertiser sales and billing (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const product = fixtureIds.commercialProducts.fullPageAdvert;
  const advertiserIds: string[] = [];
  const organisationIds: string[] = [];
  const slotIds: string[] = [];
  const validUntil = () => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const today = () => new Date().toISOString().slice(0, 10);

  async function advertiser(name: string, context: typeof sutton | typeof hq = sutton, territoryId: string = fixtureIds.territories.suttonColdfield) {
    const created = await createAdvertiserRecord(context, { newOrganisationName: `${name} ${tag}`, owningTerritoryId: territoryId });
    advertiserIds.push(created.id);
    organisationIds.push(created.advertiserOrganisationId);
    return created;
  }

  async function slot() {
    const id = randomUUID();
    await db.insert(inventorySlots).values({ id, territoryId: fixtureIds.territories.suttonColdfield, productId: product, slotKey: `test-${id.slice(0, 8)}`, inventoryClass: "page", exclusive: true, status: "available", metadata: {} });
    slotIds.push(id);
    return id;
  }

  afterAll(async () => {
    const proposals = advertiserIds.length ? await db.select({ id: commercialProposals.id }).from(commercialProposals).where(inArray(commercialProposals.advertiserId, advertiserIds)) : [];
    const bookings = advertiserIds.length ? await db.select({ id: commercialBookings.id }).from(commercialBookings).where(inArray(commercialBookings.advertiserId, advertiserIds)) : [];
    const invoices = advertiserIds.length ? await db.select({ id: advertiserInvoices.id }).from(advertiserInvoices).where(inArray(advertiserInvoices.advertiserId, advertiserIds)) : [];
    const payments = advertiserIds.length ? await db.select({ id: advertiserPayments.id }).from(advertiserPayments).where(inArray(advertiserPayments.advertiserId, advertiserIds)) : [];
    const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);
    if (payments.length) await db.delete(advertiserPaymentAllocations).where(inArray(advertiserPaymentAllocations.paymentId, ids(payments)));
    if (invoices.length) await db.delete(advertiserInvoiceLines).where(inArray(advertiserInvoiceLines.invoiceId, ids(invoices)));
    if (advertiserIds.length) {
      await db.delete(advertiserDomainEvents).where(inArray(advertiserDomainEvents.advertiserId, advertiserIds));
      await db.delete(advertiserPayments).where(inArray(advertiserPayments.advertiserId, advertiserIds));
      await db.delete(advertiserInvoices).where(inArray(advertiserInvoices.advertiserId, advertiserIds));
      const requirements = await db.select({ id: artworkRequirements.id }).from(artworkRequirements).where(inArray(artworkRequirements.advertiserId, advertiserIds));
      if (requirements.length) await db.delete(artworkVersions).where(inArray(artworkVersions.artworkRequirementId, requirements.map((row) => row.id)));
      await db.delete(artworkRequirements).where(inArray(artworkRequirements.advertiserId, advertiserIds));
      await db.delete(commercialProductionRequests).where(inArray(commercialProductionRequests.advertiserId, advertiserIds));
    }
    if (bookings.length) await db.delete(commercialBookingItems).where(inArray(commercialBookingItems.bookingId, ids(bookings)));
    if (advertiserIds.length) {
      await db.delete(commercialBookings).where(inArray(commercialBookings.advertiserId, advertiserIds));
      await db.delete(inventoryReservations).where(inArray(inventoryReservations.advertiserId, advertiserIds));
    }
    if (proposals.length) await db.delete(commercialProposalItems).where(inArray(commercialProposalItems.proposalId, ids(proposals)));
    if (advertiserIds.length) {
      await db.delete(commercialProposals).where(inArray(commercialProposals.advertiserId, advertiserIds));
      await db.delete(advertiserActivityEvents).where(inArray(advertiserActivityEvents.advertiserId, advertiserIds));
      await db.delete(advertisers).where(inArray(advertisers.id, advertiserIds));
    }
    if (slotIds.length) await db.delete(inventorySlots).where(inArray(inventorySlots.id, slotIds));
    if (organisationIds.length) await db.delete(organisations).where(inArray(organisations.id, organisationIds));
    await sql.end();
  });

  it("prices from the price book on the server, refuses unauthorised discounts, and sends once", async () => {
    const a = await advertiser("Sales Test A");
    const slotId = await slot();
    const lines = (unitPriceMinor?: number) => [{ productId: product, quantity: 2, inventorySlotId: slotId, ...(unitPriceMinor ? { unitPriceMinor } : {}) }];

    await expect(createProposalRecord(sutton, { advertiserId: a.id, title: "Cheap", validUntil: validUntil(), lines: lines(44000) })).rejects.toThrow(/approval/);
    await expect(createProposalRecord(sutton, { advertiserId: a.id, title: "Too cheap", validUntil: validUntil(), lines: lines(100) })).rejects.toThrow(/minimum/);

    const proposal = await createProposalRecord(sutton, { advertiserId: a.id, title: "Autumn full page", validUntil: validUntil(), lines: lines() });
    expect(proposal).toMatchObject({ status: "draft", totalValueMinor: 105000 });
    const [item] = await db.select().from(commercialProposalItems).where(eq(commercialProposalItems.proposalId, proposal.id));
    expect(item).toMatchObject({ unitPriceMinor: 52500, quantity: 2, inventorySlotId: slotId });

    await sendProposalRecord(sutton, proposal.id);
    const [sent] = await db.select().from(commercialProposals).where(eq(commercialProposals.id, proposal.id));
    expect(sent?.status).toBe("sent");
    expect(String(sent?.sentOn instanceof Date ? sent.sentOn.toISOString().slice(0, 10) : sent?.sentOn)).toBe(today());
    await expect(sendProposalRecord(sutton, proposal.id)).rejects.toThrow(/draft/);
  });

  it("books a sent proposal once, reserves the slot exactly once, and updates the advertiser's derived value", async () => {
    const a = await advertiser("Sales Test B");
    const slotId = await slot();
    const proposal = await createProposalRecord(sutton, { advertiserId: a.id, title: "Booked", validUntil: validUntil(), lines: [{ productId: product, quantity: 1, inventorySlotId: slotId }] });
    await sendProposalRecord(sutton, proposal.id);

    const [first, second] = await Promise.all([bookProposalRecord(sutton, proposal.id).catch((error) => error), bookProposalRecord(sutton, proposal.id).catch((error) => error)]);
    const booked = [first, second].filter((result) => !(result instanceof Error));
    expect(booked.length).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(commercialBookings).where(eq(commercialBookings.proposalId, proposal.id))).toHaveLength(1);
    expect(await db.select().from(inventoryReservations).where(eq(inventoryReservations.inventorySlotId, slotId))).toHaveLength(1);

    const [row] = await db.select().from(advertisers).where(eq(advertisers.id, a.id));
    expect(row).toMatchObject({ annualAdvertiserValueMinor: 52500, averageSaleValueMinor: 52500, relationshipState: "new" });
    expect(row?.lastBookedOn instanceof Date ? row.lastBookedOn.toISOString().slice(0, 10) : row?.lastBookedOn).toBe(today());

    // The same exclusive slot cannot be sold twice.
    const rival = await advertiser("Sales Test Rival");
    const rivalProposal = await createProposalRecord(sutton, { advertiserId: rival.id, title: "Rival", validUntil: validUntil(), lines: [{ productId: product, quantity: 1, inventorySlotId: slotId }] });
    await sendProposalRecord(sutton, rivalProposal.id);
    await expect(bookProposalRecord(sutton, rivalProposal.id)).rejects.toThrow(/already reserved/);
  });

  it("invoices a booking once, numbers issued invoices consecutively even when issued together, and reconciles payments", async () => {
    const a = await advertiser("Sales Test C");
    const bookingFor = async (price: number) => {
      const slotId = await slot();
      const proposal = await createProposalRecord(sutton, { advertiserId: a.id, title: `Deal ${price}`, validUntil: validUntil(), lines: [{ productId: product, quantity: 1, unitPriceMinor: price, inventorySlotId: slotId }] });
      await sendProposalRecord(sutton, proposal.id);
      return bookProposalRecord(sutton, proposal.id);
    };
    const [bookingOne, bookingTwo] = [await bookingFor(52500), await bookingFor(50000)];

    const invoiceOne = await createInvoiceRecord(sutton, bookingOne.id, { dueInDays: 30 });
    await expect(createInvoiceRecord(sutton, bookingOne.id, { dueInDays: 30 })).rejects.toThrow(/already has an invoice/);
    expect(invoiceOne).toMatchObject({ status: "draft", subtotalMinor: 52500, taxMinor: 10500, totalMinor: 63000, balanceMinor: 63000, invoiceNumber: expect.stringMatching(/^DRAFT/) });
    const invoiceTwo = await createInvoiceRecord(sutton, bookingTwo.id, { dueInDays: 14 });

    const issued = await Promise.all([issueInvoiceRecord(sutton, invoiceOne.id), issueInvoiceRecord(sutton, invoiceTwo.id)]);
    const numbers = issued.map((invoice) => Number(invoice.invoiceNumber.split("-")[1])).sort((x, y) => x - y);
    expect(numbers[1]).toBe(numbers[0]! + 1);
    await expect(issueInvoiceRecord(sutton, invoiceOne.id)).rejects.toThrow(/draft/);
    const [sequence] = await db.select().from(advertiserInvoiceSequences).where(eq(advertiserInvoiceSequences.issuerOrganisationId, fixtureIds.organisations.franchise));
    expect(sequence!.nextNumber).toBeGreaterThan(numbers[1]!);

    const key = randomUUID();
    const first = await recordPaymentRecord(sutton, { advertiserId: a.id, amountMinor: 70000, receivedDate: today(), method: "bank_transfer", reference: "BACS 1", idempotencyKey: key });
    const again = await recordPaymentRecord(sutton, { advertiserId: a.id, amountMinor: 70000, receivedDate: today(), method: "bank_transfer", reference: "BACS 1", idempotencyKey: key });
    expect(again.id).toBe(first.id);
    expect(await db.select().from(advertiserPayments).where(eq(advertiserPayments.advertiserId, a.id))).toHaveLength(1);

    await allocatePaymentRecord(sutton, { paymentId: first.id, invoiceId: invoiceOne.id, amountMinor: 30000 });
    let [row] = await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, invoiceOne.id));
    expect(row).toMatchObject({ status: "part_paid", amountPaidMinor: 30000, balanceMinor: 33000 });

    await expect(allocatePaymentRecord(sutton, { paymentId: first.id, invoiceId: invoiceOne.id, amountMinor: 40000 })).rejects.toThrow(/cannot exceed/);
    await allocatePaymentRecord(sutton, { paymentId: first.id, invoiceId: invoiceOne.id, amountMinor: 33000 });
    [row] = await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, invoiceOne.id));
    expect(row).toMatchObject({ status: "paid", balanceMinor: 0 });
    const [payment] = await db.select().from(advertiserPayments).where(eq(advertiserPayments.id, first.id));
    expect(payment).toMatchObject({ allocatedMinor: 63000, unallocatedMinor: 7000 });

    const events = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, a.id)));
    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining(["advertiser.invoice.create", "advertiser.invoice.issue", "advertiser.payment.record", "advertiser.payment.allocate"]));
  });

  it("refuses bad payment input", async () => {
    const a = await advertiser("Sales Test D");
    const base = { advertiserId: a.id, method: "cash", idempotencyKey: randomUUID() };
    await expect(recordPaymentRecord(sutton, { ...base, amountMinor: 0, receivedDate: today() })).rejects.toThrow(/greater than zero/);
    await expect(recordPaymentRecord(sutton, { ...base, amountMinor: 100, receivedDate: "2999-01-01" })).rejects.toThrow(/future/);
  });

  it("keeps territories apart across selling and billing", async () => {
    const solihull = await advertiser("Sales Test Solihull", hq, fixtureIds.territories.solihull);
    await expect(createProposalRecord(sutton, { advertiserId: solihull.id, title: "x", validUntil: validUntil(), lines: [{ productId: product, quantity: 1, inventorySlotId: await slot() }] })).rejects.toThrow();
    await expect(recordPaymentRecord(sutton, { advertiserId: solihull.id, amountMinor: 100, receivedDate: today(), method: "cash", idempotencyKey: randomUUID() })).rejects.toThrow();
  });
});
