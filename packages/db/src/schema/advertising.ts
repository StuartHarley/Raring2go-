import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

export const advertisers = pgTable(
  "advertisers",
  {
    id,
    advertiserOrganisationId: uuid("advertiser_organisation_id").notNull().references(() => organisations.id),
    owningTerritoryId: uuid("owning_territory_id").notNull().references(() => territories.id),
    accountOwnerUserId: uuid("account_owner_user_id").references(() => users.id),
    status: text("status").notNull().default("prospect"),
    relationshipState: text("relationship_state").notNull().default("new"),
    source: text("source").notNull().default("manual"),
    firstBookedOn: date("first_booked_on", { mode: "date" }),
    lastBookedOn: date("last_booked_on", { mode: "date" }),
    lapsedOn: date("lapsed_on", { mode: "date" }),
    averageSaleValueMinor: integer("average_sale_value_minor").notNull().default(0),
    annualAdvertiserValueMinor: integer("annual_advertiser_value_minor").notNull().default(0),
    currency: text("currency").notNull().default("GBP"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    commercialMetadata: jsonb("commercial_metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("advertisers_organisation_uidx").on(table.advertiserOrganisationId),
    index("advertisers_owning_territory_id_idx").on(table.owningTerritoryId),
    index("advertisers_status_idx").on(table.status),
    index("advertisers_relationship_state_idx").on(table.relationshipState),
    index("advertisers_deleted_at_idx").on(table.deletedAt)
  ]
);

export const advertiserContacts = pgTable(
  "advertiser_contacts",
  {
    id,
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    userId: uuid("user_id").references(() => users.id),
    label: text("label").notNull(),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    role: text("role").notNull().default("contact"),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("advertiser_contacts_advertiser_id_idx").on(table.advertiserId),
    index("advertiser_contacts_user_id_idx").on(table.userId),
    index("advertiser_contacts_deleted_at_idx").on(table.deletedAt)
  ]
);

export const advertiserActivityEvents = pgTable(
  "advertiser_activity_events",
  {
    id,
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    activityType: text("activity_type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("advertiser_activity_events_advertiser_id_idx").on(table.advertiserId),
    index("advertiser_activity_events_territory_id_idx").on(table.territoryId),
    index("advertiser_activity_events_type_idx").on(table.activityType),
    index("advertiser_activity_events_deleted_at_idx").on(table.deletedAt)
  ]
);

export const advertiserMetricSnapshots = pgTable(
  "advertiser_metric_snapshots",
  {
    id,
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    periodKey: text("period_key").notNull(),
    averageSaleValueMinor: integer("average_sale_value_minor").notNull().default(0),
    annualAdvertiserValueMinor: integer("annual_advertiser_value_minor").notNull().default(0),
    bookingCount: integer("booking_count").notNull().default(0),
    packageMix: jsonb("package_mix").$type<Record<string, unknown>>().notNull().default({}),
    digitalMix: jsonb("digital_mix").$type<Record<string, unknown>>().notNull().default({}),
    conversionState: text("conversion_state").notNull().default("unknown"),
    churnRisk: text("churn_risk").notNull().default("unknown"),
    overdueDebtMinor: integer("overdue_debt_minor").notNull().default(0),
    benchmarkMetadata: jsonb("benchmark_metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("advertiser_metric_snapshots_period_uidx").on(table.advertiserId, table.periodKey),
    index("advertiser_metric_snapshots_territory_id_idx").on(table.territoryId),
    index("advertiser_metric_snapshots_deleted_at_idx").on(table.deletedAt)
  ]
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id,
    key: text("key").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    probabilityDefault: integer("probability_default").notNull().default(0),
    isClosed: boolean("is_closed").notNull().default(false),
    outcome: text("outcome"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("pipeline_stages_key_uidx").on(table.key),
    index("pipeline_stages_sort_order_idx").on(table.sortOrder),
    index("pipeline_stages_deleted_at_idx").on(table.deletedAt)
  ]
);

export const opportunities = pgTable(
  "opportunities",
  {
    id,
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    stageId: uuid("stage_id").notNull().references(() => pipelineStages.id),
    source: text("source").notNull().default("manual"),
    title: text("title").notNull(),
    estimatedValueMinor: integer("estimated_value_minor").notNull().default(0),
    currency: text("currency").notNull().default("GBP"),
    probability: integer("probability").notNull().default(0),
    expectedCloseDate: date("expected_close_date", { mode: "date" }),
    nextAction: text("next_action"),
    nextActionDate: date("next_action_date", { mode: "date" }),
    notes: text("notes"),
    lostReason: text("lost_reason"),
    competitor: text("competitor"),
    closedAt: date("closed_at", { mode: "date" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("opportunities_advertiser_id_idx").on(table.advertiserId),
    index("opportunities_territory_id_idx").on(table.territoryId),
    index("opportunities_owner_user_id_idx").on(table.ownerUserId),
    index("opportunities_stage_id_idx").on(table.stageId),
    index("opportunities_next_action_date_idx").on(table.nextActionDate),
    index("opportunities_expected_close_date_idx").on(table.expectedCloseDate),
    index("opportunities_deleted_at_idx").on(table.deletedAt)
  ]
);
