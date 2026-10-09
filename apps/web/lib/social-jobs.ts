import { createDb } from "@raring2go/db";
import {
  createDrizzleProviderConnectionRepository,
  createDrizzleSecretRepository,
  createEncryptedSecretStore,
  createDevelopmentSocialPublishingProvider,
  createMetaFacebookPagePublishingProvider,
  getConnectionCredential
} from "@raring2go/integrations";
import {
  beginSocialPublish,
  completeSocialPublish,
  loadPublishingData,
  persistSocialChanges,
  reapStaleSocialJobs,
  snapshotPublishingData
} from "@raring2go/publishing";
import type { SocialAccount, SocialPublication } from "@raring2go/publishing";
import { defineJobHandler } from "@raring2go/workflows";
import type { JobHandler } from "@raring2go/workflows";
import { sql as rawSql } from "drizzle-orm";
import { socialAuditFor } from "./social-runtime";

export const PUBLISH_SOCIAL_KIND = "social.publish_due";
const BATCH = 10;

/** Cron ticks about every minute; one job per five-minute bucket is plenty and stops a backlog of identical jobs. */
export const publishSocialIdempotencyKey = (now: Date) => `${PUBLISH_SOCIAL_KIND}:${Math.floor(now.getTime() / 300_000)}`;

type PublishResult = { status: "published" | "failed"; externalReference?: string | null; metadata?: Record<string, unknown> };
type Db = ReturnType<typeof createDb>["db"];

/**
 * Which provider publishes for an account. A Facebook page with a stored connection uses Meta. With no
 * real connection, development uses the deterministic provider but production fails closed, so nothing
 * is ever reported as posted that was not.
 */
export function resolveSocialProvider(db: Db, account: SocialAccount) {
  if (account.providerConnectionId && account.channel === "facebook") {
    const repository = createDrizzleProviderConnectionRepository(db);
    const key = process.env.INTEGRATION_SECRET_ENCRYPTION_KEY;
    return createMetaFacebookPagePublishingProvider({
      resolvePageAccessToken: async ({ account: target }) => {
        if (!key) throw new Error("INTEGRATION_SECRET_ENCRYPTION_KEY is not set.");
        const connection = await repository.getConnection(target.providerConnectionId ?? "");
        if (!connection) throw new Error("The connected account no longer exists.");
        const secretStore = createEncryptedSecretStore({ repository: createDrizzleSecretRepository(db), encryptionKey: key, keyVersion: process.env.INTEGRATION_SECRET_KEY_VERSION ?? "v1" });
        const pageAccessToken = await getConnectionCredential({ connection, secretStore });
        return { pageId: target.externalAccountReference, pageAccessToken };
      }
    });
  }
  if (process.env.NODE_ENV !== "production" && !account.providerConnectionId) return createDevelopmentSocialPublishingProvider();
  return {
    key: "none",
    async publish(): Promise<PublishResult> {
      return {
        status: "failed",
        metadata: { reason: account.providerConnectionId ? "unsupported_channel" : "no_connection", recoverable: false, channel: account.channel }
      };
    }
  };
}

/**
 * Publishes due posts in three steps so a crash can never cause a silent double post:
 *  1. claim due jobs (one SQL statement, skip-locked) and mark each post "publishing", committed;
 *  2. call the provider with no transaction open;
 *  3. record the answer.
 * A worker that dies between 2 and 3 leaves a "publishing" post that the reaper flags as outcome unknown,
 * for a person to check; it is never retried on its own.
 */
export function createPublishSocialHandler(): JobHandler {
  return defineJobHandler({
    kind: PUBLISH_SOCIAL_KIND,
    maxAttempts: 2,
    handle: async () => {
      const { db, sql } = createDb();
      try {
        const claimed = await db.transaction(async (tx) => {
          const data = await loadPublishingData(tx);
          const before = snapshotPublishingData(data);
          const audit = socialAuditFor(tx);
          const reaped = await reapStaleSocialJobs(data, audit);
          await persistSocialChanges(tx, before, data);

          const rows = await tx.execute(rawSql`
            update social_publish_jobs
            set status = 'running', attempts = attempts + 1, locked_at = now(), updated_at = now()
            where id in (
              select id from social_publish_jobs where status = 'queued' and run_after <= now()
              order by run_after limit ${BATCH} for update skip locked
            )
            returning id
          `);
          const ids = (rows as unknown as Array<{ id: string }>).map((row) => row.id);

          const claimedData = await loadPublishingData(tx);
          const claimedBefore = snapshotPublishingData(claimedData);
          const started: Array<{ jobId: string; publication: SocialPublication; account: SocialAccount }> = [];
          for (const id of ids) {
            const begun = await beginSocialPublish(claimedData, audit, id);
            if (begun) started.push({ jobId: id, publication: structuredClone(begun.publication), account: structuredClone(begun.account) });
          }
          await persistSocialChanges(tx, claimedBefore, claimedData);
          return { started, reaped: reaped.length, cancelled: ids.length - started.length };
        });

        let published = 0;
        let failed = 0;
        let unknown = 0;
        for (const item of claimed.started) {
          let result: PublishResult;
          try {
            result = await resolveSocialProvider(db, item.account).publish({ publication: item.publication, account: item.account });
          } catch (error) {
            // We cannot tell whether the provider acted before it threw. The post stays "publishing"; the reaper
            // flags it as outcome unknown for a person to check, and the rest of the batch carries on.
            console.error("Social provider call threw; leaving the post for review", { publicationId: item.publication.id, error: error instanceof Error ? error.message : "unknown" });
            unknown += 1;
            continue;
          }

          await db.transaction(async (tx) => {
            const data = await loadPublishingData(tx);
            const before = snapshotPublishingData(data);
            await completeSocialPublish(data, socialAuditFor(tx), item.jobId, result);
            await persistSocialChanges(tx, before, data);
          });
          if (result.status === "published") published += 1;
          else failed += 1;
        }

        return { claimed: claimed.started.length, published, failed, unknown, reaped: claimed.reaped, cancelled: claimed.cancelled };
      } finally {
        await sql.end();
      }
    }
  });
}
