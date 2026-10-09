import { withFinanceGuardsDisabled } from "./finance-test-support";
import { randomUUID } from "node:crypto";
import { advertiserInvoices, advertiserPaymentAllocations, advertiserPayments, aiRuns, aiUsageEvents, auditEvents, createDb, fixtureIds, royaltyRules, royaltyStatements } from "@raring2go/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptSuggestedMatch, generateChaseNotes, generateRoyaltyNotes, readDebtPanel, readRoyaltyPanel } from "./assistants-finance";

const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
const solihull = { ...sutton, territoryId: fixtureIds.territories.solihull };
const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const tag = randomUUID().slice(0, 6).toUpperCase();
const ids = { oldInvoice: randomUUID(), recentInvoice: randomUUID(), futureInvoice: randomUUID(), payment: randomUUID(), rule: randomUUID() };
const statementIds: string[] = [];
const createdRuns: string[] = [];

const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const D = (value: string) => new Date(`${value}T00:00:00Z`);

/** Real database: finance assistant end to end. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("finance assistant end to end (postgres)", () => {
  beforeAll(async () => {
    process.env.AI_PROVIDER = "deterministic";
    process.env.AI_SPEND_CAP_NETWORK_MINOR = "100000000";
    process.env.AI_SPEND_CAP_TERRITORY_MINOR = "100000000";
    process.env.AI_ASSIST_RATE_LIMIT = "1000";
    const { db, sql } = createDb();
    const base = { issuerOrganisationId: fixtureIds.organisations.franchise, advertiserId: fixtureIds.advertisers.example, customerOrganisationId: fixtureIds.organisations.advertiser, territoryId: fixtureIds.territories.suttonColdfield, status: "issued" };
    await db.insert(advertiserInvoices).values([
      { ...base, id: ids.oldInvoice, invoiceNumber: `T-${tag}-OLD`, dueDate: D(dayOffset(-68)), subtotalMinor: 120_000, totalMinor: 120_000, balanceMinor: 120_000 },
      { ...base, id: ids.recentInvoice, invoiceNumber: `T-${tag}-REC`, dueDate: D(dayOffset(-10)), subtotalMinor: 50_000, totalMinor: 50_000, balanceMinor: 50_000 },
      { ...base, id: ids.futureInvoice, invoiceNumber: `T-${tag}-FUT`, dueDate: D(dayOffset(20)), subtotalMinor: 30_000, totalMinor: 30_000, balanceMinor: 30_000 }
    ]);
    await db.insert(advertiserPayments).values({ id: ids.payment, issuerOrganisationId: fixtureIds.organisations.franchise, advertiserId: fixtureIds.advertisers.example, payerOrganisationId: fixtureIds.organisations.advertiser, amountMinor: 50_000, allocatedMinor: 0, unallocatedMinor: 50_000, receivedDate: D(dayOffset(-2)), method: "bank_transfer", externalReference: `Paid T-${tag}-REC thanks`, status: "received" });

    await db.insert(royaltyRules).values({ id: ids.rule, franchiseId: "00000000-0000-4000-8000-000000000901", territoryId: fixtureIds.territories.suttonColdfield, rateBps: 1000, effectiveFrom: D("2025-01-01") });
    const periods = [["2026-01-01", "2026-01-31", 100_000], ["2026-02-01", "2026-02-28", 102_000], ["2026-03-01", "2026-03-31", 98_000], ["2026-04-01", "2026-04-30", 101_000], ["2026-05-01", "2026-05-31", 320_000]] as const;
    for (const [start, end, royalty] of periods) {
      const id = randomUUID();
      statementIds.push(id);
      await db.insert(royaltyStatements).values({ id, franchiseId: "00000000-0000-4000-8000-000000000901", territoryId: fixtureIds.territories.suttonColdfield, issuerOrganisationId: fixtureIds.organisations.hq, royaltyRuleId: ids.rule, statementNumber: `RS-${tag}-${start.slice(5, 7)}`, status: "approved", periodStart: D(start), periodEnd: D(end), revenueBasis: "invoiced", royaltyRateBpsSnapshot: 1000, grossRevenueMinor: royalty * 10, calculatedRoyaltyMinor: royalty, totalDueMinor: royalty, generatedAt: D(end) });
    }
    await sql.end();
  });

  afterAll(async () => {
    const { db, sql } = createDb();
    await withFinanceGuardsDisabled(db, async () => {
    await db.delete(advertiserPaymentAllocations).where(eq(advertiserPaymentAllocations.paymentId, ids.payment));
    await db.delete(advertiserPayments).where(eq(advertiserPayments.id, ids.payment));
    await db.delete(advertiserInvoices).where(inArray(advertiserInvoices.id, [ids.oldInvoice, ids.recentInvoice, ids.futureInvoice]));
    });
    await db.delete(royaltyStatements).where(inArray(royaltyStatements.id, statementIds));
    await db.delete(royaltyRules).where(eq(royaltyRules.id, ids.rule));
    await db.delete(aiUsageEvents).where(inArray(aiUsageEvents.feature, ["finance.chase_notes", "finance.royalty_notes"]));
    if (createdRuns.length) await db.delete(aiRuns).where(inArray(aiRuns.id, createdRuns));
    await withFinanceGuardsDisabled(db, async () => { await db.delete(auditEvents).where(and(eq(auditEvents.entityType, "advertiser_payment_allocation"), like(auditEvents.action, "advertiser.payment.%"), eq(auditEvents.actorUserId, sutton.userId))); });
    await sql.end();
  });

  it("ranks the overdue invoices, leaves out what is not yet due, and suggests the matching payment", async () => {
    const panel = await readDebtPanel(sutton);
    const mine = panel.ranked.filter((entry) => entry.invoiceNumber.includes(tag));
    expect(mine.map((entry) => entry.invoiceNumber)).toEqual([`T-${tag}-OLD`, `T-${tag}-REC`]);
    expect(mine[0]).toMatchObject({ daysOverdue: 68, bucket: "61-90", balanceMinor: 120_000 });
    const match = panel.matches.find((candidate) => candidate.paymentId === ids.payment)!;
    expect(match).toMatchObject({ basis: "reference_and_amount", confidence: 0.98, leavesUnallocatedMinor: 0, amountMinor: 50_000 });
    expect(match.allocations).toEqual([{ invoiceId: ids.recentInvoice, invoiceNumber: `T-${tag}-REC`, amountMinor: 50_000 }]);
    expect(panel).toMatchObject({ canAssist: true, canAllocate: true, aiConfigured: true });
  });

  it("another territory sees none of it, and cannot accept the match", async () => {
    // A territory the actor does not belong to is refused outright, not shown as an empty list.
    await expect(readDebtPanel(solihull)).rejects.toThrow();
    await expect(acceptSuggestedMatch(solihull, { paymentId: ids.payment })).rejects.toThrow();
    await expect(generateChaseNotes(solihull)).rejects.toThrow();
  });

  it("records chasing notes as an AI run on the portfolio, and the notes never get firmer than the lateness allows", async () => {
    const { run, output } = await generateChaseNotes(sutton);
    createdRuns.push(run.id);
    expect(run).toMatchObject({ taskKey: "finance.chase_notes", approvalState: "not_required", subjectType: "debt_portfolio", actorUserId: sutton.userId });
    const recent = output.accounts.find((account) => account.invoiceId === ids.recentInvoice)!;
    expect(recent.tone).toBe("friendly");
    expect((await readDebtPanel(sutton)).chase?.runId).toBe(run.id);
  });

  it("accepting a match runs the real, audited allocation exactly once, and records where it came from", async () => {
    await acceptSuggestedMatch(sutton, { paymentId: ids.payment });
    const { db, sql } = createDb();
    try {
      const [invoice] = await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, ids.recentInvoice));
      const [payment] = await db.select().from(advertiserPayments).where(eq(advertiserPayments.id, ids.payment));
      const allocations = await db.select().from(advertiserPaymentAllocations).where(eq(advertiserPaymentAllocations.paymentId, ids.payment));
      expect(invoice).toMatchObject({ status: "paid", balanceMinor: 0, amountPaidMinor: 50_000 });
      expect(payment).toMatchObject({ unallocatedMinor: 0, allocatedMinor: 50_000 });
      expect(allocations).toHaveLength(1);
      expect(allocations[0]!.metadata).toMatchObject({ source: "assistant_suggestion", basis: "reference_and_amount" });
      const audits = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "advertiser.payment.allocate"), eq(auditEvents.actorUserId, sutton.userId)));
      expect(JSON.stringify(audits.map((event) => event.payload))).toContain("assistant_suggestion");
    } finally {
      await sql.end();
    }
    await expect(acceptSuggestedMatch(sutton, { paymentId: ids.payment })).rejects.toThrow(/no longer a suggested match/);
    expect((await readDebtPanel(sutton)).matches.find((candidate) => candidate.paymentId === ids.payment)).toBeUndefined();
  });

  it("flags the royalty swing for Head Office only, and the notes are a high-risk run awaiting a second person", async () => {
    const panel = await readRoyaltyPanel(hq);
    const swing = panel.flags.find((flag) => flag.kind === "swing" && flag.territoryName === "Sutton Coldfield");
    expect(swing).toMatchObject({ severity: "high" });
    expect(swing!.detail).toMatch(/£3,200\.00/);
    await expect(readRoyaltyPanel(sutton)).rejects.toThrow();

    const { run, output } = await generateRoyaltyNotes(hq);
    createdRuns.push(run.id);
    expect(run).toMatchObject({ taskKey: "finance.royalty_notes", risk: "high", approvalState: "pending", subjectType: "royalty_review", actorUserId: hq.userId });
    expect(output.notice).toMatch(/not findings/);
    expect(output.questions.some((q) => q.observation === swing!.detail)).toBe(true);
    await expect(generateRoyaltyNotes(sutton)).rejects.toThrow();
  });
});
