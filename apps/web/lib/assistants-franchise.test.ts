import { aiRuns, aiUsageEvents, createDb, fixtureIds } from "@raring2go/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideAiRunAsActor } from "./ai-runtime";
import { generateAgreementComparison, generateFranchiseBriefing, readFranchisePanel } from "./assistants-franchise";

const franchiseId = "00000000-0000-4000-8000-000000000901";
const v1 = "00000000-0000-4000-8000-000000000922";
const v2 = "00000000-0000-4000-8000-000000000923";
const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
const solihull = { ...sutton, territoryId: fixtureIds.territories.solihull };
const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const advertiserUser = { userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser };
const createdRuns: string[] = [];

/** Real database: franchise assistant end to end. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("franchise assistant end to end (postgres)", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "deterministic";
    process.env.AI_SPEND_CAP_NETWORK_MINOR = "100000000";
    process.env.AI_SPEND_CAP_TERRITORY_MINOR = "100000000";
    process.env.AI_ASSIST_RATE_LIMIT = "1000";
  });

  afterAll(async () => {
    const { db, sql } = createDb();
    await db.delete(aiUsageEvents).where(inArray(aiUsageEvents.feature, ["franchise.briefing", "franchise.agreement_comparison"]));
    if (createdRuns.length) await db.delete(aiRuns).where(inArray(aiRuns.id, createdRuns));
    await sql.end();
  });

  it("builds facts from the franchise's own records, with health from the scorecard", async () => {
    const panel = await readFranchisePanel(sutton, franchiseId);
    expect(panel.facts).toMatchObject({ territoryName: "Sutton Coldfield", status: expect.any(String) });
    expect(panel.facts.compliance.total).toBeGreaterThanOrEqual(0);
    expect(panel).toMatchObject({ canAssist: true, canCompare: false, aiConfigured: true, agreementVersions: [], briefing: undefined });
    expect(panel.facts.health === null || typeof panel.facts.health.score === "number").toBe(true);
  });

  it("records a briefing as an informational AI run on the franchise", async () => {
    const { run, output } = await generateFranchiseBriefing(sutton, franchiseId);
    createdRuns.push(run.id);
    expect(run).toMatchObject({ taskKey: "franchise.briefing", approvalState: "not_required", subjectType: "franchise", subjectId: franchiseId, actorUserId: sutton.userId });
    expect(output.summary).toContain("Sutton Coldfield");
    expect((await readFranchisePanel(sutton, franchiseId)).briefing?.runId).toBe(run.id);
  });

  it("agreement comparison is Head Office only, and its output is a high-risk run the requester cannot approve", async () => {
    await expect(generateAgreementComparison(sutton, franchiseId, { fromVersionId: v1, toVersionId: v2 })).rejects.toThrow(/Head Office task/);

    const panel = await readFranchisePanel(hq, franchiseId);
    expect(panel.canCompare).toBe(true);
    expect(panel.agreementVersions.map((version) => version.id)).toEqual(expect.arrayContaining([v1, v2]));

    const { run, output } = await generateAgreementComparison(hq, franchiseId, { fromVersionId: v1, toVersionId: v2 });
    createdRuns.push(run.id);
    expect(run).toMatchObject({ taskKey: "franchise.agreement_comparison", risk: "high", approvalState: "pending", subjectType: "agreement_comparison", subjectId: franchiseId });
    expect(output.notice).toMatch(/not legal advice/);
    expect(output.summary).toMatch(/Standard Franchise Agreement v1\.0 and Standard Franchise Agreement v2\.0|No differences/);
    expect((await readFranchisePanel(hq, franchiseId)).comparison?.runId).toBe(run.id);

    // Four eyes: the person who asked cannot approve their own legal-comparison output.
    await expect(decideAiRunAsActor(hq, run.id, { state: "approved" })).rejects.toThrow();
  });

  it("refuses the same version twice, an unknown version, another territory and an advertiser's login", async () => {
    await expect(generateAgreementComparison(hq, franchiseId, { fromVersionId: v1, toVersionId: v1 })).rejects.toThrow(/two different versions/);
    await expect(generateAgreementComparison(hq, franchiseId, { fromVersionId: v1, toVersionId: "00000000-0000-4000-8000-0000000fffff" })).rejects.toThrow(/not found/);
    await expect(readFranchisePanel(solihull, franchiseId)).rejects.toThrow();
    await expect(generateFranchiseBriefing(solihull, franchiseId)).rejects.toThrow();
    await expect(readFranchisePanel(advertiserUser, franchiseId)).rejects.toThrow();
  });
});
