import { describe, expect, it } from "vitest";
import { SCORING_VERSION, scoreOpportunity, signalsFor } from "./scoring";
import type { Opportunity, PipelineStage } from "./types";

const now = new Date("2026-10-10T12:00:00Z");
const stage = (over: Partial<PipelineStage> = {}): PipelineStage => ({ id: "s", key: "proposal", name: "Proposal", sortOrder: 3, probabilityDefault: 50, isClosed: false, outcome: null, ...over });
const opportunity = (over: Partial<Opportunity> = {}): Opportunity => ({ id: "o", advertiserId: "a", territoryId: "t", stageId: "s", source: "manual", title: "Full page", estimatedValueMinor: 250_000, currency: "GBP", probability: 60, expectedCloseDate: "2026-10-30", nextActionDate: "2026-10-14", ...over });
const quiet = { lastActivityAt: null, openProposal: false, previousBookings: 0, overdueTasks: 0 };
const points = (score: ReturnType<typeof scoreOpportunity>, key: string) => score!.factors.find((factor) => factor.key === key)?.points;

describe("opportunity scoring", () => {
  it("scores a healthy open deal high, with every factor explained", () => {
    const score = scoreOpportunity(opportunity(), stage(), { lastActivityAt: new Date("2026-10-08T09:00:00Z"), openProposal: true, previousBookings: 2, overdueTasks: 0 }, now)!;
    expect(score.version).toBe(SCORING_VERSION);
    expect(score.factors.map((f) => f.key)).toEqual(["stage", "value", "recency", "next_action", "close", "proposal", "history"]);
    expect(points(score, "stage")).toBe(21);
    expect(points(score, "value")).toBe(10);
    expect(points(score, "recency")).toBe(15);
    expect(points(score, "close")).toBe(10);
    expect(score.score).toBe(21 + 10 + 15 + 10 + 10 + 10 + 10);
    expect(score.band).toBe("hot");
    expect(score.factors.every((f) => f.label && f.detail)).toBe(true);
  });
  it("penalises a neglected deal and clamps to the 0 to 100 range", () => {
    const cold = scoreOpportunity(opportunity({ probability: 5, estimatedValueMinor: 10_000, nextActionDate: null, expectedCloseDate: "2026-09-01" }), stage(), { ...quiet, overdueTasks: 3 }, now)!;
    expect(points(cold, "recency")).toBe(-15);
    expect(points(cold, "next_action")).toBe(-5);
    expect(points(cold, "close")).toBe(-5);
    expect(points(cold, "tasks")).toBe(-10);
    expect(cold.score).toBe(0);
    expect(cold.band).toBe("cold");
    const maxed = scoreOpportunity(opportunity({ probability: 100, estimatedValueMinor: 900_000 }), stage(), { lastActivityAt: now, openProposal: true, previousBookings: 5, overdueTasks: 0 }, now)!;
    expect(maxed.score).toBeLessThanOrEqual(100);
  });
  it("scores recency and next-step timing in bands", () => {
    const at = (daysAgo: number) => scoreOpportunity(opportunity(), stage(), { ...quiet, lastActivityAt: new Date(now.getTime() - daysAgo * 86_400_000) }, now);
    expect([3, 10, 20, 45].map((d) => points(at(d), "recency"))).toEqual([15, 8, 0, -10]);
    expect(points(scoreOpportunity(opportunity({ nextActionDate: "2026-10-09" }), stage(), quiet, now), "next_action")).toBe(-10);
    expect(points(scoreOpportunity(opportunity({ nextActionDate: "2026-10-10" }), stage(), quiet, now), "next_action")).toBe(10);
  });
  it("does not score closed opportunities", () => {
    expect(scoreOpportunity(opportunity(), stage({ isClosed: true, outcome: "won" }), quiet, now)).toBeNull();
  });
  it("derives signals from an advertiser's own records only", () => {
    const data = {
      activityEvents: [
        { id: "1", advertiserId: "a", createdAt: "2026-10-01T00:00:00Z" }, { id: "2", advertiserId: "a", createdAt: new Date("2026-10-05T00:00:00Z") },
        { id: "3", advertiserId: "other", createdAt: "2026-10-09T00:00:00Z" }, { id: "4", advertiserId: "a", createdAt: "2026-10-09T00:00:00Z", deletedAt: new Date() }
      ],
      proposals: [{ advertiserId: "a", status: "sent" }, { advertiserId: "other", status: "sent" }, { advertiserId: "a", status: "draft" }],
      bookings: [{ advertiserId: "a" }, { advertiserId: "a", deletedAt: new Date() }, { advertiserId: "other" }],
      tasks: [
        { id: "t1", advertiserId: "a", status: "open", dueOn: "2026-10-01" }, { id: "t2", advertiserId: "a", status: "open", dueOn: "2026-10-20" },
        { id: "t3", advertiserId: "a", status: "done", dueOn: "2026-09-01" }, { id: "t4", advertiserId: "other", status: "open", dueOn: "2026-09-01" }
      ]
    } as never;
    expect(signalsFor("a", data, now)).toEqual({ lastActivityAt: new Date("2026-10-05T00:00:00Z"), openProposal: true, previousBookings: 1, overdueTasks: 1 });
  });
});
