import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import {
  approveSocialPublication,
  cancelSocialPublication,
  loadPublishingData,
  persistSocialChanges,
  queueSocialPublication,
  resolveUnknownSocialOutcome,
  retrySocialPublication,
  scheduleSocialPublication,
  snapshotPublishingData
} from "@raring2go/publishing";
import type { PublishingActorContext, PublishingData } from "@raring2go/publishing";
import type { PermissionData } from "@raring2go/permissions";
import { getPermissionData } from "./permission-source";

/**
 * Staff social publishing writes (MKT-005): queue an approved variant, approve, schedule, cancel, retry,
 * and resolve a post whose outcome is unknown. One transaction per write; the domain checks permission
 * and territory; audit rows and domain events commit with the change. The worker lives in social-jobs.ts.
 */

export type SocialTx = Parameters<Parameters<ReturnType<typeof createDb>["db"]["transaction"]>[0]>[0];

/** Domain audit events carry a user for staff actions and none for the worker, which is recorded as automation. */
export function socialAuditFor(db: Parameters<typeof recordAuditEvent>[0]) {
  return {
    record: (event: { action: string; actorUserId?: string | null; entityType: string; entityId?: string | null; organisationId?: string | null; territoryId?: string | null; payload?: Record<string, unknown> }) =>
      recordAuditEvent(db, {
        action: event.action,
        actor: event.actorUserId ? { type: "human", userId: event.actorUserId } : { type: "automation", automationId: "social.publisher" },
        entity: { type: event.entityType, id: event.entityId ?? undefined },
        scope: { organisationId: event.organisationId ?? undefined, territoryId: event.territoryId ?? undefined },
        after: event.payload
      }).then(() => undefined)
  };
}

export async function mutateSocial<T>(work: (data: PublishingData, audit: ReturnType<typeof socialAuditFor>, permissions: PermissionData, tx: SocialTx) => Promise<T>) {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadPublishingData(tx);
      const before = snapshotPublishingData(data);
      const result = await work(data, socialAuditFor(tx), permissions, tx);
      await persistSocialChanges(tx, before, data);
      return result;
    });
  } finally {
    await sql.end();
  }
}

export async function queueSocialRecord(context: PublishingActorContext, input: { variantId: string; socialAccountId: string; linkUrl?: string; cta?: string }) {
  return mutateSocial((data, audit, permissions) => {
    const account = data.socialAccounts.find((candidate) => candidate.id === input.socialAccountId && !candidate.deletedAt);
    if (!account?.territoryId) throw new Error("Social account was not found.");
    const linkUrl = input.linkUrl?.trim();
    if (linkUrl && !/^https:\/\//i.test(linkUrl)) throw new Error("A link must start with https://.");

    return queueSocialPublication(context, permissions, audit, data, {
      id: randomUUID(),
      variantId: input.variantId,
      territoryId: account.territoryId,
      socialAccountId: account.id,
      // One queued post per variant per account: queuing it twice returns the first.
      idempotencyKey: `social:queue:${input.variantId}:${account.id}`,
      cta: input.cta?.trim() || null,
      linkUrl: linkUrl || null
    });
  });
}

export const approveSocialRecord = (context: PublishingActorContext, publicationId: string) =>
  mutateSocial((data, audit, permissions) => approveSocialPublication(context, permissions, audit, data, publicationId));

export const scheduleSocialRecord = (context: PublishingActorContext, publicationId: string, scheduledAtIso: string, timezone: string) =>
  mutateSocial((data, audit, permissions) => scheduleSocialPublication(context, permissions, audit, data, publicationId, scheduledAtIso, timezone));

export const cancelSocialRecord = (context: PublishingActorContext, publicationId: string) =>
  mutateSocial((data, audit, permissions) => cancelSocialPublication(context, permissions, audit, data, publicationId));

export const retrySocialRecord = (context: PublishingActorContext, publicationId: string) =>
  mutateSocial((data, audit, permissions) => retrySocialPublication(context, permissions, audit, data, publicationId));

export const resolveSocialOutcomeRecord = (context: PublishingActorContext, publicationId: string, outcome: { posted: boolean; externalReference?: string }) =>
  mutateSocial((data, audit, permissions) => resolveUnknownSocialOutcome(context, permissions, audit, data, publicationId, outcome));

/** Approved variants on a social channel that have a connected account in the territory and are not queued there yet. */
export function queueableSocialVariants(data: PublishingData, territoryId?: string | null) {
  const socialChannels = new Set(data.socialAccounts.filter((account) => account.active && !account.deletedAt).map((account) => account.channel));
  const out: Array<{ variantId: string; title: string; channel: string; accounts: Array<{ id: string; displayName: string }> }> = [];

  for (const variant of data.contentChannelVariants.filter((candidate) => !candidate.deletedAt && candidate.status === "approved" && socialChannels.has(candidate.channel))) {
    const item = data.contentItems.find((candidate) => candidate.id === variant.contentItemId && !candidate.deletedAt);
    const accounts = data.socialAccounts
      .filter((account) => account.active && !account.deletedAt && account.channel === variant.channel && account.territoryId && (!territoryId || account.territoryId === territoryId))
      .filter((account) => !data.socialPublications.some((publication) => publication.variantId === variant.id && publication.socialAccountId === account.id && !publication.deletedAt && publication.publishState !== "cancelled"))
      .map((account) => ({ id: account.id, displayName: account.displayName }));
    if (item && accounts.length > 0) out.push({ variantId: variant.id, title: item.title, channel: variant.channel, accounts });
  }
  return out;
}
