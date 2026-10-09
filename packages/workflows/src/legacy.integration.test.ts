import { randomUUID } from "node:crypto";
import { createDb, emailCampaignVersions, emailCampaigns, emailRecipientSnapshots, emailSendJobs, fixtureIds } from "@raring2go/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrizzleLegacyJobReader } from "./legacy";

/**
 * Runs the real legacy-table joins against a migrated, seeded Postgres.
 * `RUN_DB_TESTS=1 pnpm --filter @raring2go/workflows test`
 */
describe.skipIf(!process.env.RUN_DB_TESTS)("legacy job reader (postgres)", () => {
  const { db, sql } = createDb();
  const reader = createDrizzleLegacyJobReader(db);
  const insertedJobIds: string[] = [];
  // Own parent records, so the test needs no particular data in the database (CI starts from a fresh seed).
  const ids = { campaign: randomUUID(), version: randomUUID(), snapshot: randomUUID() };

  beforeAll(async () => {
    await db.insert(emailCampaigns).values({ id: ids.campaign, territoryId: fixtureIds.territories.suttonColdfield, title: `Legacy reader ${ids.campaign.slice(0, 8)}`, subject: "s" });
    await db.insert(emailCampaignVersions).values({ id: ids.version, campaignId: ids.campaign, versionNumber: 1, subject: "s" });
    await db.insert(emailRecipientSnapshots).values({ id: ids.snapshot, campaignId: ids.campaign, campaignVersionId: ids.version, generatedAt: new Date(), idempotencyKey: `legacy-${ids.snapshot}` });
  });

  afterAll(async () => {
    for (const id of insertedJobIds) {
      await db.delete(emailSendJobs).where(eq(emailSendJobs.id, id));
    }
    await db.delete(emailRecipientSnapshots).where(eq(emailRecipientSnapshots.id, ids.snapshot));
    await db.delete(emailCampaignVersions).where(eq(emailCampaignVersions.id, ids.version));
    await db.delete(emailCampaigns).where(eq(emailCampaigns.id, ids.campaign));
    await sql.end();
  });

  const templateJob = () => ({ campaignId: ids.campaign, campaignVersionId: ids.version, recipientSnapshotId: ids.snapshot });

  it("lists every legacy source without SQL errors and normalises statuses", async () => {
    const jobs = await reader.list({});
    expect(jobs.every((job) => ["queued", "running", "succeeded", "dead", "cancelled"].includes(job.status))).toBe(true);
    expect(jobs.every((job) => job.subjectId !== undefined && job.kind.includes("."))).toBe(true);
  });

  it("carries the campaign's territory onto an email send job and scopes by it", async () => {
    const template = templateJob();
    const [campaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, template.campaignId));
    const id = randomUUID();
    insertedJobIds.push(id);
    await db.insert(emailSendJobs).values({
      id,
      campaignId: template.campaignId,
      campaignVersionId: template.campaignVersionId,
      recipientSnapshotId: template.recipientSnapshotId,
      status: "failed",
      attempts: 5,
      maxAttempts: 5,
      nextAttemptAt: new Date(),
      lastError: "integration failure"
    });

    const found = await reader.get("email_send", id);
    expect(found).toMatchObject({ source: "email_send", status: "dead", rawStatus: "failed", territoryId: campaign?.territoryId ?? null, lastError: "integration failure" });

    const scoped = await reader.list({ territoryId: fixtureIds.territories.suttonColdfield });
    expect(scoped.some((job) => job.id === id)).toBe(true);
    const other = await reader.list({ territoryId: randomUUID() });
    expect(other.some((job) => job.id === id)).toBe(false);
  });

  it("retries only a failed email send job, resets the budget, and is a no-op the second time", async () => {
    const id = insertedJobIds[0]!;
    const first = await reader.retryEmailSend(id, new Date());
    expect(first).toMatchObject({ rawStatus: "queued", attempts: 0 });
    expect(await reader.retryEmailSend(id, new Date())).toBeUndefined();
  });

  it("counts by normalised status", async () => {
    const counts = await reader.counts({});
    expect(Object.values(counts).every((value) => Number.isInteger(value) && value >= 0)).toBe(true);
  });
});
