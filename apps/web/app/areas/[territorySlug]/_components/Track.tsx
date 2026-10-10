"use client";

import { useEffect } from "react";

type TrackEvent = {
  eventType: "territory_viewed" | "content_viewed" | "magazine_opened" | "newsletter_signup_started" | "commercial_placement_clicked" | "discovery_item_clicked" | "magazine_page_interaction";
  territorySlug: string;
  path: string;
  entityType?: "content" | "advertiser" | "edition" | "newsletter";
  entityId?: string;
  metadata?: { component?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string };
};

/** Campaign tags on the landing URL, so a visit can be credited to the newsletter, post or ad that brought it. Nothing else is read. */
function utmFromLocation(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const [key, name] of [["utm_source", "utmSource"], ["utm_medium", "utmMedium"], ["utm_campaign", "utmCampaign"]] as const) {
    const value = params.get(key)?.trim().slice(0, 80);
    if (value) out[name] = value;
  }
  return out;
}

/**
 * Privacy-light analytics: no cookies, no session id, no personal data. The server stores the
 * territory, path and record id only, and drops the request's IP and user agent.
 */
export function send(event: TrackEvent) {
  try {
    if (typeof navigator !== "undefined" && navigator.doNotTrack === "1") return;
    const body = JSON.stringify({ ...event, metadata: { ...utmFromLocation(), ...event.metadata } });
    if (!navigator.sendBeacon?.("/api/public/analytics", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/public/analytics", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
    }
  } catch {
    // Telemetry must never break a page.
  }
}

export function Track(event: TrackEvent) {
  const { eventType, territorySlug, path, entityType, entityId } = event;
  useEffect(() => {
    send({ eventType, territorySlug, path, entityType, entityId });
  }, [eventType, territorySlug, path, entityType, entityId]);
  return null;
}
