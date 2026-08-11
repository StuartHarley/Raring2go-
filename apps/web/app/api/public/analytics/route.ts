import { createPublicAnalyticsEvent, type PublicAnalyticsEventType } from "@raring2go/public";
import { NextResponse } from "next/server";

const allowedEventTypes = new Set<PublicAnalyticsEventType>([
  "newsletter_signup_started",
  "newsletter_signup_completed",
  "discovery_item_clicked",
  "magazine_opened",
  "commercial_placement_clicked"
]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isAnalyticsBody(body)) {
    return NextResponse.json({ error: "Invalid public analytics event." }, { status: 400 });
  }

  let event;
  try {
    event = createPublicAnalyticsEvent({
      eventType: body.eventType,
      territorySlug: body.territorySlug,
      path: body.path,
      entityType: body.entityType,
      entityId: body.entityId,
      sessionId: body.sessionId,
      metadata: body.metadata
    });
  } catch {
    return NextResponse.json({ error: "Invalid public analytics event." }, { status: 400 });
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
