import { randomUUID } from "node:crypto";
import { aiRuns, aiUsageEvents, createDb, editionPages, fixtureIds, preflightResults } from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assistantErrorCode } from "./assistants-runtime";
import { explainPreflightAsActor, readPreflightPanel } from "./publishing-runtime";

async function listRuns() {
  const { db, sql } = createDb();
  try {
    return await db.select().from(aiRuns).where(eq(aiRuns.subjectId, resultId));
  } finally {
    await sql.end();
  }
}

const pageId = randomUUID();
const resultId = randomUUID();
const EDITION = "00000000-0000-4000-8000-000000001003"; // Autumn 2026 Sutton Coldfield
const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
const solihull = { ...sutton, territoryId: fixtureIds.territories.solihull };
const advertiser = { userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser };

/** Real database: preflight help end to end. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("artwork assistant end to end (postgres)", () => {

  beforeAll(async () => {
    process.env.AI_PROVIDER = "deterministic";
    process.env.AI_SPEND_CAP_NETWORK_MINOR = "100000000";
    process.env.AI_SPEND_CAP_TERRITORY_MINOR = "100000000";
    process.env.AI_ASSIST_RATE_LIMIT = "1000";
    const { db, sql } = createDb();
    await db.insert(editionPages).values({ id: pageId, territoryEditionId: EDITION, pageNumber: 98, spreadNumber: 49, side: "left" });
    await db.insert(preflightResults).values({
      id: resultId,
      entityType: "edition_page",
      entityId: pageId,
      territoryEditionId: EDITION,
      status: "failed",
      checks: [
        { code: "colour_space_rgb", severity: "error", message: "Artwork must use CMYK colour for print.", fixable: true },
        { code: "low_resolution", severity: "error", message: "Placed images must be at least 300dpi for print.", fixable: false }
      ]
    });
    await sql.end();
  });

  afterAll(async () => {
    const { db, sql } = createDb();
    await db.delete(aiUsageEvents).where(eq(aiUsageEvents.feature, "artwork.preflight_help"));
    await db.delete(aiRuns).where(eq(aiRuns.subjectId, resultId));
    await db.delete(preflightResults).where(eq(preflightResults.id, resultId));
    await db.delete(editionPages).where(inArray(editionPages.id, [pageId]));
    await sql.end();
  });

  it("shows the analysis without any model, with honest verdicts", async () => {
    const panel = await readPreflightPanel(sutton, EDITION);
    const entry = panel.results.find((result) => result.id === resultId)!;
    expect(entry).toMatchObject({ pageNumber: 98, ai: undefined });
    expect(entry.analysis).toMatchObject({ readyForPrint: false, blockers: 2, needsNewArtwork: 1 });
    expect(entry.analysis.items.find((item) => item.code === "low_resolution")!.fixability).toBe("needs_new_artwork");
    expect(panel).toMatchObject({ canAssist: true, aiConfigured: true });
  });

  it("records an AI run for the preflight result, shows it afterwards, and the verdicts do not move", async () => {
    const { run } = await explainPreflightAsActor(sutton, EDITION, resultId);
    expect(run).toMatchObject({ taskKey: "artwork.preflight_help", status: "succeeded", approvalState: "not_required", subjectType: "preflight_result", subjectId: resultId, actorUserId: sutton.userId });
    expect(run.input).toMatchObject({ errors: 2, checkCodes: ["colour_space_rgb", "low_resolution"] });

    const entry = (await readPreflightPanel(sutton, EDITION)).results.find((result) => result.id === resultId)!;
    expect(entry.ai?.run.id).toBe(run.id);
    expect(entry.ai?.output).toMatchObject({ readyForPrint: false, blockers: 2 });
    expect(entry.ai?.output.items.find((item) => item.code === "low_resolution")!.fixability).toBe("needs_new_artwork");
    expect(entry.ai?.output.summary).toMatch(/not ready for print/);
  });

  it("refuses an edition outside the actor's territory and a person without the assistant permission", async () => {
    // A territory the actor does not belong to: neither the panel nor the assistant can be reached.
    await expect(explainPreflightAsActor(solihull, EDITION, resultId)).rejects.toThrow();
    await expect(readPreflightPanel(solihull, EDITION)).rejects.toThrow();
    // An advertiser has no edition or assistant permission at all.
    await expect(explainPreflightAsActor(advertiser as never, EDITION, resultId)).rejects.toThrow();
    const runsForResult = await listRuns();
    expect(runsForResult.every((run) => run.actorUserId === sutton.userId)).toBe(true);
  });

  it("maps failures to fixed, user-safe codes", () => {
    expect(assistantErrorCode(new Error("boom"))).toBeUndefined();
    expect(assistantErrorCode(new Error("AI assist is not configured for this environment."))).toBe("ai_not_configured");
  });
});
