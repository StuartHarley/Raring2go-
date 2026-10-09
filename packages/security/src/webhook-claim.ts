import { webhookEventClaims } from "@raring2go/db";
import type { createDb } from "@raring2go/db";

type Db = Pick<ReturnType<typeof createDb>["db"], "insert">;

/**
 * Claim a provider event for processing. Returns true for the first caller and false for every later one, on any
 * instance: the unique (provider, event id) decides. Call it inside the same transaction as the work it guards, so
 * a failure rolls the claim back and the provider's retry is processed rather than silently dropped.
 */
export async function claimWebhookEvent(db: Db, event: { providerKey: string; eventId: string; eventType?: string | null }): Promise<boolean> {
  const claimed = await db
    .insert(webhookEventClaims)
    .values({ providerKey: event.providerKey, eventId: event.eventId, eventType: event.eventType ?? null })
    .onConflictDoNothing()
    .returning({ id: webhookEventClaims.id });
  return claimed.length === 1;
}
