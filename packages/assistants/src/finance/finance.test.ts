import { describe, expect, it } from "vitest";
import { agedDebtTotals, maxToneFor, rankAgedDebt } from "./aged-debt";
import type { DebtInvoice } from "./aged-debt";
import { suggestPaymentMatches } from "./matching";
import { detectRoyaltyAnomalies } from "./royalty";
import type { StatementFacts } from "./royalty";
import { chaseNotesTask, mergeChaseNotes, mergeRoyaltyNotes, ROYALTY_NOTICE, royaltyNotesTask } from "./tasks";

const now = new Date("2026-10-08T12:00:00Z");
const inv = (id: string, customer: string, balance: number, due: string | null, number = `INV-${id}`): DebtInvoice => ({ id, invoiceNumber: number, customerKey: customer, customerName: customer.toUpperCase(), balanceMinor: balance, dueDate: due });

describe("aged debt ranking", () => {
  const history = { a: { paidOnTime: 1, paidLate: 9 }, b: { paidOnTime: 10, paidLate: 0 } };

  it("ranks overdue invoices by lateness, size and payment history, with the reasons written down", () => {
    const ranked = rankAgedDebt([inv("1", "a", 200_000, "2026-08-01"), inv("2", "b", 200_000, "2026-08-01"), inv("3", "c", 5_000, "2026-10-05"), inv("4", "a", 100_000, "2026-12-01"), inv("5", "a", 0, "2026-07-01"), inv("6", "a", 50_000, null)], history, now);
    expect(ranked.map((r) => r.invoiceId)).toEqual(["1", "2", "3"]);
    expect(ranked[0]).toMatchObject({ daysOverdue: 68, bucket: "61-90", history: "slow" });
    expect(ranked[0]!.reasons.join(" ")).toMatch(/paid 9 of their last 10 invoices late/);
    expect(ranked[1]!.reasons.join(" ")).toMatch(/normally pay on time/);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    // Not yet due, nothing owed and undated invoices are never chased.
    expect(ranked.map((r) => r.invoiceId)).not.toEqual(expect.arrayContaining(["4", "5", "6"]));
  });

  it("buckets by days overdue, totals them, and caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => inv(String(i), `c${i}`, 10_000 + i, "2026-09-01"));
    expect(rankAgedDebt(many, {}, now, 5)).toHaveLength(5);
    const totals = agedDebtTotals([{ bucket: "1-30", balanceMinor: 100 }, { bucket: "1-30", balanceMinor: 50 }, { bucket: "90+", balanceMinor: 900 }]);
    expect(totals["1-30"]).toEqual({ count: 2, balanceMinor: 150 });
    expect(totals["90+"]).toEqual({ count: 1, balanceMinor: 900 });
    expect([1, 30, 31, 60, 61, 90, 91].map((d) => maxToneFor(d))).toEqual(["friendly", "friendly", "firm", "firm", "final", "final", "final"]);
  });
});

describe("chasing notes task", () => {
  const debts = rankAgedDebt([inv("1", "a", 200_000, "2026-08-01"), inv("3", "c", 5_000, "2026-10-05")], { a: { paidOnTime: 1, paidLate: 9 } }, now);

  it("never lets wording be firmer than the lateness allows, but allows it to be gentler", () => {
    const merged = mergeChaseNotes({ summary: "Two to chase.", accounts: [{ invoiceId: debts[1]!.invoiceId, suggestedAction: "Final demand!", tone: "final" }, { invoiceId: debts[0]!.invoiceId, suggestedAction: "A gentle nudge please.", tone: "friendly" }] }, { debts });
    const recent = merged.accounts.find((a) => a.invoiceId === debts[1]!.invoiceId)!;
    const old = merged.accounts.find((a) => a.invoiceId === debts[0]!.invoiceId)!;
    expect(recent.tone).toBe("friendly");
    expect(old.tone).toBe("friendly");
    expect(old.suggestedAction).toBe("A gentle nudge please.");
  });

  it("only ever returns the invoices it was given, with figures from the record", () => {
    const merged = mergeChaseNotes({ accounts: [{ invoiceId: "invented", suggestedAction: "x", tone: "firm" }] }, { debts });
    expect(merged.accounts.map((a) => a.invoiceId)).toEqual(debts.map((d) => d.invoiceId));
    expect(merged.accounts[0]!.daysOverdue).toBe(debts[0]!.daysOverdue);
    expect(() => mergeChaseNotes("nope", { debts })).toThrow();
    expect(chaseNotesTask.deterministic({ debts }).accounts[0]!.suggestedAction).toMatch(/payment|Escalate|reminder/);
    expect(chaseNotesTask).toMatchObject({ key: "finance.chase_notes", risk: "low", approval: "none", capability: { module: "finance", action: "ai_assist" } });
  });
});

describe("payment matching", () => {
  const invoices = [
    { id: "i1", invoiceNumber: "INV-100", customerKey: "acme", balanceMinor: 120_000, dueDate: "2026-08-01" },
    { id: "i2", invoiceNumber: "INV-101", customerKey: "acme", balanceMinor: 50_000, dueDate: "2026-08-15" },
    { id: "i3", invoiceNumber: "INV-102", customerKey: "acme", balanceMinor: 30_000, dueDate: "2026-09-01" },
    { id: "i4", invoiceNumber: "INV-200", customerKey: "other", balanceMinor: 120_000, dueDate: "2026-08-01" }
  ];

  it("matches an exact amount, preferring the reference when one is given", () => {
    const [exact] = suggestPaymentMatches([{ id: "p1", customerKey: "acme", amountMinor: 50_000, receivedOn: "2026-10-01", reference: null }], invoices);
    expect(exact).toMatchObject({ basis: "exact_amount", confidence: 0.95, allocations: [{ invoiceId: "i2", amountMinor: 50_000 }], leavesUnallocatedMinor: 0 });
    const [ref] = suggestPaymentMatches([{ id: "p2", customerKey: "acme", amountMinor: 50_000, receivedOn: "2026-10-01", reference: "Payment for inv 101 thanks" }], invoices);
    expect(ref).toMatchObject({ basis: "reference_and_amount", confidence: 0.98 });
    const [partRef] = suggestPaymentMatches([{ id: "p3", customerKey: "acme", amountMinor: 40_000, receivedOn: "2026-10-01", reference: "INV-100" }], invoices);
    expect(partRef).toMatchObject({ basis: "reference", allocations: [{ invoiceId: "i1", amountMinor: 40_000 }] });
  });

  it("finds a combination, falls back to a part-payment of the oldest, and never crosses customers", () => {
    const [combo] = suggestPaymentMatches([{ id: "p", customerKey: "acme", amountMinor: 80_000, receivedOn: "2026-10-01", reference: null }], invoices);
    expect(combo).toMatchObject({ basis: "combination", confidence: 0.7 });
    expect(combo!.allocations.map((a) => a.invoiceId).sort()).toEqual(["i2", "i3"]);
    const [partial] = suggestPaymentMatches([{ id: "q", customerKey: "acme", amountMinor: 10_000, receivedOn: "2026-10-01", reference: null }], invoices);
    expect(partial).toMatchObject({ basis: "oldest_first_partial", confidence: 0.4, allocations: [{ invoiceId: "i1", amountMinor: 10_000 }] });
    expect(suggestPaymentMatches([{ id: "r", customerKey: "nobody", amountMinor: 1, receivedOn: "2026-10-01", reference: null }], invoices)).toEqual([]);
    for (const suggestion of suggestPaymentMatches([{ id: "s", customerKey: "acme", amountMinor: 120_000, receivedOn: "2026-10-01", reference: "INV-200" }], invoices)) {
      expect(suggestion.allocations.every((a) => a.invoiceId !== "i4")).toBe(true);
    }
  });

  it("never promises one invoice's balance to two payments in a run, and never allocates more than a payment or a balance", () => {
    const suggestions = suggestPaymentMatches(
      [
        { id: "a", customerKey: "acme", amountMinor: 120_000, receivedOn: "2026-10-01", reference: null },
        { id: "b", customerKey: "acme", amountMinor: 120_000, receivedOn: "2026-10-02", reference: null }
      ],
      invoices
    );
    const claimed = new Map<string, number>();
    for (const suggestion of suggestions) {
      expect(suggestion.allocations.reduce((s, a) => s + a.amountMinor, 0) + suggestion.leavesUnallocatedMinor).toBe(120_000);
      for (const a of suggestion.allocations) claimed.set(a.invoiceId, (claimed.get(a.invoiceId) ?? 0) + a.amountMinor);
    }
    for (const invoice of invoices) expect(claimed.get(invoice.id) ?? 0).toBeLessThanOrEqual(invoice.balanceMinor);
    expect(suggestions[0]!.allocations[0]!.invoiceId).toBe("i1");
    expect(suggestions[1]!.allocations[0]!.invoiceId).not.toBe("i1");
  });

  it("flags ambiguity when several invoices share the amount", () => {
    const twins = [{ id: "x1", invoiceNumber: "A", customerKey: "k", balanceMinor: 100, dueDate: "2026-01-01" }, { id: "x2", invoiceNumber: "B", customerKey: "k", balanceMinor: 100, dueDate: "2026-02-01" }];
    const [s] = suggestPaymentMatches([{ id: "p", customerKey: "k", amountMinor: 100, receivedOn: "2026-10-01", reference: null }], twins);
    expect(s).toMatchObject({ confidence: 0.8, allocations: [{ invoiceId: "x1" }] });
    expect(s!.reasons.join(" ")).toMatch(/2 invoices have that balance/);
  });
});

describe("royalty anomaly detection", () => {
  const stmt = (n: number, royalty: number, territory = "t1", extra: Partial<StatementFacts> = {}): StatementFacts => ({
    id: `s${territory}${n}`, territoryId: territory, territoryName: territory === "t1" ? "Sutton Coldfield" : "Solihull", status: "approved",
    periodStart: `2026-0${n}-01`, periodEnd: `2026-0${n}-28`, calculatedRoyaltyMinor: royalty, adjustmentsMinor: 0, grossRevenueMinor: royalty * 10, ...extra
  });
  const steady = [stmt(1, 100_000), stmt(2, 102_000), stmt(3, 98_000), stmt(4, 101_000)];

  it("is quiet for steady statements and when history is too short to judge", () => {
    expect(detectRoyaltyAnomalies([...steady, stmt(5, 103_000)])).toEqual([]);
    expect(detectRoyaltyAnomalies([stmt(1, 100_000), stmt(2, 900_000)])).toEqual([]);
  });

  it("flags a big swing against the territory's own median, with the figures", () => {
    const flags = detectRoyaltyAnomalies([...steady, stmt(5, 300_000)]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: "swing", severity: "high", territoryName: "Sutton Coldfield" });
    expect(flags[0]!.detail).toMatch(/£3,000\.00.*199% above.*£1,005\.00/);
    expect(detectRoyaltyAnomalies([...steady, stmt(5, 160_000)])[0]).toMatchObject({ kind: "swing", severity: "medium" });
    expect(detectRoyaltyAnomalies([...steady, stmt(5, 40_000)])[0]!.detail).toMatch(/60% below/);
  });

  it("flags zero after positive, heavy adjustments, duplicates and a missing period, and ignores voided statements", () => {
    expect(detectRoyaltyAnomalies([...steady, stmt(5, 0)]).map((f) => f.kind)).toContain("zero_after_positive");
    expect(detectRoyaltyAnomalies([...steady, stmt(5, 100_000, "t1", { adjustmentsMinor: -60_000 })]).map((f) => `${f.kind}:${f.severity}`)).toContain("heavy_adjustments:high");
    expect(detectRoyaltyAnomalies([...steady, stmt(4, 101_000, "t1", { id: "dupe" })]).map((f) => f.kind)).toContain("duplicate_period");
    const gap = [stmt(1, 100_000), stmt(2, 100_000), stmt(3, 100_000), stmt(4, 100_000), { ...stmt(8, 100_000), periodStart: "2026-08-01", periodEnd: "2026-08-28" }];
    expect(detectRoyaltyAnomalies(gap).map((f) => f.kind)).toContain("missing_period");
    expect(detectRoyaltyAnomalies([...steady, stmt(5, 900_000, "t1", { status: "void" })])).toEqual([]);
  });

  it("looks at each territory on its own and orders high severity first", () => {
    const flags = detectRoyaltyAnomalies([...steady, stmt(5, 160_000), ...steady.map((s) => ({ ...s, id: `${s.id}b`, territoryId: "t2", territoryName: "Solihull" })), { ...stmt(5, 400_000), id: "s2x", territoryId: "t2", territoryName: "Solihull" }]);
    expect(flags.map((f) => `${f.territoryName}:${f.severity}`)).toEqual(["Solihull:high", "Sutton Coldfield:medium"]);
  });
});

describe("royalty notes task: financial, so reviewed by someone else and never a conclusion", () => {
  const flags = detectRoyaltyAnomalies([stmt(1, 100_000), stmt(2, 100_000), stmt(3, 100_000), stmt(4, 100_000), stmt(5, 300_000)]);
  function stmt(n: number, royalty: number): StatementFacts {
    return { id: `s${n}`, territoryId: "t1", territoryName: "Sutton Coldfield", status: "approved", periodStart: `2026-0${n}-01`, periodEnd: `2026-0${n}-28`, calculatedRoyaltyMinor: royalty, adjustmentsMinor: 0, grossRevenueMinor: royalty * 10 };
  }

  it("is high risk with mandatory review behind its own permission", () => {
    expect(royaltyNotesTask).toMatchObject({ key: "finance.royalty_notes", risk: "high", approval: "review", capability: { module: "finance", action: "ai_assist" } });
  });

  it("takes only the question from the model: the figures and the notice are fixed", () => {
    const merged = mergeRoyaltyNotes({ summary: "One territory to look at.", questions: [{ key: flags[0]!.key, question: "Was there a one-off booking?" }, { key: "invented:key", question: "Is the franchisee cheating?" }], notice: "All fine" }, { flags });
    expect(merged.questions).toHaveLength(1);
    expect(merged.questions[0]).toMatchObject({ observation: flags[0]!.detail, question: "Was there a one-off booking?", severity: "high" });
    expect(merged.notice).toBe(ROYALTY_NOTICE);
    expect(JSON.stringify(merged)).not.toMatch(/cheating/);
  });

  it("works with no model and with no flags", () => {
    expect(royaltyNotesTask.deterministic({ flags }).questions[0]!.question).toMatch(/known reason/);
    expect(royaltyNotesTask.deterministic({ flags: [] }).summary).toMatch(/No unusual/);
    expect(royaltyNotesTask.summariseInput({ flags })).toEqual({ flags: 1, high: 1 });
  });
});
