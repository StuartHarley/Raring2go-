import { createDb } from "@raring2go/db";
import { createPublicAnalyticsEventForDb, type PublicAnalyticsEventType } from "@raring2go/public";
import { rateLimitRules } from "@raring2go/security";
import { NextResponse } from "next/server";
import { insertPublicAnalyticsEvent } from "../../../../lib/public-events";
import { clientIp, firstRateLimitRefusal, tooManyRequestsResponse } from "../../../../lib/rate-limit-runtime";

// Only what a browser can honestly observe. A save and a confirmed subscription are recorded by the server, so they cannot be forged here.
const allowedEventTypes = new Set<PublicAnalyticsEventType>([
  "territory_viewed",
  "content_viewed",
  "newsletter_signup_started",
  "discovery_item_clicked",
  "magazine_opened",
  "magazine_page_interaction",
  "commercial_placement_clicked"
]);

export async function POST(request: Request) {
  const refusal = await firstRateLimitRefusal([{ rule: rateLimitRules.publicAnalyticsIp, identifier: clientIp(request.headers) }]);
  if (refusal) return tooManyRequestsResponse(refusal);

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
    await insertPublicAnalyticsEvent(sql, event);
  } catch (error) {
    // A rejected event (unknown area, unsafe path) is the caller's fault; anything else is ours and must be visible.
    if (event === undefined && error instanceof Error && /^(Unknown public territory|Public analytics path)/.test(error.message)) {
      return NextResponse.json({ error: "Invalid public analytics event." }, { status: 400 });
    }
    console.error("Public analytics event was not stored", error);
    return NextResponse.json({ error: "Event could not be stored." }, { status: 500 });
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
