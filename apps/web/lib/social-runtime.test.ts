import { randomUUID } from "node:crypto";
import {
  auditEvents, contentChannelVariantVersions, contentChannelVariants, contentDomainEvents, contentItems, createDb, fixtureIds, socialAccounts, socialPublications, socialPublishJobs
} from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPublishSocialHandler } from "./social-jobs";
import { approveSocialRecord, cancelSocialRecord, queueSocialRecord, resolveSocialOutcomeRecord, retrySocialRecord, scheduleSocialRecord } from "./social-runtime";

/** Real database: queue → approve → schedule → worker publishes once, with failure, retry and crash handling. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("social publishing (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const ids = { item: randomUUID(), variant: randomUUID(), version: randomUUID(), account: randomUUID(), solihullAccount: randomUUID() };
  const handler = createPublishSocialHandler() as unknown as { handle: (context: { now: () => Date }) => Promise<{ claimed: number; published: number; failed: number; reaped: number }> };
  const runWorker = () => handler.handle({ now: () => new Date() });
  const inOneHour = () => new Date(Date.now() + 3600_000).toISOString();
  const created: string[] = [];

  beforeAll(async () => {
    await db.insert(contentItems).values({ id: ids.item, title: `Social Test ${tag}`, contentType: "article", ownerLevel: "territory", territoryId: fixtureIds.territories.suttonColdfield, status: "approved", categories: [], tags: [], relevantDates: {}, provenance: {} });
    await db.insert(contentChannelVariants).values({ id: ids.variant, contentItemId: ids.item, channel: "facebook", status: "approved", currentVersionId: ids.version, territoryId: null });
    await db.insert(contentChannelVariantVersions).values({ id: ids.version, variantId: ids.variant, versionNumber: 1, status: "approved", snapshot: { postCopy: `Half term ideas ${tag}` } });
    await db.insert(socialAccounts).values([
      { id: ids.account, channel: "facebook", territoryId: fixtureIds.territories.suttonColdfield, organisationId: fixtureIds.organisations.franchise, externalAccountReference: `page-${tag}`, displayName: `Sutton page ${tag}` },
      { id: ids.solihullAccount, channel: "facebook", territoryId: fixtureIds.territories.solihull, organisationId: fixtureIds.organisations.franchise, externalAccountReference: `page-sol-${tag}`, displayName: `Solihull page ${tag}` }
    ]);
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    const pubs = await db.select({ id: socialPublications.id }).from(socialPublications).where(inArray(socialPublications.socialAccountId, [ids.account, ids.solihullAccount]));
    if (pubs.length) await db.delete(socialPublishJobs).where(inArray(socialPublishJobs.publicationId, pubs.map((row) => row.id)));
    await db.delete(socialPublications).where(inArray(socialPublications.socialAccountId, [ids.account, ids.solihullAccount]));
    await db.delete(contentDomainEvents).where(eq(contentDomainEvents.contentItemId, ids.item));
    await db.delete(socialAccounts).where(inArray(socialAccounts.id, [ids.account, ids.solihullAccount]));
    // Versions reference their variants, so they go first. `created` holds the per-test variant and version ids.
    const versionIds = [ids.version, ...created];
    const variantIds = [ids.variant, ...created];
    await db.delete(contentChannelVariantVersions).where(inArray(contentChannelVariantVersions.id, versionIds));
    await db.delete(contentChannelVariants).where(inArray(contentChannelVariants.id, variantIds));
    await db.delete(contentItems).where(eq(contentItems.id, ids.item));
    await sql.end();
  });

  /** Queue, approve and schedule a post, then make it due now. A fresh variant is not needed: the unique key is per variant+account, so each case uses its own variant. */
  async function dueNow(label: string) {
    const variant = randomUUID();
    const version = randomUUID();
    await db.insert(contentChannelVariants).values({ id: variant, contentItemId: ids.item, channel: "facebook", status: "approved", currentVersionId: version, territoryId: null });
    await db.insert(contentChannelVariantVersions).values({ id: version, variantId: variant, versionNumber: 1, status: "approved", snapshot: { postCopy: `${label} ${tag}` } });
    created.push(variant, version);
    const publication = await queueSocialRecord(sutton, { variantId: variant, socialAccountId: ids.account });
    await approveSocialRecord(sutton, publication.id);
    await scheduleSocialRecord(sutton, publication.id, inOneHour(), "Europe/London");
    await db.update(socialPublishJobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(socialPublishJobs.publicationId, publication.id));
    return publication;
  }

  const stateOf = async (id: string) => (await db.select().from(socialPublications).where(eq(socialPublications.id, id)))[0]!;
  const jobOf = async (id: string) => (await db.select().from(socialPublishJobs).where(eq(socialPublishJobs.publicationId, id)))[0]!;

  it("queues an approved variant once, refuses another territory's account and unsafe links", async () => {
    const first = await queueSocialRecord(sutton, { variantId: ids.variant, socialAccountId: ids.account, linkUrl: "https://example.test/page" });
    const again = await queueSocialRecord(sutton, { variantId: ids.variant, socialAccountId: ids.account });
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ publishState: "draft", approvalState: "draft", linkUrl: "https://example.test/page", territoryId: fixtureIds.territories.suttonColdfield });
    expect(first.immutableSnapshot).toMatchObject({ postCopy: `Half term ideas ${tag}` });

    await expect(queueSocialRecord(sutton, { variantId: ids.variant, socialAccountId: ids.solihullAccount })).rejects.toThrow();
    await expect(queueSocialRecord(sutton, { variantId: ids.variant, socialAccountId: ids.account, linkUrl: "http://insecure.test" })).rejects.toThrow(/https/);
    expect(await db.select().from(socialPublications).where(eq(socialPublications.socialAccountId, ids.solihullAccount))).toHaveLength(0);
  });

  it("will not schedule an unapproved post or one in the past, and does not run before it is due", async () => {
    const variant = randomUUID();
    const version = randomUUID();
    await db.insert(contentChannelVariants).values({ id: variant, contentItemId: ids.item, channel: "facebook", status: "approved", currentVersionId: version, territoryId: null });
    await db.insert(contentChannelVariantVersions).values({ id: version, variantId: variant, versionNumber: 1, status: "approved", snapshot: { postCopy: `Later ${tag}` } });
    created.push(variant, version);
    const publication = await queueSocialRecord(sutton, { variantId: variant, socialAccountId: ids.account });

    await expect(scheduleSocialRecord(sutton, publication.id, inOneHour(), "Europe/London")).rejects.toThrow(/approved/);
    await approveSocialRecord(sutton, publication.id);
    await expect(scheduleSocialRecord(sutton, publication.id, new Date(Date.now() - 86400_000).toISOString(), "Europe/London")).rejects.toThrow(/past/);

    await scheduleSocialRecord(sutton, publication.id, inOneHour(), "Europe/London");
    await runWorker();
    expect((await stateOf(publication.id)).publishState).toBe("scheduled");
    expect((await jobOf(publication.id)).status).toBe("queued");

    await cancelSocialRecord(sutton, publication.id);
    expect((await stateOf(publication.id)).publishState).toBe("cancelled");
    expect((await jobOf(publication.id)).status).toBe("cancelled");
  });

  it("publishes a due post exactly once, even with two workers at the same time", async () => {
    const posts = [await dueNow("Once A"), await dueNow("Once B"), await dueNow("Once C")];
    await Promise.all([runWorker(), runWorker()]);
    await runWorker();

    for (const post of posts) {
      const row = await stateOf(post.id);
      const job = await jobOf(post.id);
      expect(row.publishState).toBe("published");
      expect(row.publishedExternalReference).toBe(`dev-${post.id}`);
      expect(job).toMatchObject({ status: "completed", attempts: 1 });
    }
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityId, posts[0]!.id));
    expect(audit.map((event) => event.action)).toEqual(expect.arrayContaining(["social.queued", "social.approved", "social.scheduled", "social.publish.started", "social.published"]));
  });

  it("fails closed in production when the account has no real connection, and lets staff retry once it is fixed", async () => {
    const post = await dueNow("Closed");
    vi.stubEnv("NODE_ENV", "production");
    await runWorker();
    vi.unstubAllEnvs();

    const failed = await stateOf(post.id);
    expect(failed).toMatchObject({ publishState: "failed", failureMetadata: { reason: "no_connection", recoverable: false } });
    expect(await jobOf(post.id)).toMatchObject({ status: "failed", attempts: 1 });

    await expect(retrySocialRecord(fixtureUserWithoutAccess(), post.id)).rejects.toThrow();
    await retrySocialRecord(sutton, post.id);
    await runWorker();
    expect(await stateOf(post.id)).toMatchObject({ publishState: "published" });
  });

  it("flags a post stuck mid-publish as outcome unknown instead of retrying it, and lets a person resolve it", async () => {
    const post = await dueNow("Crash");
    // A worker that claimed the job and died before recording the answer.
    await db.update(socialPublications).set({ publishState: "publishing" }).where(eq(socialPublications.id, post.id));
    await db.update(socialPublishJobs).set({ status: "running", attempts: 1, lockedAt: new Date(Date.now() - 3600_000) }).where(eq(socialPublishJobs.publicationId, post.id));

    const summary = await runWorker();
    expect(summary.reaped).toBeGreaterThanOrEqual(1);
    expect(await stateOf(post.id)).toMatchObject({ publishState: "failed", failureMetadata: { reason: "outcome_unknown" } });
    await runWorker();
    expect((await stateOf(post.id)).publishState).toBe("failed");

    await expect(retrySocialRecord(sutton, post.id)).rejects.toThrow(/Check whether this post went out/);
    await resolveSocialOutcomeRecord(hq, post.id, { posted: true, externalReference: "fb_manual_1" });
    expect(await stateOf(post.id)).toMatchObject({ publishState: "published", publishedExternalReference: "fb_manual_1" });
  });

  it("does not publish a post cancelled while it was waiting", async () => {
    const post = await dueNow("Cancel");
    await cancelSocialRecord(sutton, post.id);
    await runWorker();
    expect((await stateOf(post.id)).publishState).toBe("cancelled");
    expect(await jobOf(post.id)).toMatchObject({ status: "cancelled", attempts: 0 });
  });

  function fixtureUserWithoutAccess() {
    return { userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser };
  }
});
