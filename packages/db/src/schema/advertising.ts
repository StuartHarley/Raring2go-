import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";
import { users } from "./identity";
import { editionPages, preflightResults, territoryEditions } from "./publishing";
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

export const advertiserTerms = pgTable(
  "advertiser_terms",
  {
    id,
    key: text("key").notNull(),
    version: text("version").notNull(),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull(),
    contentHash: text("content_hash").notNull(),
    contentSnapshot: jsonb("content_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    approvedAt: date("approved_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("advertiser_terms_key_version_uidx").on(table.key, table.version),
    index("advertiser_terms_status_idx").on(table.status),
    index("advertiser_terms_deleted_at_idx").on(table.deletedAt)
  ]
);

export const advertiserProposalAcceptances = pgTable(
  "advertiser_proposal_acceptances",
  {
    id,
    proposalId: uuid("proposal_id").notNull().references(() => commercialProposals.id),
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    termsId: uuid("terms_id").notNull().references(() => advertiserTerms.id),
    bookingId: uuid("booking_id").references(() => commercialBookings.id),
    method: text("method").notNull(),
    status: text("status").notNull(),
    acceptedByContactId: uuid("accepted_by_contact_id").references(() => advertiserContacts.id),
    acceptedAt: date("accepted_at", { mode: "date" }),
    rejectedAt: date("rejected_at", { mode: "date" }),
    requestMetadata: jsonb("request_metadata").$type<Record<string, unknown>>().notNull().default({}),
    commercialSnapshot: jsonb("commercial_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("advertiser_proposal_acceptances_idempotency_uidx").on(table.idempotencyKey),
    index("advertiser_proposal_acceptances_proposal_id_idx").on(table.proposalId),
    index("advertiser_proposal_acceptances_advertiser_id_idx").on(table.advertiserId),
    index("advertiser_proposal_acceptances_status_idx").on(table.status),
    index("advertiser_proposal_acceptances_deleted_at_idx").on(table.deletedAt)
  ]
);

export const advertiserDomainEvents = pgTable(
  "advertiser_domain_events",
  {
    id,
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    advertiserId: uuid("advertiser_id").references(() => advertisers.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    processedAt: date("processed_at", { mode: "date" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("advertiser_domain_events_idempotency_uidx").on(table.idempotencyKey),
    index("advertiser_domain_events_type_idx").on(table.eventType),
    index("advertiser_domain_events_entity_idx").on(table.entityType, table.entityId)
  ]
);

export const advertiserInvoiceSequences = pgTable(
  "advertiser_invoice_sequences",
  {
    id,
    issuerOrganisationId: uuid("issuer_organisation_id").notNull().references(() => organisations.id),
    key: text("key").notNull().default("default"),
    prefix: text("prefix").notNull().default("INV"),
    nextNumber: integer("next_number").notNull().default(1),
    padding: integer("padding").notNull().default(5),
    ...timestamps
  },
  (table) => [
    uniqueIndex("advertiser_invoice_sequences_issuer_key_uidx").on(table.issuerOrganisationId, table.key)
  ]
);

export const advertiserInvoices = pgTable(
  "advertiser_invoices",
  {
    id,
    issuerOrganisationId: uuid("issuer_organisation_id").notNull().references(() => organisations.id),
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    customerOrganisationId: uuid("customer_organisation_id").notNull().references(() => organisations.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    bookingId: uuid("booking_id").references(() => commercialBookings.id),
    invoiceNumber: text("invoice_number").notNull(),
    status: text("status").notNull().default("draft"),
    issueDate: date("issue_date", { mode: "date" }),
    dueDate: date("due_date", { mode: "date" }),
    voidedAt: date("voided_at", { mode: "date" }),
    currency: text("currency").notNull().default("GBP"),
    subtotalMinor: integer("subtotal_minor").notNull().default(0),
    taxMinor: integer("tax_minor").notNull().default(0),
    totalMinor: integer("total_minor").notNull().default(0),
    amountPaidMinor: integer("amount_paid_minor").notNull().default(0),
    balanceMinor: integer("balance_minor").notNull().default(0),
    billingSnapshot: jsonb("billing_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    paymentTermsSnapshot: jsonb("payment_terms_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    issuedSnapshot: jsonb("issued_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("advertiser_invoices_issuer_number_uidx").on(table.issuerOrganisationId, table.invoiceNumber),
    index("advertiser_invoices_advertiser_id_idx").on(table.advertiserId),
    index("advertiser_invoices_territory_id_idx").on(table.territoryId),
    index("advertiser_invoices_status_idx").on(table.status),
    index("advertiser_invoices_due_date_idx").on(table.dueDate),
    index("advertiser_invoices_deleted_at_idx").on(table.deletedAt)
  ]
);

export const advertiserInvoiceLines = pgTable(
  "advertiser_invoice_lines",
  {
    id,
    invoiceId: uuid("invoice_id").notNull().references(() => advertiserInvoices.id),
    bookingItemId: uuid("booking_item_id").references(() => commercialBookingItems.id),
    productId: uuid("product_id").references(() => commercialProducts.id),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    netMinor: integer("net_minor").notNull(),
    taxRateBps: integer("tax_rate_bps").notNull().default(2000),
    taxMinor: integer("tax_minor").notNull(),
    grossMinor: integer("gross_minor").notNull(),
    taxCode: text("tax_code").notNull().default("standard_vat"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("advertiser_invoice_lines_invoice_id_idx").on(table.invoiceId),
    index("advertiser_invoice_lines_booking_item_id_idx").on(table.bookingItemId),
    index("advertiser_invoice_lines_deleted_at_idx").on(table.deletedAt)
  ]
);

export const advertiserCreditNotes = pgTable(
  "advertiser_credit_notes",
  {
    id,
    invoiceId: uuid("invoice_id").notNull().references(() => advertiserInvoices.id),
    issuerOrganisationId: uuid("issuer_organisation_id").notNull().references(() => organisations.id),
    creditNoteNumber: text("credit_note_number").notNull(),
    reason: text("reason").notNull(),
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id),
    issuedDate: date("issued_date", { mode: "date" }).notNull(),
    currency: text("currency").notNull().default("GBP"),
    subtotalMinor: integer("subtotal_minor").notNull().default(0),
    taxMinor: integer("tax_minor").notNull().default(0),
    totalMinor: integer("total_minor").notNull().default(0),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("advertiser_credit_notes_issuer_number_uidx").on(table.issuerOrganisationId, table.creditNoteNumber),
    index("advertiser_credit_notes_invoice_id_idx").on(table.invoiceId),
    index("advertiser_credit_notes_deleted_at_idx").on(table.deletedAt)
  ]
);

export const advertiserCreditNoteLines = pgTable(
  "advertiser_credit_note_lines",
  {
    id,
    creditNoteId: uuid("credit_note_id").notNull().references(() => advertiserCreditNotes.id),
    invoiceLineId: uuid("invoice_line_id").references(() => advertiserInvoiceLines.id),
    description: text("description").notNull(),
    netMinor: integer("net_minor").notNull(),
    taxRateBps: integer("tax_rate_bps").notNull().default(2000),
    taxMinor: integer("tax_minor").notNull(),
    grossMinor: integer("gross_minor").notNull(),
    taxCode: text("tax_code").notNull().default("standard_vat"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("advertiser_credit_note_lines_credit_note_id_idx").on(table.creditNoteId),
    index("advertiser_credit_note_lines_deleted_at_idx").on(table.deletedAt)
  ]
);

export const advertiserPayments = pgTable(
  "advertiser_payments",
  {
    id,
    issuerOrganisationId: uuid("issuer_organisation_id").notNull().references(() => organisations.id),
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    payerOrganisationId: uuid("payer_organisation_id").notNull().references(() => organisations.id),
    amountMinor: integer("amount_minor").notNull(),
    allocatedMinor: integer("allocated_minor").notNull().default(0),
    unallocatedMinor: integer("unallocated_minor").notNull(),
    currency: text("currency").notNull().default("GBP"),
    receivedDate: date("received_date", { mode: "date" }).notNull(),
    method: text("method").notNull(),
    providerKey: text("provider_key"),
    externalReference: text("external_reference"),
    providerEventId: text("provider_event_id"),
    status: text("status").notNull().default("received"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("advertiser_payments_provider_event_uidx").on(table.providerKey, table.providerEventId),
    index("advertiser_payments_advertiser_id_idx").on(table.advertiserId),
    index("advertiser_payments_issuer_idx").on(table.issuerOrganisationId),
    index("advertiser_payments_deleted_at_idx").on(table.deletedAt)
  ]
);

export const advertiserPaymentAllocations = pgTable(
  "advertiser_payment_allocations",
  {
    id,
    paymentId: uuid("payment_id").notNull().references(() => advertiserPayments.id),
    invoiceId: uuid("invoice_id").notNull().references(() => advertiserInvoices.id),
    amountMinor: integer("amount_minor").notNull(),
    allocatedAt: date("allocated_at", { mode: "date" }).notNull(),
    status: text("status").notNull().default("allocated"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("advertiser_payment_allocations_payment_id_idx").on(table.paymentId),
    index("advertiser_payment_allocations_invoice_id_idx").on(table.invoiceId),
    index("advertiser_payment_allocations_deleted_at_idx").on(table.deletedAt)
  ]
);

export const advertiserProviderSyncReferences = pgTable(
  "advertiser_provider_sync_references",
  {
    id,
    providerType: text("provider_type").notNull(),
    providerKey: text("provider_key").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    providerEntityId: text("provider_entity_id"),
    status: text("status").notNull().default("pending"),
    lastSyncedAt: date("last_synced_at", { mode: "date" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => [
    uniqueIndex("advertiser_provider_sync_entity_uidx").on(table.providerType, table.providerKey, table.entityType, table.entityId),
    index("advertiser_provider_sync_status_idx").on(table.status)
  ]
);

export const artworkRequirements = pgTable(
  "artwork_requirements",
  {
    id,
    productionRequestId: uuid("production_request_id").notNull().references(() => commercialProductionRequests.id),
    bookingItemId: uuid("booking_item_id").notNull().references(() => commercialBookingItems.id),
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    territoryEditionId: uuid("territory_edition_id").references(() => territoryEditions.id),
    editionPageId: uuid("edition_page_id").references(() => editionPages.id),
    inventorySlotId: uuid("inventory_slot_id").references(() => inventorySlots.id),
    sourceType: text("source_type").notNull().default("advertiser_supplied"),
    status: text("status").notNull().default("requested"),
    specification: jsonb("specification").$type<Record<string, unknown>>().notNull().default({}),
    dimensions: jsonb("dimensions").$type<Record<string, unknown>>().notNull().default({}),
    contentFields: jsonb("content_fields").$type<Record<string, unknown>>().notNull().default({}),
    deadline: date("deadline", { mode: "date" }),
    approvedVersionId: uuid("approved_version_id"),
    proofReference: jsonb("proof_reference").$type<Record<string, unknown>>().notNull().default({}),
    advertiserApprovedAt: date("advertiser_approved_at", { mode: "date" }),
    productionApprovedAt: date("production_approved_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("artwork_requirements_production_request_uidx").on(table.productionRequestId),
    index("artwork_requirements_advertiser_id_idx").on(table.advertiserId),
    index("artwork_requirements_territory_id_idx").on(table.territoryId),
    index("artwork_requirements_status_idx").on(table.status),
    index("artwork_requirements_deleted_at_idx").on(table.deletedAt)
  ]
);

export const artworkVersions = pgTable(
  "artwork_versions",
  {
    id,
    artworkRequirementId: uuid("artwork_requirement_id").notNull().references(() => artworkRequirements.id),
    versionNumber: integer("version_number").notNull(),
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id),
    assetReference: jsonb("asset_reference").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("submitted"),
    preflightResultId: uuid("preflight_result_id").references(() => preflightResults.id),
    notes: text("notes"),
    submittedAt: date("submitted_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("artwork_versions_requirement_version_uidx").on(table.artworkRequirementId, table.versionNumber),
    index("artwork_versions_requirement_id_idx").on(table.artworkRequirementId),
    index("artwork_versions_preflight_result_id_idx").on(table.preflightResultId),
    index("artwork_versions_status_idx").on(table.status),
    index("artwork_versions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const campaignFulfilments = pgTable(
  "campaign_fulfilments",
  {
    id,
    bookingId: uuid("booking_id").notNull().references(() => commercialBookings.id),
    bookingItemId: uuid("booking_item_id").notNull().references(() => commercialBookingItems.id),
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    artworkRequirementId: uuid("artwork_requirement_id").references(() => artworkRequirements.id),
    territoryEditionId: uuid("territory_edition_id").references(() => territoryEditions.id),
    editionPageId: uuid("edition_page_id").references(() => editionPages.id),
    status: text("status").notNull().default("scheduled"),
    channel: text("channel").notNull().default("print"),
    scheduledOn: date("scheduled_on", { mode: "date" }),
    fulfilledOn: date("fulfilled_on", { mode: "date" }),
    placementReference: jsonb("placement_reference").$type<Record<string, unknown>>().notNull().default({}),
    performanceReference: jsonb("performance_reference").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("campaign_fulfilments_booking_item_uidx").on(table.bookingItemId),
    index("campaign_fulfilments_advertiser_id_idx").on(table.advertiserId),
    index("campaign_fulfilments_territory_id_idx").on(table.territoryId),
    index("campaign_fulfilments_status_idx").on(table.status),
    index("campaign_fulfilments_deleted_at_idx").on(table.deletedAt)
  ]
);

export const proofPacks = pgTable(
  "proof_packs",
  {
    id,
    fulfilmentId: uuid("fulfilment_id").notNull().references(() => campaignFulfilments.id),
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    status: text("status").notNull().default("draft"),
    issuedAt: date("issued_at", { mode: "date" }),
    deliveredAt: date("delivered_at", { mode: "date" }),
    proofSnapshot: jsonb("proof_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    artefactReference: jsonb("artefact_reference").$type<Record<string, unknown>>().notNull().default({}),
    metricsSnapshot: jsonb("metrics_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    renewalPromptId: uuid("renewal_prompt_id"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("proof_packs_fulfilment_uidx").on(table.fulfilmentId),
    index("proof_packs_advertiser_id_idx").on(table.advertiserId),
    index("proof_packs_territory_id_idx").on(table.territoryId),
    index("proof_packs_status_idx").on(table.status),
    index("proof_packs_deleted_at_idx").on(table.deletedAt)
  ]
);

export const renewalPrompts = pgTable(
  "renewal_prompts",
  {
    id,
    advertiserId: uuid("advertiser_id").notNull().references(() => advertisers.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    sourceBookingId: uuid("source_booking_id").references(() => commercialBookings.id),
    sourceProofPackId: uuid("source_proof_pack_id").references(() => proofPacks.id),
    status: text("status").notNull().default("open"),
    dueOn: date("due_on", { mode: "date" }),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id),
    renewalSnapshot: jsonb("renewal_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("renewal_prompts_advertiser_id_idx").on(table.advertiserId),
    index("renewal_prompts_territory_id_idx").on(table.territoryId),
    index("renewal_prompts_status_idx").on(table.status),
    index("renewal_prompts_due_on_idx").on(table.dueOn),
    index("renewal_prompts_deleted_at_idx").on(table.deletedAt)
  ]
);
