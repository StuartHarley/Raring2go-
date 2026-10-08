import { aiRuns, contentDomainEvents, contentItemVersions, contentItems, createDb, fixtureIds } from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptContentDraft, readContentDraftRun, rejectContentDraft, requestContentDraft } from "./publishing-runtime";

const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
const createdItems: string[] = [];
const createdRuns: string[] = [];

async function track<T extends { id: string }>(run: T) {
  createdRuns.push(run.id);
  return run;
}

describe("AI content drafts end to end (postgres)", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "deterministic";
    process.env.AI_SPEND_CAP_NETWORK_MINOR = "100000000";
    process.env.AI_SPEND_CAP_TERRITORY_MINOR = "100000000";
    process.env.AI_ASSIST_RATE_LIMIT = "1000";
  });

  afterAll(async () => {
    const { db, sql } = createDb();
    if (createdItems.length > 0) {
      await db.delete(contentDomainEvents).where(inArray(contentDomainEvents.contentItemId, createdItems));
      await db.delete(contentItemVersions).where(inArray(contentItemVersions.contentItemId, createdItems));
      await db.delete(contentItems).where(inArray(contentItems.id, createdItems));
    }
    if (createdRuns.length > 0) await db.delete(aiRuns).where(inArray(aiRuns.id, createdRuns));
    await sql.end();
  });

  async function itemWithVersions(id: string) {
    const { db, sql } = createDb();
    try {
      const [item] = await db.select().from(contentItems).where(eq(contentItems.id, id));
      const versions = await db.select().from(contentItemVersions).where(eq(contentItemVersions.contentItemId, id));
      return { item, versions };
    } finally {
      await sql.end();
    }
  }

  it("generating writes nothing to content: the run waits for a human decision", async () => {
    const run = await track(await requestContentDraft(hq, { brief: "Five free things to do this half term", contentType: "article" }));
    expect(run).toMatchObject({ taskKey: "content.draft", status: "succeeded", approvalState: "pending", actorUserId: hq.userId });
    expect(run.input).toMatchObject({ contentType: "article", revising: false });
    const { db, sql } = createDb();
    const created = await db.select().from(contentItems).where(eq(contentItems.sourceReference, `ai_run:${run.id}`));
    await sql.end();
    expect(created).toHaveLength(0);
  });

  it("accepting creates a DRAFT, AI-sourced item with provenance, and approves and applies the run atomically", async () => {
    const run = await track(await requestContentDraft(sutton, { brief: "Story time at the library in Sutton", contentType: "event" }));
    const { contentItemId } = await acceptContentDraft(sutton, run.id);
    createdItems.push(contentItemId);

    const { item, versions } = await itemWithVersions(contentItemId);
    expect(item).toMatchObject({ status: "draft", sourceType: "ai", contentType: "event", territoryId: sutton.territoryId, ownerLevel: "territory", approvedAt: null, publishedAt: null });
    expect(item!.provenance).toMatchObject({ generatedBy: "ai", aiRunId: run.id });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ versionNumber: 1, changeSummary: "AI draft accepted" });

    const after = await readContentDraftRun(sutton, run.id);
    expect(after).toMatchObject({ approvalState: "approved", decidedByUserId: sutton.userId });
    expect(after.appliedAt).not.toBeNull();

    // A decided run cannot be accepted twice, and no second item appears.
    await expect(acceptContentDraft(sutton, run.id)).rejects.toThrow(/already/);
    const { db, sql } = createDb();
    expect(await db.select().from(contentItems).where(eq(contentItems.sourceReference, `ai_run:${run.id}`))).toHaveLength(1);
    await sql.end();
  });

  it("revises a draft as a new version, but refuses to revise or accept onto approved content", async () => {
    const first = await track(await requestContentDraft(hq, { brief: "A guide to soft play near Solihull", contentType: "guide" }));
    const { contentItemId } = await acceptContentDraft(hq, first.id);
    createdItems.push(contentItemId);

    const revision = await track(await requestContentDraft(hq, { brief: "Make the opening warmer", contentType: "guide", contentItemId }));
    expect(revision).toMatchObject({ subjectType: "content_item", subjectId: contentItemId });
    await acceptContentDraft(hq, revision.id);
    const { versions } = await itemWithVersions(contentItemId);
    expect(versions.map((version) => version.versionNumber).sort()).toEqual([1, 2]);

    // Once approved, AI cannot touch it.
    const { db, sql } = createDb();
    await db.update(contentItems).set({ status: "approved" }).where(eq(contentItems.id, contentItemId));
    await sql.end();
    await expect(requestContentDraft(hq, { brief: "Rewrite it entirely", contentType: "guide", contentItemId })).rejects.toThrow(/Only draft content/);
  });

  it("rejecting records the decision and creates nothing", async () => {
    const run = await track(await requestContentDraft(hq, { brief: "Something we will not use", contentType: "article" }));
    expect(await rejectContentDraft(hq, run.id)).toMatchObject({ approvalState: "rejected" });
    await expect(acceptContentDraft(hq, run.id)).rejects.toThrow(/already/);
    const { db, sql } = createDb();
    expect(await db.select().from(contentItems).where(eq(contentItems.sourceReference, `ai_run:${run.id}`))).toHaveLength(0);
    await sql.end();
  });

  it("keeps runs inside their territory and validates the brief", async () => {
    const hqRun = await track(await requestContentDraft(hq, { brief: "Network-wide announcement draft", contentType: "announcement" }));
    // A territory user cannot see or accept an HQ (network) run.
    await expect(readContentDraftRun(sutton, hqRun.id)).rejects.toThrow("AI run not found.");
    await expect(acceptContentDraft(sutton, hqRun.id)).rejects.toThrow("AI run not found.");

    await expect(requestContentDraft(hq, { brief: "short", contentType: "article" })).rejects.toThrow(/little more/);
    await expect(requestContentDraft(hq, { brief: "A perfectly fine brief here", contentType: "malware" })).rejects.toThrow(/content type/);
    await expect(requestContentDraft({ userId: "someone-else" }, { brief: "A perfectly fine brief here", contentType: "article" })).rejects.toThrow();
  });
});
