import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { sql } from "drizzle-orm";
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

/**
 * Point-in-time metric values per scope (ANL-001). `territory_id` null means the network
 * aggregate. Values are keyed by metric key; `definitions_version` pins which catalogue
 * produced them so a snapshot stays interpretable when definitions change.
 */
export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id,
    territoryId: uuid("territory_id").references(() => territories.id),
    snapshotDate: date("snapshot_date", { mode: "date" }).notNull(),
    definitionsVersion: text("definitions_version").notNull(),
    values: jsonb("values").$type<Record<string, number>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    // One snapshot per territory per day, and (NULLs being distinct in a unique index) a separate
    // partial index so the network aggregate also has exactly one per day.
    uniqueIndex("metric_snapshots_scope_date_uidx").on(table.territoryId, table.snapshotDate),
    uniqueIndex("metric_snapshots_network_date_uidx").on(table.snapshotDate).where(sql`${table.territoryId} is null`),
    index("metric_snapshots_date_idx").on(table.snapshotDate)
  ]
);

/**
 * Versioned Franchise Health Score configuration (ANL-002). Only one version is active;
 * activating a new one retires the old, and every health snapshot records the version it used.
 */
export const healthScoreConfigs = pgTable(
  "health_score_configs",
  {
    id,
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    factors: jsonb("factors").$type<Array<Record<string, unknown>>>().notNull(),
    thresholds: jsonb("thresholds").$type<Record<string, number>>().notNull(),
    changeNote: text("change_note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    activatedByUserId: uuid("activated_by_user_id").references(() => users.id),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("health_score_configs_version_uidx").on(table.versionNumber),
    uniqueIndex("health_score_configs_one_active_uidx").on(table.status).where(sql`${table.status} = 'active'`)
  ]
);

export const franchiseHealthSnapshots = pgTable(
  "franchise_health_snapshots",
  {
    id,
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    snapshotDate: date("snapshot_date", { mode: "date" }).notNull(),
    configId: uuid("config_id").notNull().references(() => healthScoreConfigs.id),
    configVersion: integer("config_version").notNull(),
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),
    band: text("band").notNull(),
    /** Every factor with its raw value, normalised score, weight and contribution: the audit trail. */
    factors: jsonb("factors").$type<Array<Record<string, unknown>>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("franchise_health_snapshots_territory_date_uidx").on(table.territoryId, table.snapshotDate),
    index("franchise_health_snapshots_date_idx").on(table.snapshotDate)
  ]
);
