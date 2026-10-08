import { describe, expect, it } from "vitest";
import { diffAgreementContent, diffMergeFields } from "./diff";
import { attentionItems, healthInsight, onboardingGuidance } from "./facts";
import type { FranchiseFacts } from "./facts";
import { agreementComparisonTask, AGREEMENT_NOTICE, franchiseBriefingTask, mergeAgreementComparison, mergeFranchiseBriefing } from "./tasks";

const today = "2026-10-08";
const now = new Date(`${today}T00:00:00Z`);

const facts: FranchiseFacts = {
  franchiseName: "Raring2go Sutton Coldfield",
  territoryName: "Sutton Coldfield",
  lifecycleStage: "onboarding",
  status: "active",
  launchDate: null,
  renewalDate: "2026-11-15",
  onboarding: {
    status: "in_progress",
    progressPercent: 40,
    targetLaunchOn: "2026-11-01",
    launchReady: false,
    openBlockers: [{ title: "Waiting for DBS check", notes: "Applicant has not replied" }],
    tasks: [
      { id: "t1", title: "Submit insurance certificate", phase: "Compliance", ownerType: "franchisee", dueOn: "2026-10-03", required: true, status: "in_progress", waitingOn: [] },
      { id: "t2", title: "Complete brand training", phase: "Training", ownerType: "franchisee", dueOn: "2026-10-15", required: true, status: "not_started", waitingOn: [] },
      { id: "t3", title: "Set up newsletter domain", phase: "Marketing", ownerType: "hq", dueOn: "2026-10-30", required: true, status: "not_started", waitingOn: ["Complete brand training"] },
      { id: "t4", title: "Done thing", phase: "Setup", ownerType: "hq", dueOn: "2026-09-01", required: true, status: "completed", waitingOn: [] },
      { id: "t5", title: "Held up", phase: "Setup", ownerType: "hq", dueOn: "2026-09-01", required: false, status: "blocked", waitingOn: [] }
    ]
  },
  compliance: {
    complete: 2,
    total: 4,
    missing: ["Public liability evidence"],
    expiring: [{ name: "First aid certificate", expiresOn: "2026-10-20", withinDays: 12 }],
    openActions: [{ id: "a1", title: "Upload signed policies", severity: "high", dueOn: "2026-10-01" }]
  },
  insurance: { policies: [{ provider: "Acme Insurance", endsOn: "2026-10-30", verification: "pending" }] },
  agreement: { status: "sent_for_signature", version: "2.1" },
  health: { score: 48, band: "red", configVersion: 2, weakest: [{ metric: "commercial.overdue_share", label: "Overdue share of invoices", normalised: 20, raw: 45 }, { metric: "audience.subscribers", label: "Subscribers", normalised: 55, raw: 900 }], strongest: [{ metric: "operations.tasks_overdue", label: "Overdue tasks", normalised: 100 }] }
};

describe("onboarding guidance", () => {
  const steps = onboardingGuidance(facts, now);

  it("puts blockers and overdue work first, then what is due soon, and never suggests a task that is waiting on another", () => {
    expect(steps[0]).toMatchObject({ priority: 1, title: "Resolve the blocker: Waiting for DBS check" });
    expect(steps.map((s) => s.title)).toContain("Submit insurance certificate");
    expect(steps.find((s) => s.title === "Submit insurance certificate")!.reason).toMatch(/due 5 days ago/);
    expect(steps.find((s) => s.title === "Complete brand training")).toMatchObject({ priority: 2 });
    expect(steps.map((s) => s.title)).not.toContain("Set up newsletter domain");
    expect(steps.map((s) => s.title)).not.toContain("Done thing");
    expect(steps.map((s) => s.title)).not.toContain("Held up");
    expect(steps.some((s) => /waiting on earlier tasks/.test(s.title))).toBe(true);
  });

  it("states what remains before launch, and is quiet when launch ready", () => {
    expect(steps.find((s) => s.title.startsWith("Finish the"))!.reason).toMatch(/targeted for 2026-11-01.*in 24 days.*40%/);
    const ready = onboardingGuidance({ ...facts, onboarding: { ...facts.onboarding, launchReady: true, openBlockers: [], tasks: [] } }, now);
    expect(ready).toEqual([]);
  });
});

describe("attention items", () => {
  const items = attentionItems(facts, now);

  it("ranks high severity first and states each reason with its dates", () => {
    expect(items[0]!.severity).toBe("high");
    const messages = items.map((i) => i.message).join("\n");
    expect(messages).toMatch(/Public liability evidence has not been provided/);
    expect(messages).toMatch(/First aid certificate expires in 12 days/);
    expect(messages).toMatch(/Upload signed policies \(overdue since 2026-10-01\)/);
    expect(messages).toMatch(/Acme Insurance cover ends in 22 days/);
    expect(messages).toMatch(/not been verified \(pending\)/);
    expect(messages).toMatch(/due for renewal in 38 days/);
    expect(messages).toMatch(/agreement is sent for signature, not yet signed/);
  });

  it("is empty for a franchise with nothing wrong", () => {
    const clean: FranchiseFacts = { ...facts, renewalDate: null, compliance: { complete: 4, total: 4, missing: [], expiring: [], openActions: [] }, insurance: { policies: [{ provider: "Acme", endsOn: "2027-06-01", verification: "verified" }] }, agreement: { status: "executed", version: "2.1" } };
    expect(attentionItems(clean, now)).toEqual([]);
  });

  it("flags expired cover and no policy at all", () => {
    expect(attentionItems({ ...facts, insurance: { policies: [{ provider: "Old", endsOn: "2026-09-01", verification: "verified" }] } }, now).map((i) => i.message).join(" ")).toMatch(/Old cover ended 37 days ago/);
    expect(attentionItems({ ...facts, insurance: { policies: [] } }, now).map((i) => i.message)).toContain("No insurance policy is recorded.");
  });
});

describe("health insight", () => {
  it("names the weakest measure with a fixed suggestion, and only genuine strengths", () => {
    const insight = healthInsight(facts.health!);
    expect(insight.summary).toMatch(/48 out of 100 \(red\).*weakest measure is overdue share of invoices/);
    expect(insight.weaknesses[0]).toMatchObject({ score: 20, advice: expect.stringContaining("chase the oldest first") });
    expect(insight.weaknesses).toHaveLength(2);
    expect(insight.strengths).toEqual([{ label: "Overdue tasks", score: 100 }]);
    expect(healthInsight({ ...facts.health!, score: null, weakest: [], strongest: [] }).summary).toMatch(/not yet enough data/);
  });
});

describe("franchise briefing task: lists are computed, the model writes two sentences", () => {
  const input = { facts, today };

  it("keeps the computed steps, attention items and health whatever the model says", () => {
    const merged = mergeFranchiseBriefing({ summary: "All is well, no action needed.", supportNote: "Send flowers.", nextSteps: [], attention: [], health: null }, input);
    expect(merged.summary).toBe("All is well, no action needed.");
    expect(merged.nextSteps.length).toBeGreaterThan(0);
    expect(merged.attention.length).toBeGreaterThan(0);
    expect(merged.health?.weaknesses.length).toBeGreaterThan(0);
  });

  it("falls back to a computed summary and works with no model", () => {
    const none = franchiseBriefingTask.deterministic(input);
    expect(none.summary).toContain("Raring2go Sutton Coldfield");
    expect(none.supportNote).toMatch(/^Start with:/);
    expect(mergeFranchiseBriefing({}, input).summary).toBe(none.summary);
    expect(() => mergeFranchiseBriefing([], input)).toThrow();
    expect(franchiseBriefingTask).toMatchObject({ key: "franchise.briefing", risk: "low", approval: "none", capability: { module: "franchise", action: "ai_assist" } });
    expect(franchiseBriefingTask.buildUserPrompt(input)).toContain("Needs attention:");
  });
});

describe("agreement comparison", () => {
  const before = { clauses: [{ id: "fee", text: "Royalty is 10% of invoiced revenue." }, { id: "term", text: "The term is five years." }], territory: "Sutton Coldfield", notes: "x" };
  const after = { clauses: [{ id: "fee", text: "Royalty is 12% of invoiced revenue." }, { id: "term", text: "The term is five years." }, { id: "exit", text: "Either party may terminate on 90 days notice." }], territory: "Sutton Coldfield" };

  it("reports added, removed and changed text exactly, and nothing for unchanged text", () => {
    const { changes, total, truncated } = diffAgreementContent(before, after);
    expect(changes).toEqual([
      { path: "clauses[0].text", kind: "changed", before: "Royalty is 10% of invoiced revenue.", after: "Royalty is 12% of invoiced revenue." },
      { path: "clauses[2].id", kind: "added", after: "exit" },
      { path: "clauses[2].text", kind: "added", after: "Either party may terminate on 90 days notice." },
      { path: "notes", kind: "removed", before: "x" }
    ]);
    expect(total).toBe(4);
    expect(truncated).toBe(false);
    expect(diffAgreementContent(before, before).changes).toEqual([]);
  });

  it("caps long lists, normalises whitespace and bounds text length", () => {
    const wide = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${String(i).padStart(2, "0")}`, `v${i}`]));
    const diff = diffAgreementContent({}, wide, 40);
    expect(diff.changes).toHaveLength(40);
    expect(diff).toMatchObject({ truncated: true, total: 80 });
    expect(diffAgreementContent({ a: "x" }, { a: "  x \n" }).changes).toEqual([]);
    expect(diffAgreementContent({}, { a: "y".repeat(2000) }).changes[0]!.after!.length).toBe(600);
    expect(diffMergeFields(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
  });

  const comparison = { fromLabel: "Standard agreement v1", toLabel: "Standard agreement v2", ...(() => { const d = diffAgreementContent(before, after); return { changes: d.changes, truncated: d.truncated }; })(), mergeFieldsBefore: ["franchisee_name"], mergeFieldsAfter: ["franchisee_name", "territory_name"] };

  it("takes only a comment per change from the model: the changed text, the notice and the merge fields are fixed", () => {
    const merged = mergeAgreementComparison(
      { summary: "The fee rises and an exit clause is added.", changes: [{ path: "clauses[0].text", whyItMatters: "Affects the royalty paid." }, { path: "clauses[9].text", whyItMatters: "Invented." }], notice: "This is fine and legally sound." },
      comparison
    );
    expect(merged.changes.map((c) => c.path)).toEqual(comparison.changes.map((c) => c.path));
    expect(merged.changes[0]).toMatchObject({ kind: "changed", before: "Royalty is 10% of invoiced revenue.", after: "Royalty is 12% of invoiced revenue.", whyItMatters: "Affects the royalty paid." });
    expect(merged.notice).toBe(AGREEMENT_NOTICE);
    expect(merged.mergeFields).toEqual({ added: ["territory_name"], removed: [] });
    expect(JSON.stringify(merged)).not.toMatch(/Invented|legally sound/);
  });

  it("is high risk with mandatory review, behind its own permission, and works with no model", () => {
    expect(agreementComparisonTask).toMatchObject({ key: "franchise.agreement_comparison", risk: "high", approval: "review", capability: { module: "franchise", action: "ai_assist" } });
    const none = agreementComparisonTask.deterministic(comparison);
    expect(none.summary).toMatch(/4 differences found between Standard agreement v1 and Standard agreement v2/);
    expect(none.notice).toBe(AGREEMENT_NOTICE);
    expect(agreementComparisonTask.deterministic({ ...comparison, changes: [], mergeFieldsAfter: ["franchisee_name"] }).summary).toMatch(/No differences were found/);
    expect(agreementComparisonTask.summariseInput(comparison)).toEqual({ from: "Standard agreement v1", to: "Standard agreement v2", differences: 4, truncated: false });
    expect(agreementComparisonTask.buildUserPrompt(comparison)).toContain("path=clauses[0].text kind=changed");
  });
});
