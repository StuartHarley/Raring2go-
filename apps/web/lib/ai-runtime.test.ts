import { aiUsageEvents, createDb, fixtureIds } from "@raring2go/db";
import { describe, expect, it } from "vitest";
import { enforceAiSpendCap, estimateCostMinor, sumAiSpendForPeriod } from "./ai-runtime";

const networkContext = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const territoryContext = {
  userId: fixtureIds.users.franchisee,
  organisationId: fixtureIds.organisations.franchise,
  territoryId: fixtureIds.territories.suttonColdfield
};

async function insertUsageRow(input: {
  organisationId: string;
  territoryId?: string | null;
  estimatedCostMinor: number;
  createdAt: Date;
}) {
  const { db, sql } = createDb();
  try {
    await db.insert(aiUsageEvents).values({
      organisationId: input.organisationId,
      territoryId: input.territoryId ?? null,
      actorUserId: null,
      feature: "test_fixture",
      providerKey: "test",
      modelReference: "test-model",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMinor: input.estimatedCostMinor,
      createdAt: input.createdAt
    });
  } finally {
    await sql.end();
  }
}

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

describe("estimateCostMinor", () => {
  it("computes cost from a known model's per-token pricing", () => {
    // claude-haiku-4-5-20251001: 100c/1M input, 500c/1M output
    expect(estimateCostMinor("claude-haiku-4-5-20251001", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(100);
    expect(estimateCostMinor("claude-haiku-4-5-20251001", { inputTokens: 0, outputTokens: 1_000_000 })).toBe(500);
  });

  it("rounds a fractional cent up rather than down or to nearest", () => {
    expect(estimateCostMinor("claude-haiku-4-5-20251001", { inputTokens: 1, outputTokens: 0 })).toBe(1);
  });

  it("falls back to the conservative default pricing for an unrecognised model", () => {
    const known = estimateCostMinor("claude-haiku-4-5-20251001", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const unknown = estimateCostMinor("some-future-model", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(unknown).toBeGreaterThan(known);
  });
});

describe("sumAiSpendForPeriod", () => {
  it("sums only this organisation's rows from the current period, excluding an earlier period and another org", async () => {
    const context = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
    const before = await sumAiSpendForPeriod(context, { since: startOfCurrentMonthUtc() });

    const lastMonth = new Date(startOfCurrentMonthUtc());
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    lastMonth.setUTCDate(15);

    await insertUsageRow({ organisationId: fixtureIds.organisations.hq, estimatedCostMinor: 700, createdAt: lastMonth });
    await insertUsageRow({ organisationId: fixtureIds.organisations.hq, estimatedCostMinor: 300, createdAt: new Date() });
    await insertUsageRow({ organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.solihull, estimatedCostMinor: 900, createdAt: new Date() });

    const after = await sumAiSpendForPeriod(context, { since: startOfCurrentMonthUtc() });

    expect(after - before).toBe(300);
  });

  it("scopes a territory actor to their own territory, not the whole organisation", async () => {
    const before = await sumAiSpendForPeriod(territoryContext, { since: startOfCurrentMonthUtc() });

    await insertUsageRow({
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield,
      estimatedCostMinor: 250,
      createdAt: new Date()
    });
    await insertUsageRow({
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.solihull,
      estimatedCostMinor: 999,
      createdAt: new Date()
    });

    const after = await sumAiSpendForPeriod(territoryContext, { since: startOfCurrentMonthUtc() });

    expect(after - before).toBe(250);
  });
});

describe("enforceAiSpendCap", () => {
  const originalNetworkCap = process.env.AI_SPEND_CAP_NETWORK_MINOR;
  const originalTerritoryCap = process.env.AI_SPEND_CAP_TERRITORY_MINOR;

  it("allows a call when spend is under the configured cap, and throws once it's reached", async () => {
    const spentBefore = await sumAiSpendForPeriod(networkContext, { since: startOfCurrentMonthUtc() });
    process.env.AI_SPEND_CAP_NETWORK_MINOR = String(spentBefore + 500);

    await expect(enforceAiSpendCap(networkContext)).resolves.toBeUndefined();

    await insertUsageRow({ organisationId: fixtureIds.organisations.hq, estimatedCostMinor: 500, createdAt: new Date() });

    await expect(enforceAiSpendCap(networkContext)).rejects.toThrow("AI spend limit reached");

    if (originalNetworkCap === undefined) delete process.env.AI_SPEND_CAP_NETWORK_MINOR;
    else process.env.AI_SPEND_CAP_NETWORK_MINOR = originalNetworkCap;
  });

  it("enforces the territory cap independently of the network cap", async () => {
    const spentBefore = await sumAiSpendForPeriod(territoryContext, { since: startOfCurrentMonthUtc() });
    process.env.AI_SPEND_CAP_TERRITORY_MINOR = String(spentBefore + 100);

    await expect(enforceAiSpendCap(territoryContext)).resolves.toBeUndefined();

    await insertUsageRow({
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield,
      estimatedCostMinor: 100,
      createdAt: new Date()
    });

    await expect(enforceAiSpendCap(territoryContext)).rejects.toThrow("AI spend limit reached for this territory");

    if (originalTerritoryCap === undefined) delete process.env.AI_SPEND_CAP_TERRITORY_MINOR;
    else process.env.AI_SPEND_CAP_TERRITORY_MINOR = originalTerritoryCap;
  });
});
