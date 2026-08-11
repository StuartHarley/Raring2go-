import { createDb } from "@raring2go/db";
import { createPublicAnalyticsEventForDb, type PublicAnalyticsEventType } from "@raring2go/public";
import { NextResponse } from "next/server";

const allowedEventTypes = new Set<PublicAnalyticsEventType>([
  "territory_viewed",
  "content_viewed",
  "newsletter_signup_started",
  "newsletter_signup_completed",
  "content_saved",
  "discovery_item_clicked",
  "magazine_opened",
  "magazine_page_interaction",
  "commercial_placement_clicked",
  "public_conversion"
]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isAnalyticsBody(body)) {
    return NextResponse.json({ error: "Invalid public analytics event." }, { status: 400 });
  }

  let event;
  const { db, sql } = createDb();
  try {
    event = await createPublicAnalyticsEventForDb(db, {
      eventType: body.eventType,
      territorySlug: body.territorySlug,
      path: body.path,
      entityType: body.entityType,
      entityId: body.entityId,
      sessionId: body.sessionId,
      metadata: body.metadata
    });
    await sql`
      insert into public_analytics_events (
        event_type,
        territory_id,
        path,
        entity_type,
        entity_id,
        session_id,
        attribution,
        metadata,
        privacy,
        occurred_at,
        retain_until
      )
      values (
        ${event.eventType},
        ${event.territoryId},
        ${event.path},
        ${event.entityType ?? null},
        ${event.entityId ?? null},
        ${event.sessionId ?? null},
        ${JSON.stringify(event.attribution)}::jsonb,
        ${JSON.stringify(event.metadata)}::jsonb,
        ${JSON.stringify(event.privacy)}::jsonb,
        ${new Date(event.occurredAt)},
        ${new Date(event.retainUntil)}
      )
    `;
  } catch {
    return NextResponse.json({ error: "Invalid public analytics event." }, { status: 400 });
  } finally {
    await sql.end();
  }

  return NextResponse.json({ accepted: true, event }, { status: 202 });
}

function isAnalyticsBody(value: unknown): value is {
  eventType: PublicAnalyticsEventType;
  territorySlug: string;
  path: string;
  entityType?: "content" | "advertiser" | "edition" | "newsletter";
  entityId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
} {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.eventType === "string"
    && allowedEventTypes.has(candidate.eventType as PublicAnalyticsEventType)
    && typeof candidate.territorySlug === "string"
    && typeof candidate.path === "string"
    && (candidate.metadata === undefined || (typeof candidate.metadata === "object" && candidate.metadata !== null));
}
