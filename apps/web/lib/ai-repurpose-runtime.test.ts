import { aiRuns, contentAiTasks, contentChannelVariantVersions, contentChannelVariants, contentDomainEvents, contentItemVersions, contentItems, createDb, fixtureIds } from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveContentVariantAsActor, repurposeContentWithAi } from "./publishing-runtime";

const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
const itemIds: string[] = [];

async function insertItem(overrides: { status: string; territoryId: string | null }) {
  const { db, sql } = createDb();
  try {
    const id = crypto.randomUUID();
    await db.insert(contentItems).values({
      id, title: "Half term adventures", standfirst: "Ideas for families.", contentType: "article", ownerLevel: overrides.territoryId ? "territory" : "network",
      organisationId: overrides.territoryId ? sutton.organisationId : hq.organisationId, territoryId: overrides.territoryId, status: overrides.status, sourceType: "human", tags: ["families"]
    });
    await db.insert(contentItemVersions).values({ id: crypto.randomUUID(), contentItemId: id, versionNumber: 1, status: "approved", snapshot: { title: "Half term adventures", standfirst: "Ideas for families.", body: "Free story time on 12 March at 10:30." } });
    itemIds.push(id);
    return id;
  } finally {
    await sql.end();
  }
}

async function variantsFor(contentItemId: string) {
  const { db, sql } = createDb();
  try {
    const variants = await db.select().from(contentChannelVariants).where(eq(contentChannelVariants.contentItemId, contentItemId));
    const versions = variants.length ? await db.select().from(contentChannelVariantVersions).where(inArray(contentChannelVariantVersions.variantId, variants.map((variant) => variant.id))) : [];
    return { variants, versions };
  } finally {
    await sql.end();
  }
}

describe("AI repurposing end to end (postgres)", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "deterministic";
    process.env.AI_SPEND_CAP_NETWORK_MINOR = "100000000";
    process.env.AI_SPEND_CAP_TERRITORY_MINOR = "100000000";
    process.env.AI_ASSIST_RATE_LIMIT = "1000";
  });

  afterAll(async () => {
    const { db, sql } = createDb();
    if (itemIds.length > 0) {
      const variants = await db.select({ id: contentChannelVariants.id }).from(contentChannelVariants).where(inArray(contentChannelVariants.contentItemId, itemIds));
      if (variants.length > 0) await db.delete(contentChannelVariantVersions).where(inArray(contentChannelVariantVersions.variantId, variants.map((variant) => variant.id)));
      await db.delete(contentAiTasks).where(inArray(contentAiTasks.contentItemId, itemIds));
      await db.delete(contentChannelVariants).where(inArray(contentChannelVariants.contentItemId, itemIds));
      await db.delete(contentDomainEvents).where(inArray(contentDomainEvents.contentItemId, itemIds));
      await db.delete(contentItemVersions).where(inArray(contentItemVersions.contentItemId, itemIds));
      await db.delete(aiRuns).where(inArray(aiRuns.subjectId, itemIds));
      await db.delete(contentItems).where(inArray(contentItems.id, itemIds));
    }
    await sql.end();
  });

  it("creates one linked ai_draft variant per channel from approved content, each with its own AI run", async () => {
    const id = await insertItem({ status: "approved", territoryId: sutton.territoryId });
    const result = await repurposeContentWithAi(sutton, id, ["website", "newsletter", "facebook", "website", "bogus"]);
    expect(result.failed).toEqual([]);
    expect(result.created.map((entry) => entry.channel).sort()).toEqual(["facebook", "newsletter", "website"]);

    const { variants, versions } = await variantsFor(id);
    expect(variants.every((variant) => variant.status === "ai_draft" && variant.territoryId === sutton.territoryId)).toBe(true);
    expect(versions).toHaveLength(3);
    for (const version of versions) {
      expect(version.status).toBe("ai_draft");
      expect(version.provenance).toMatchObject({ generatedBy: "ai", sourceContentItemId: id });
      expect(typeof version.provenance.aiRunId).toBe("string");
    }
    const website = versions.find((version) => "webHeadline" in version.snapshot)!;
    expect(website.snapshot).toMatchObject({ webHeadline: "Half term adventures", slug: "half-term-adventures" });

    const { db, sql } = createDb();
    const runs = await db.select().from(aiRuns).where(eq(aiRuns.subjectId, id));
    await sql.end();
    expect(runs).toHaveLength(3);
    expect(runs.every((run) => run.taskKey === "content.repurpose" && run.approvalState === "pending" && run.actorUserId === sutton.userId)).toBe(true);
  });

  it("approving a variant approves the variant, its version, its task decision and the linked AI run", async () => {
    const id = itemIds[0]!;
    const { variants } = await variantsFor(id);
    const website = variants.find((variant) => variant.channel === "website")!;
    await approveContentVariantAsActor(sutton, website.id);

    const { variants: after, versions } = await variantsFor(id);
    const approved = after.find((variant) => variant.id === website.id)!;
    expect(approved.status).toBe("approved");
    const version = versions.find((entry) => entry.id === approved.currentVersionId)!;
    expect(version).toMatchObject({ status: "approved", approvedByUserId: sutton.userId });

    const { db, sql } = createDb();
    const [task] = await db.select().from(contentAiTasks).where(eq(contentAiTasks.id, version.generatedByTaskId!));
    const [run] = await db.select().from(aiRuns).where(eq(aiRuns.id, String(version.provenance.aiRunId)));
    await sql.end();
    expect(task).toMatchObject({ humanDecision: "accepted", decidedByUserId: sutton.userId });
    expect(run).toMatchObject({ approvalState: "approved", decidedByUserId: sutton.userId });
    expect(run!.appliedAt).not.toBeNull();
  });

  it("regenerating an approved variant never overwrites it: it needs review again and keeps both versions", async () => {
    const id = itemIds[0]!;
    await repurposeContentWithAi(sutton, id, ["website"]);
    const { variants, versions } = await variantsFor(id);
    const website = variants.find((variant) => variant.channel === "website")!;
    expect(website.status).toBe("needs_review");
    expect(versions.filter((version) => version.variantId === website.id).map((version) => version.versionNumber).sort()).toEqual([1, 2]);
  });

  it("refuses unapproved source content and network content from a territory", async () => {
    const draft = await insertItem({ status: "draft", territoryId: sutton.territoryId });
    await expect(repurposeContentWithAi(sutton, draft, ["website"])).rejects.toThrow(/Only approved content/);

    const network = await insertItem({ status: "approved", territoryId: null });
    await expect(repurposeContentWithAi(sutton, network, ["website"])).rejects.toThrow(/outside the active territory|Head Office/);
    expect((await variantsFor(network)).variants).toHaveLength(0);

    const { variants } = await variantsFor(network).then(async () => {
      await repurposeContentWithAi(hq, network, ["newsletter"]);
      return variantsFor(network);
    });
    expect(variants).toHaveLength(1);
    await expect(approveContentVariantAsActor(sutton, variants[0]!.id)).rejects.toThrow();
    await expect(repurposeContentWithAi(hq, network, [])).rejects.toThrow(/at least one channel/);
  });
});
