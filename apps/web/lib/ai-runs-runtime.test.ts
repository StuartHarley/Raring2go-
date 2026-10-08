import { aiRuns, createDb, fixtureIds, fixturePermissionData } from "@raring2go/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Control the gateway the runtime builds, so success and failure paths are both exercised
// against the real database without a network call.
const gatewayState: { failWith?: Error } = {};

vi.mock("@raring2go/ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@raring2go/ai")>();
  const deterministic = original.createDeterministicAiGateway();
  return {
    ...original,
    createAiGatewayFromEnv: () => ({
      ...deterministic,
      async generateSubjectLines(input: Parameters<typeof deterministic.generateSubjectLines>[0]) {
        if (gatewayState.failWith) throw gatewayState.failWith;
        return deterministic.generateSubjectLines(input);
      }
    })
  };
});

const { recordAiSuggestionAccepted, suggestSubjectLines } = await import("./ai-runtime");

const context = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const draftId = crypto.randomUUID();

async function runsForDraft() {
  const { db, sql } = createDb();
  try {
    return await db.select().from(aiRuns).where(and(eq(aiRuns.subjectType, "email_campaign_draft"), eq(aiRuns.subjectId, draftId)));
  } finally {
    await sql.end();
  }
}

describe("newsletter AI runs are recorded", () => {
  beforeAll(() => {
    process.env.AI_SPEND_CAP_NETWORK_MINOR = "100000000";
    process.env.AI_ASSIST_RATE_LIMIT = "1000";
  });

  afterAll(async () => {
    const { db, sql } = createDb();
    await db.delete(aiRuns).where(eq(aiRuns.subjectId, draftId));
    await sql.end();
  });

  it("records actor, purpose, source draft, input, output and a pending approval for a suggestion", async () => {
    const lines = await suggestSubjectLines(context, { draftId, campaignTitle: "Half term ideas", bodyPreviewText: "Come along" });
    expect(lines).toHaveLength(3);

    const [run] = await runsForDraft();
    expect(run).toMatchObject({
      taskKey: "marketing.subject_lines",
      status: "succeeded",
      approvalState: "pending",
      actorType: "human",
      actorUserId: context.userId,
      organisationId: context.organisationId,
      providerKey: "deterministic",
      subjectType: "email_campaign_draft"
    });
    expect(run!.input).toMatchObject({ campaignTitle: "Half term ideas" });
    expect(run!.sourceRefs).toEqual([{ type: "email_campaign_draft", id: draftId }]);
    expect(run!.output).toEqual({ result: lines });
  });

  it("approves and applies the user's latest pending run when they accept a suggestion", async () => {
    await recordAiSuggestionAccepted(context, { draftId, task: "subject_lines", accepted: "Half term ideas — inside this week" });
    const runs = await runsForDraft();
    const accepted = runs.filter((run) => run.approvalState === "approved");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ decidedByUserId: context.userId });
    expect(accepted[0]!.appliedAt).not.toBeNull();
  });

  it("records a failed run, with no output, when the model call fails", async () => {
    gatewayState.failWith = new Error("upstream 529 overloaded");
    await expect(suggestSubjectLines(context, { draftId, campaignTitle: "x", bodyPreviewText: "y" })).rejects.toThrow("overloaded");
    gatewayState.failWith = undefined;

    const failed = (await runsForDraft()).filter((run) => run.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ approvalState: "not_required", output: {}, error: "upstream 529 overloaded" });
  });
});

describe("AI run permissions", async () => {
  const { hasAiRunCapability } = await import("./ai-runtime");
  const { requireShellPermission } = await import("./app-shell");
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const permissions = fixturePermissionData();

  it("gives HQ and a franchisee (for their own territory) view and decide; nobody else", () => {
    expect(hasAiRunCapability(permissions, context, "view")).toBe(true);
    expect(hasAiRunCapability(permissions, context, "decide")).toBe(true);
    expect(hasAiRunCapability(permissions, sutton, "view")).toBe(true);
    expect(hasAiRunCapability(permissions, sutton, "decide")).toBe(true);
    expect(hasAiRunCapability(permissions, { userId: "someone-else" }, "view")).toBe(false);
  });

  it("protects the route server-side", async () => {
    await expect(requireShellPermission({}, { module: "ai.run", action: "view" })).rejects.toMatchObject({ kind: "unauthenticated" });
    await expect(
      requireShellPermission({ sessionKey: "franchisee", organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield }, { module: "ai.run", action: "view" })
    ).resolves.toMatchObject({ kind: "authenticated" });
  });
});
