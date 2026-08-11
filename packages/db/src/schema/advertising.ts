import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";
import { users } from "./identity";
import { editionPages, territoryEditions } from "./publishing";
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

export const commercialProducts = pgTable(
  "commercial_products",
  {
    id,
    key: text("key").notNull(),
    name: text("name").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("active"),
    requiresInventory: boolean("requires_inventory").notNull().default(false),
    requiresArtwork: boolean("requires_artwork").notNull().default(false),
    taxCode: text("tax_code").notNull().default("standard_vat"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("commercial_products_key_uidx").on(table.key),
    index("commercial_products_channel_idx").on(table.channel),
    index("commercial_products_deleted_at_idx").on(table.deletedAt)
  ]
);

export const commercialPackages = pgTable(
  "commercial_packages",
  {
    id,
    key: text("key").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    lines: jsonb("lines").$type<Array<Record<string, unknown>>>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("commercial_packages_key_uidx").on(table.key),
    index("commercial_packages_deleted_at_idx").on(table.deletedAt)
  ]
);

export const priceBooks = pgTable(
  "price_books",
  {
    id,
    key: text("key").notNull(),
    name: text("name").notNull(),
    territoryId: uuid("territory_id").references(() => territories.id),
    status: text("status").notNull().default("active"),
    effectiveFrom: date("effective_from", { mode: "date" }),
    effectiveTo: date("effective_to", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("price_books_key_uidx").on(table.key),
    index("price_books_territory_id_idx").on(table.territoryId),
    index("price_books_deleted_at_idx").on(table.deletedAt)
  ]
);

export const priceBookItems = pgTable(
  "price_book_items",
  {
    id,
    priceBookId: uuid("price_book_id").notNull().references(() => priceBooks.id),
    productId: uuid("product_id").notNull().references(() => commercialProducts.id),
    standardPriceMinor: integer("standard_price_minor").notNull(),
    minimumPriceMinor: integer("minimum_price_minor").notNull(),
    currency: text("currency").notNull().default("GBP"),
    approvalRequiredBelowMinor: integer("approval_required_below_minor").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("price_book_items_book_product_uidx").on(table.priceBookId, table.productId),
    index("price_book_items_product_id_idx").on(table.productId),
    index("price_book_items_deleted_at_idx").on(table.deletedAt)
  ]
);

export const inventorySlots = pgTable(
  "inventory_slots",
  {
    id,
    territoryEditionId: uuid("territory_edition_id").references(() => territoryEditions.id),
    editionPageId: uuid("edition_page_id").references(() => editionPages.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    productId: uuid("product_id").notNull().references(() => commercialProducts.id),
    slotKey: text("slot_key").notNull(),
    inventoryClass: text("inventory_class").notNull(),
    exclusive: boolean("exclusive").notNull().default(true),
    status: text("status").notNull().default("available"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("inventory_slots_slot_uidx").on(table.territoryEditionId, table.slotKey),
    index("inventory_slots_territory_id_idx").on(table.territoryId),
    index("inventory_slots_product_id_idx").on(table.productId),
    index("inventory_slots_status_idx").on(table.status),
    index("inventory_slots_deleted_at_idx").on(table.deletedAt)
  ]
);

export const inventoryReservations = pgTable(
  "inventory_reservations",
  {
    id,
    inventorySlotId: uuid("inventory_slot_id").notNull().references(() => inventorySlots.id),
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id),
    status: text("status").notNull().default("reserved"),
    reservedByUserId: uuid("reserved_by_user_id").references(() => users.id),
    expiresOn: date("expires_on", { mode: "date" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("inventory_reservations_slot_id_idx").on(table.inventorySlotId),
    index("inventory_reservations_advertiser_id_idx").on(table.advertiserId),
    index("inventory_reservations_status_idx").on(table.status),
    index("inventory_reservations_deleted_at_idx").on(table.deletedAt)
  ]
);

export const commercialProposals = pgTable(
  "commercial_proposals",
  {
    id,
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    status: text("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    totalValueMinor: integer("total_value_minor").notNull().default(0),
    currency: text("currency").notNull().default("GBP"),
    validUntil: date("valid_until", { mode: "date" }),
    sentOn: date("sent_on", { mode: "date" }),
    acceptedOn: date("accepted_on", { mode: "date" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("commercial_proposals_advertiser_id_idx").on(table.advertiserId),
    index("commercial_proposals_opportunity_id_idx").on(table.opportunityId),
    index("commercial_proposals_territory_id_idx").on(table.territoryId),
    index("commercial_proposals_status_idx").on(table.status),
    index("commercial_proposals_deleted_at_idx").on(table.deletedAt)
  ]
);

export const commercialProposalItems = pgTable(
  "commercial_proposal_items",
  {
    id,
    proposalId: uuid("proposal_id").notNull().references(() => commercialProposals.id),
    productId: uuid("product_id").notNull().references(() => commercialProducts.id),
    packageId: uuid("package_id").references(() => commercialPackages.id),
    inventorySlotId: uuid("inventory_slot_id").references(() => inventorySlots.id),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    totalPriceMinor: integer("total_price_minor").notNull(),
    currency: text("currency").notNull().default("GBP"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("commercial_proposal_items_proposal_id_idx").on(table.proposalId),
    index("commercial_proposal_items_product_id_idx").on(table.productId),
    index("commercial_proposal_items_inventory_slot_id_idx").on(table.inventorySlotId),
    index("commercial_proposal_items_deleted_at_idx").on(table.deletedAt)
  ]
);

export const commercialBookings = pgTable(
  "commercial_bookings",
  {
    id,
    proposalId: uuid("proposal_id").notNull().references(() => commercialProposals.id),
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    status: text("status").notNull().default("booked"),
    bookedOn: date("booked_on", { mode: "date" }).notNull(),
    totalValueMinor: integer("total_value_minor").notNull().default(0),
    currency: text("currency").notNull().default("GBP"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("commercial_bookings_proposal_uidx").on(table.proposalId),
    index("commercial_bookings_advertiser_id_idx").on(table.advertiserId),
    index("commercial_bookings_territory_id_idx").on(table.territoryId),
    index("commercial_bookings_status_idx").on(table.status),
    index("commercial_bookings_deleted_at_idx").on(table.deletedAt)
  ]
);

export const commercialBookingItems = pgTable(
  "commercial_booking_items",
  {
    id,
    bookingId: uuid("booking_id").notNull().references(() => commercialBookings.id),
    proposalItemId: uuid("proposal_item_id").notNull().references(() => commercialProposalItems.id),
    productId: uuid("product_id").notNull().references(() => commercialProducts.id),
    inventoryReservationId: uuid("inventory_reservation_id").references(() => inventoryReservations.id),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    totalPriceMinor: integer("total_price_minor").notNull(),
    currency: text("currency").notNull().default("GBP"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("commercial_booking_items_booking_id_idx").on(table.bookingId),
    index("commercial_booking_items_proposal_item_id_idx").on(table.proposalItemId),
    index("commercial_booking_items_inventory_reservation_id_idx").on(table.inventoryReservationId),
    index("commercial_booking_items_deleted_at_idx").on(table.deletedAt)
  ]
);

export const commercialProductionRequests = pgTable(
  "commercial_production_requests",
  {
    id,
    bookingId: uuid("booking_id").notNull().references(() => commercialBookings.id),
    bookingItemId: uuid("booking_item_id").notNull().references(() => commercialBookingItems.id),
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    requestType: text("request_type").notNull(),
    status: text("status").notNull().default("requested"),
    dueOn: date("due_on", { mode: "date" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("commercial_production_requests_booking_item_uidx").on(table.bookingItemId),
    index("commercial_production_requests_booking_id_idx").on(table.bookingId),
    index("commercial_production_requests_advertiser_id_idx").on(table.advertiserId),
    index("commercial_production_requests_status_idx").on(table.status),
    index("commercial_production_requests_deleted_at_idx").on(table.deletedAt)
  ]
);
