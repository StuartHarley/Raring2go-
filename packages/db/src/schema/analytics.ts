import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { territories } from "./tenancy";
import { users } from "./identity";

export const publicAnalyticsEvents = pgTable(
  "public_analytics_events",
  {
    id,
    eventType: text("event_type").notNull(),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    path: text("path").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    sessionId: text("session_id"),
    parentUserId: uuid("parent_user_id").references(() => users.id),
    attribution: jsonb("attribution").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    privacy: jsonb("privacy").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
    ...timestamps
  },
  (table) => [
    index("public_analytics_events_event_type_idx").on(table.eventType),
    index("public_analytics_events_territory_id_idx").on(table.territoryId),
    index("public_analytics_events_entity_idx").on(table.entityType, table.entityId),
    index("public_analytics_events_occurred_at_idx").on(table.occurredAt),
    index("public_analytics_events_retain_until_idx").on(table.retainUntil)
  ]
);
