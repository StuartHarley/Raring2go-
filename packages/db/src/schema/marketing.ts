import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";
import { users } from "./identity";
import { territories } from "./tenancy";

export const audienceContacts = pgTable(
  "audience_contacts",
  {
    id,
    email: text("email").notNull(),
    emailNormalised: text("email_normalised").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    emailStatus: text("email_status").notNull().default("subscribed"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("audience_contacts_email_uidx").on(table.emailNormalised),
    index("audience_contacts_email_status_idx").on(table.emailStatus),
    index("audience_contacts_deleted_at_idx").on(table.deletedAt)
  ]
);

export const audienceTerritorySubscriptions = pgTable(
  "audience_territory_subscriptions",
  {
    id,
    contactId: uuid("contact_id").notNull().references(() => audienceContacts.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    status: text("status").notNull().default("subscribed"),
    source: text("source").notNull().default("manual"),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("audience_subscriptions_contact_territory_uidx").on(table.contactId, table.territoryId),
    index("audience_subscriptions_territory_id_idx").on(table.territoryId),
    index("audience_subscriptions_status_idx").on(table.status),
    index("audience_subscriptions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const audienceConsentEvents = pgTable(
  "audience_consent_events",
  {
    id,
    contactId: uuid("contact_id").notNull().references(() => audienceContacts.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    consentType: text("consent_type").notNull(),
    action: text("action").notNull(),
    source: text("source").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => [
    index("audience_consent_contact_id_idx").on(table.contactId),
    index("audience_consent_territory_id_idx").on(table.territoryId),
    index("audience_consent_type_idx").on(table.consentType)
  ]
);

export const audienceSuppressions = pgTable(
  "audience_suppressions",
  {
    id,
    contactId: uuid("contact_id").notNull().references(() => audienceContacts.id),
    emailNormalised: text("email_normalised").notNull(),
    territoryId: uuid("territory_id").references(() => territories.id),
    reason: text("reason").notNull(),
    source: text("source").notNull(),
    active: boolean("active").notNull().default(true),
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => [
    uniqueIndex("audience_suppressions_active_uidx").on(table.emailNormalised, table.territoryId, table.reason),
    index("audience_suppressions_contact_id_idx").on(table.contactId),
    index("audience_suppressions_active_idx").on(table.active)
  ]
);

export const audienceSegments = pgTable(
  "audience_segments",
  {
    id,
    territoryId: uuid("territory_id").references(() => territories.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    segmentType: text("segment_type").notNull().default("dynamic"),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("active"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("audience_segments_key_uidx").on(table.key),
    index("audience_segments_territory_id_idx").on(table.territoryId),
    index("audience_segments_deleted_at_idx").on(table.deletedAt)
  ]
);

export const audienceSegmentMembers = pgTable(
  "audience_segment_members",
  {
    id,
    segmentId: uuid("segment_id").notNull().references(() => audienceSegments.id),
    contactId: uuid("contact_id").notNull().references(() => audienceContacts.id),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("audience_segment_members_uidx").on(table.segmentId, table.contactId),
    index("audience_segment_members_contact_id_idx").on(table.contactId),
    index("audience_segment_members_deleted_at_idx").on(table.deletedAt)
  ]
);

export const audienceImports = pgTable(
  "audience_imports",
  {
    id,
    territoryId: uuid("territory_id").references(() => territories.id),
    source: text("source").notNull(),
    status: text("status").notNull().default("pending"),
    totalRows: integer("total_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => [
    index("audience_imports_territory_id_idx").on(table.territoryId),
    index("audience_imports_status_idx").on(table.status)
  ]
);

export const audienceActivityEvents = pgTable(
  "audience_activity_events",
  {
    id,
    contactId: uuid("contact_id").notNull().references(() => audienceContacts.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    activityType: text("activity_type").notNull(),
    title: text("title").notNull(),
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("audience_activity_contact_id_idx").on(table.contactId),
    index("audience_activity_territory_id_idx").on(table.territoryId),
    index("audience_activity_type_idx").on(table.activityType),
    index("audience_activity_deleted_at_idx").on(table.deletedAt)
  ]
);
