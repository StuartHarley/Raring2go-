"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { send } from "./Track";

/**
 * A link that records one click, with the same privacy rules as page views: no cookies, no session, no personal
 * data. The click is reported (best effort) and navigation is never delayed or blocked by it.
 */
export function TrackedLink({
  href,
  className,
  territorySlug,
  path,
  eventType,
  entityType,
  entityId,
  component,
  children
}: {
  href: string;
  className?: string;
  territorySlug: string;
  path: string;
  eventType: "discovery_item_clicked" | "commercial_placement_clicked";
  entityType: "content" | "advertiser";
  entityId?: string;
  component: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href as Route}
      className={className}
      onClick={() => send({ eventType, territorySlug, path, entityType, entityId, metadata: { component } })}
    >
      {children}
    </Link>
  );
}
