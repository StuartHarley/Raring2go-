import type { createDb } from "@raring2go/db";
import { createPublicAnalyticsEventForTerritoryId } from "@raring2go/public";
import type { PublicAnalyticsEvent, PublicAnalyticsInput } from "@raring2go/public";

type Sql = ReturnType<typeof createDb>["sql"];
type Db = ReturnType<typeof createDb>["db"];

/** One place that writes a public analytics event, so the intake route and the server-side recorders store exactly the same shape. */
export async function insertPublicAnalyticsEvent(sql: Sql, event: PublicAnalyticsEvent) {
  await sql`
    insert into public_analytics_events (event_type, territory_id, path, entity_type, entity_id, session_id, attribution, metadata, privacy, occurred_at, retain_until)
    values (
      ${event.eventType}, ${event.territoryId}, ${event.path}, ${event.entityType ?? null}, ${event.entityId ?? null}, ${event.sessionId ?? null},
      ${JSON.stringify(event.attribution)}::jsonb, ${JSON.stringify(event.metadata)}::jsonb, ${JSON.stringify(event.privacy)}::jsonb,
      ${event.occurredAt}::timestamptz, ${event.retainUntil}::timestamptz
    )
  `;
}

/**
 * Records an event the server itself observed. It never carries who did it: no contact, user or session is stored, only
 * what happened, where, and to which content. A failure here must never break the action the person took, so it is
 * reported and swallowed.
 */
export async function recordServerPublicEvent(db: Db, sql: Sql, territoryId: string, input: Omit<PublicAnalyticsInput, "territorySlug">) {
  try {
    const event = await createPublicAnalyticsEventForTerritoryId(db, territoryId, input);
    await insertPublicAnalyticsEvent(sql, event);
  } catch (error) {
    console.error("Public analytics event was not recorded", error instanceof Error ? error.message : "unknown");
  }
}
