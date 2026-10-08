import { aiRuns, aiUsageEvents, createDb, fixtureIds } from "@raring2go/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideAiRunAsActor } from "./ai-runtime";
import { generateAdvertiserBrief, generateOutreachDraft, readSalesPanel } from "./assistants-sales";

const advertiserId = fixtureIds.advertisers.example;
const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const solihull = { ...sutton, territoryId: fixtureIds.territories.solihull };
const advertiserUser = { userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser };
const createdRuns: string[] = [];

/** Real database: sales assistant end to end. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("sales assistant end to end (postgres)", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "deterministic";
    process.env.AI_SPEND_CAP_NETWORK_MINOR = "100000000";
    process.env.AI_SPEND_CAP_TERRITORY_MINOR = "100000000";
    process.env.AI_ASSIST_RATE_LIMIT = "1000";
  });

  afterAll(async () => {
    const { db, sql } = createDb();
    await db.delete(aiUsageEvents).where(inArray(aiUsageEvents.feature, ["sales.advertiser_brief", "sales.outreach_draft"]));
    if (createdRuns.length) await db.delete(aiRuns).where(inArray(aiRuns.id, createdRuns));
    await sql.end();
  });

  it("builds facts from the real CRM record, with no model involved", async () => {
    const panel = await readSalesPanel(sutton, advertiserId);
    expect(panel.facts.advertiserName).toBeTruthy();
    expect(panel.facts.territoryName).toBe("Sutton Coldfield");
    expect(panel.facts.finance.outstandingMinor).toBeGreaterThanOrEqual(0);
    expect(panel).toMatchObject({ aiConfigured: true, brief: undefined, draft: undefined });
  });

  it("records a brief against the advertiser; the computed risk stays whatever the provider says", async () => {
    const { run, output } = await generateAdvertiserBrief(sutton, advertiserId);
    createdRuns.push(run.id);
    expect(run).toMatchObject({ taskKey: "sales.advertiser_brief", status: "succeeded", approvalState: "not_required", subjectType: "advertiser", subjectId: advertiserId, actorUserId: sutton.userId });
    expect(["low", "medium", "high"]).toContain(output.renewalRisk.level);
    expect(run.input).not.toHaveProperty("facts");

    const panel = await readSalesPanel(sutton, advertiserId);
    expect(panel.brief?.runId).toBe(run.id);
  });

  it("an email draft waits for a person, who can mark it reviewed; it is never sent", async () => {
    const { run } = await generateOutreachDraft(sutton, advertiserId, { purpose: "follow_up", senderName: "Sam", talkingPoints: "Mention half term." });
    createdRuns.push(run.id);
    expect(run).toMatchObject({ taskKey: "sales.outreach_draft", approvalState: "pending", status: "succeeded" });
    expect(JSON.stringify(run.input)).not.toContain("half term");

    const before = await readSalesPanel(sutton, advertiserId);
    expect(before.draft).toMatchObject({ runId: run.id, approvalState: "pending" });
    expect(before.draft!.output.body).toContain("Mention half term.");

    await decideAiRunAsActor(sutton, run.id, { state: "approved" });
    expect((await readSalesPanel(sutton, advertiserId)).draft?.approvalState).toBe("approved");
  });

  it("works for Head Office, and refuses another territory and an advertiser's own login", async () => {
    await expect(readSalesPanel(hq, advertiserId)).resolves.toBeDefined();
    await expect(readSalesPanel(solihull, advertiserId)).rejects.toThrow();
    await expect(generateAdvertiserBrief(solihull, advertiserId)).rejects.toThrow();
    await expect(readSalesPanel(advertiserUser, advertiserId)).rejects.toThrow();
    await expect(generateAdvertiserBrief(advertiserUser, advertiserId)).rejects.toThrow();
  });
});
