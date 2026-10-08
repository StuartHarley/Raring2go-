import { describe, expect, it } from "vitest";
import { allowedAmounts, assessRenewalRisk, nextBestActions, packageIdeas } from "./facts";
import type { SalesFacts } from "./facts";
import { advertiserBriefTask, mergeAdvertiserBrief, outreachDraftTask, redactUnknownAmounts } from "./tasks";

const today = "2026-10-08";
const now = new Date(`${today}T00:00:00Z`);

const base: SalesFacts = {
  advertiserName: "Acme Soft Play",
  relationshipState: "retained",
  territoryName: "Sutton Coldfield",
  firstBookedOn: "2025-03-01",
  lastBookedOn: "2026-09-01",
  annualValueMinor: 480_000,
  averageSaleValueMinor: 120_000,
  contacts: 2,
  lastActivityOn: "2026-10-01",
  openOpportunities: [],
  proposals: [],
  bookings: [{ id: "b1", status: "booked", totalMinor: 120_000, bookedOn: "2026-09-01" }],
  finance: { outstandingMinor: 0, overdueMinor: 0, unallocatedMinor: 0 },
  openRenewalPrompts: [],
  fulfilments: { upcoming: 1, fulfilled: 3 },
  packagesBought: ["Half page + digital"]
};
const with_ = (changes: Partial<SalesFacts>): SalesFacts => ({ ...base, ...changes });

describe("renewal risk (rules anyone can read)", () => {
  it("is low for a recent booker with recent contact, and explains why", () => {
    const risk = assessRenewalRisk(base, now);
    expect(risk.level).toBe("low");
    expect(risk.reasons.join(" ")).toMatch(/booked 37 days ago/);
  });

  it("adds a stated reason for every point: overdue money, silence, a lapsing booking, a missed renewal", () => {
    const risk = assessRenewalRisk(
      with_({
        finance: { outstandingMinor: 90_000, overdueMinor: 90_000, unallocatedMinor: 0 },
        lastActivityOn: "2026-07-01",
        lastBookedOn: "2025-10-01",
        bookings: [],
        openRenewalPrompts: [{ id: "r1", dueOn: "2026-09-20" }]
      }),
      now
    );
    expect(risk.level).toBe("high");
    expect(risk.reasons.join("\n")).toMatch(/£900\.00 overdue/);
    expect(risk.reasons.join("\n")).toMatch(/No recorded contact for 99 days/);
    expect(risk.reasons.join("\n")).toMatch(/nothing is in progress/);
    expect(risk.reasons.join("\n")).toMatch(/renewal prompt was due 18 days ago/);
    expect(risk.score).toBeLessThanOrEqual(100);
  });

  it("treats a lapsed advertiser as at least medium, and live work and a recent booking as protective", () => {
    expect(assessRenewalRisk(with_({ relationshipState: "lapsed" }), now).level).toBe("medium");
    const protectedRisk = assessRenewalRisk(
      with_({ lastBookedOn: "2025-11-01", bookings: [], openOpportunities: [{ id: "o1", title: "Winter", stage: "proposal", valueMinor: 100_000, probability: 50, nextAction: "Call", nextActionOn: "2026-10-12", expectedCloseOn: null }] }),
      now
    );
    expect(protectedRisk.level).toBe("low");
    expect(protectedRisk.reasons.join(" ")).toMatch(/next step scheduled/);
  });

  it("never reports 0 reasons, and a missing contact record counts against them", () => {
    expect(assessRenewalRisk(with_({ lastActivityOn: null }), now).reasons.join(" ")).toMatch(/no recorded contact/i);
    expect(assessRenewalRisk(base, now).reasons.length).toBeGreaterThan(0);
  });
});

describe("next best actions", () => {
  it("ranks overdue follow-ups first, then expiring proposals and overdue money, each with its reason", () => {
    const actions = nextBestActions(
      with_({
        finance: { outstandingMinor: 50_000, overdueMinor: 50_000, unallocatedMinor: 0 },
        openOpportunities: [{ id: "o1", title: "Autumn campaign", stage: "negotiation", valueMinor: 200_000, probability: 60, nextAction: "Send revised quote", nextActionOn: "2026-10-03", expectedCloseOn: null }],
        proposals: [{ id: "p1", title: "Winter package", status: "sent", totalMinor: 150_000, validUntil: "2026-10-12", sentOn: "2026-09-28" }]
      }),
      now
    );
    expect(actions[0]).toMatchObject({ priority: 1, action: 'Follow up on "Autumn campaign"' });
    expect(actions[0]!.reason).toMatch(/due 5 days ago/);
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(['Chase the proposal "Winter package"', "Get the overdue invoice resolved before pitching new work"]));
    expect(actions.find((a) => a.action.startsWith("Chase"))!.reason).toMatch(/£1,500\.00.*expires in 4 days/);
    expect(actions.length).toBeLessThanOrEqual(5);
  });

  it("suggests creating an opportunity when nothing is in progress, and asks for a next step on an open one", () => {
    expect(nextBestActions(base, now).map((a) => a.action)).toContain("Create a new opportunity");
    const noStep = nextBestActions(with_({ openOpportunities: [{ id: "o", title: "Spring", stage: "lead", valueMinor: 1, probability: 10, nextAction: null, nextActionOn: null, expectedCloseOn: null }] }), now);
    expect(noStep.map((a) => a.action)).toContain('Set a next step on "Spring"');
  });
});

describe("package ideas", () => {
  const catalogue = [
    { key: "half_digital", name: "Half page + digital", priceMinor: 120_000 },
    { key: "full", name: "Full page", priceMinor: 240_000 },
    { key: "quarter", name: "Quarter page", priceMinor: 70_000 },
    { key: "digital", name: "Digital spotlight", priceMinor: 90_000 }
  ];

  it("offers unbought packages priced near what they usually spend, closest first", () => {
    const ideas = packageIdeas(base, catalogue);
    expect(ideas.map((idea) => idea.key)).toEqual(["digital", "quarter"]);
    expect(ideas[0]!.reason).toMatch(/£900\.00.*£1,200\.00/);
  });

  it("starts a new advertiser with the most accessible packages", () => {
    const ideas = packageIdeas(with_({ averageSaleValueMinor: 0, packagesBought: [] }), catalogue);
    expect(ideas.map((idea) => idea.key)).toEqual(["quarter", "digital", "half_digital"]);
  });
});

describe("advertiser brief task: a model cannot change the numbers", () => {
  const input = { facts: base, catalogue: [{ key: "digital", name: "Digital spotlight", priceMinor: 90_000 }], today };

  it("keeps the computed risk level, score, reasons and action list whatever the model says", () => {
    const merged = mergeAdvertiserBrief(
      {
        summary: "Looks great, no risk at all.",
        renewalRisk: { level: "high", score: 99, explanation: "They are fine." },
        nextBestAction: { action: "Take them for lunch.", why: "Because." },
        objections: [{ objection: "Price?", response: "Offer 90% off." }],
        packageIdeas: [{ name: "Digital spotlight", why: "A cheap way to start." }, { name: "Invented bundle", why: "x" }]
      },
      input
    );
    const truth = assessRenewalRisk(base, now);
    expect(merged.renewalRisk).toMatchObject({ level: truth.level, score: truth.score, reasons: truth.reasons });
    expect(merged.actions).toEqual(nextBestActions(base, now));
    expect(merged.summary).toBe("Looks great, no risk at all.");
    expect(merged.packageIdeas.map((idea) => idea.name)).toEqual(["Digital spotlight"]);
    expect(merged.packageIdeas[0]!.why).toBe("A cheap way to start.");
  });

  it("falls back to the computed brief for anything missing, strips markup, and rejects non-objects", () => {
    const merged = mergeAdvertiserBrief({ summary: "<b>Hi</b>", objections: [{ objection: "", response: "" }] }, input);
    expect(merged.summary).toBe("Hi");
    expect(merged.objections.length).toBeGreaterThan(0);
    expect(merged.nextBestAction.action).toBeTruthy();
    expect(() => mergeAdvertiserBrief("not an object", input)).toThrow();
    expect(() => advertiserBriefTask.parse("nope", input)).toThrow();
  });

  it("is informational, low risk, behind its own permission, and works with no model", () => {
    expect(advertiserBriefTask).toMatchObject({ key: "sales.advertiser_brief", risk: "low", approval: "none", capability: { module: "advertiser", action: "ai_assist" } });
    const out = advertiserBriefTask.deterministic(input);
    expect(out.summary).toContain("Acme Soft Play");
    expect(out.renewalRisk.level).toBe("low");
    expect(advertiserBriefTask.buildUserPrompt(input)).toContain("Computed renewal risk: low");
    expect(JSON.stringify(advertiserBriefTask.summariseInput(input))).not.toContain("@");
  });
});

describe("outreach draft task", () => {
  const facts = with_({ proposals: [{ id: "p1", title: "Winter package", status: "sent", totalMinor: 150_000, validUntil: "2026-10-12", sentOn: null }] });
  const input = { facts, purpose: "follow_up" as const, senderName: "Sam", talkingPoints: "Mention the half-term issue." };

  it("is review-only: a person must accept a draft before it is used", () => {
    expect(outreachDraftTask).toMatchObject({ key: "sales.outreach_draft", risk: "low", approval: "review" });
  });

  it("replaces any money amount that is not in the advertiser's record, and tells the sender", () => {
    const parsed = outreachDraftTask.parse(JSON.stringify({ subject: "Following up", body: "Hello,\n\nOur Winter package is £1,500.00, or I can do £999 if you book today. A £50,000 reach is possible.\n\nSam", notes: "" }), input);
    expect(parsed.body).toContain("£1,500.00");
    expect(parsed.body).not.toContain("£999");
    expect(parsed.body).not.toContain("£50,000");
    expect(parsed.body.match(/\[amount to confirm\]/g)).toHaveLength(2);
    expect(parsed.notes).toMatch(/2 amounts were not in the advertiser's record/);
  });

  it("keeps drafts that use only known amounts, strips markup, and requires a subject and body", () => {
    const ok = outreachDraftTask.parse(JSON.stringify({ subject: "<i>Hi</i>", body: "Hello <b>there</b>.\n\nSam", notes: "check dates" }), input);
    expect(ok).toEqual({ subject: "Hi", body: "Hello there.\n\nSam", notes: "check dates" });
    expect(() => outreachDraftTask.parse(JSON.stringify({ subject: "x" }), input)).toThrow();
    expect(() => outreachDraftTask.parse(JSON.stringify({ body: "x" }), input)).toThrow();
  });

  it("has a template draft for every purpose that uses only known facts and the sender's own words", () => {
    for (const purpose of ["intro", "follow_up", "renewal", "objection_reply", "thank_you"] as const) {
      const draft = outreachDraftTask.deterministic({ ...input, purpose });
      expect(draft.subject.length).toBeGreaterThan(3);
      expect(draft.body).toContain("Sam");
      expect(draft.body).toContain("Mention the half-term issue.");
      expect(draft.body).not.toMatch(/£/);
      expect(draft.notes).toMatch(/without an AI model/);
    }
  });

  it("never reveals the talking points in the stored input summary", () => {
    expect(JSON.stringify(outreachDraftTask.summariseInput(input))).not.toContain("half-term");
    expect(outreachDraftTask.summariseInput(input)).toEqual({ advertiser: "Acme Soft Play", purpose: "follow_up", hasTalkingPoints: true });
  });
});

describe("amount guard", () => {
  it("treats amounts equivalently with or without pence and spacing, and rejects look-alikes", () => {
    const allowed = allowedAmounts(base);
    expect(redactUnknownAmounts("It's £1,200 and £1,200.00 and £ 1,200.00.", allowed).redacted).toBe(0);
    expect(redactUnknownAmounts("It's £1,201.", allowed).redacted).toBe(1);
  });
});
