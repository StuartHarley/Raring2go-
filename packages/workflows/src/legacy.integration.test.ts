import { randomUUID } from "node:crypto";
import { createDb, emailCampaigns, emailSendJobs } from "@raring2go/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDrizzleLegacyJobReader } from "./legacy";

/**
 * Runs the real legacy-table joins against a migrated, seeded Postgres.
 * `RUN_DB_TESTS=1 pnpm --filter @raring2go/workflows test`
 */
describe.skipIf(!process.env.RUN_DB_TESTS)("legacy job reader (postgres)", () => {
  const { db, sql } = createDb();
  const reader = createDrizzleLegacyJobReader(db);
  const insertedJobIds: string[] = [];

  afterAll(async () => {
    for (const id of insertedJobIds) {
      await db.delete(emailSendJobs).where(eq(emailSendJobs.id, id));
    }
    await sql.end();
  });

  async function templateJob() {
    const [existing] = await db.select().from(emailSendJobs).limit(1);
    if (!existing) {
      throw new Error("Seed data needed: run pnpm db:seed (and a UAT seed) so an email_send_job exists to clone parents from.");
    }
    return existing;
  }

  it("lists every legacy source without SQL errors and normalises statuses", async () => {
    const jobs = await reader.list({});
    expect(jobs.every((job) => ["queued", "running", "succeeded", "dead", "cancelled"].includes(job.status))).toBe(true);
    expect(jobs.every((job) => job.subjectId !== undefined && job.kind.includes("."))).toBe(true);
  });

  it("carries the campaign's territory onto an email send job and scopes by it", async () => {
    const template = await templateJob();
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

    if (campaign?.territoryId) {
      const scoped = await reader.list({ territoryId: campaign.territoryId });
      expect(scoped.some((job) => job.id === id)).toBe(true);
      const other = await reader.list({ territoryId: randomUUID() });
      expect(other.some((job) => job.id === id)).toBe(false);
    }
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
