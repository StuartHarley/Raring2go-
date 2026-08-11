import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

export const seasons = pgTable(
  "seasons",
  {
    id,
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    year: integer("year").notNull(),
    season: text("season").notNull(),
    status: text("status").notNull().default("planned"),
    accent: text("accent").notNull().default("spring"),
    publicationDate: date("publication_date", { mode: "date" }),
    bookingDeadline: date("booking_deadline", { mode: "date" }),
    artworkDeadline: date("artwork_deadline", { mode: "date" }),
    editorialDeadline: date("editorial_deadline", { mode: "date" }),
    proofDeadline: date("proof_deadline", { mode: "date" }),
    printDeadline: date("print_deadline", { mode: "date" }),
    distributionDate: date("distribution_date", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("seasons_key_idx").on(table.key),
    index("seasons_year_idx").on(table.year),
    index("seasons_status_idx").on(table.status),
    index("seasons_deleted_at_idx").on(table.deletedAt)
  ]
);

export const masterEditions = pgTable(
  "master_editions",
  {
    id,
    seasonId: uuid("season_id").notNull().references(() => seasons.id),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    pageCount: integer("page_count").notNull(),
    version: integer("version").notNull().default(1),
    readiness: text("readiness").notNull().default("not_ready"),
    publicationArchive: jsonb("publication_archive").$type<Record<string, unknown>>().notNull().default({}),
    locked: boolean("locked").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("master_editions_season_version_uidx").on(table.seasonId, table.version),
    index("master_editions_season_id_idx").on(table.seasonId),
    index("master_editions_status_idx").on(table.status),
    index("master_editions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const territoryEditions = pgTable(
  "territory_editions",
  {
    id,
    masterEditionId: uuid("master_edition_id").notNull().references(() => masterEditions.id),
    seasonId: uuid("season_id").notNull().references(() => seasons.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    franchiseOrganisationId: uuid("franchise_organisation_id").references(() => organisations.id),
    editorUserId: uuid("editor_user_id").references(() => users.id),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    publicationDate: date("publication_date", { mode: "date" }),
    bookingDeadline: date("booking_deadline", { mode: "date" }),
    artworkDeadline: date("artwork_deadline", { mode: "date" }),
    editorialDeadline: date("editorial_deadline", { mode: "date" }),
    proofDeadline: date("proof_deadline", { mode: "date" }),
    printDeadline: date("print_deadline", { mode: "date" }),
    distributionDate: date("distribution_date", { mode: "date" }),
    pageCount: integer("page_count").notNull(),
    printStatus: text("print_status").notNull().default("not_started"),
    digitalStatus: text("digital_status").notNull().default("not_started"),
    readiness: text("readiness").notNull().default("not_ready"),
    version: integer("version").notNull().default(1),
    publicationArchive: jsonb("publication_archive").$type<Record<string, unknown>>().notNull().default({}),
    generatedFromMasterVersion: integer("generated_from_master_version").notNull(),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("territory_editions_master_territory_uidx").on(table.masterEditionId, table.territoryId),
    uniqueIndex("territory_editions_season_territory_uidx").on(table.seasonId, table.territoryId),
    index("territory_editions_territory_id_idx").on(table.territoryId),
    index("territory_editions_status_idx").on(table.status),
    index("territory_editions_readiness_idx").on(table.readiness),
    index("territory_editions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const magazineTemplates = pgTable(
  "magazine_templates",
  {
    id,
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("draft"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("magazine_templates_key_idx").on(table.key),
    index("magazine_templates_category_idx").on(table.category),
    index("magazine_templates_status_idx").on(table.status),
    index("magazine_templates_deleted_at_idx").on(table.deletedAt)
  ]
);

export const magazineTemplateVersions = pgTable(
  "magazine_template_versions",
  {
    id,
    templateId: uuid("template_id").notNull().references(() => magazineTemplates.id),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    pageDimensions: jsonb("page_dimensions").$type<Record<string, unknown>>().notNull(),
    bleed: jsonb("bleed").$type<Record<string, unknown>>().notNull(),
    trim: jsonb("trim").$type<Record<string, unknown>>().notNull(),
    margins: jsonb("margins").$type<Record<string, unknown>>().notNull(),
    grid: jsonb("grid").$type<Record<string, unknown>>().notNull(),
    lockedElements: jsonb("locked_elements").$type<Array<Record<string, unknown>>>().notNull().default([]),
    editableZones: jsonb("editable_zones").$type<Array<Record<string, unknown>>>().notNull().default([]),
    imageZones: jsonb("image_zones").$type<Array<Record<string, unknown>>>().notNull().default([]),
    copyZones: jsonb("copy_zones").$type<Array<Record<string, unknown>>>().notNull().default([]),
    headlineZones: jsonb("headline_zones").$type<Array<Record<string, unknown>>>().notNull().default([]),
    advertiserZones: jsonb("advertiser_zones").$type<Array<Record<string, unknown>>>().notNull().default([]),
    footerFurniture: jsonb("footer_furniture").$type<Record<string, unknown>>().notNull().default({}),
    printRules: jsonb("print_rules").$type<Record<string, unknown>>().notNull().default({}),
    digitalEnhancements: jsonb("digital_enhancements").$type<Record<string, unknown>>().notNull().default({}),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: date("approved_at", { mode: "date" }),
    publishedAt: date("published_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("magazine_template_versions_template_version_uidx").on(table.templateId, table.version),
    index("magazine_template_versions_template_id_idx").on(table.templateId),
    index("magazine_template_versions_status_idx").on(table.status),
    index("magazine_template_versions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const editionContentItems = pgTable(
  "edition_content_items",
  {
    id,
    sourceLevel: text("source_level").notNull(),
    title: text("title").notNull(),
    contentType: text("content_type").notNull(),
    status: text("status").notNull().default("draft"),
    inheritanceMode: text("inheritance_mode").notNull().default("optional"),
    locked: boolean("locked").notNull().default(false),
    localisable: boolean("localisable").notNull().default(true),
    advertiserSpecific: boolean("advertiser_specific").notNull().default(false),
    body: jsonb("body").$type<Record<string, unknown>>().notNull().default({}),
    targeting: jsonb("targeting").$type<Record<string, unknown>>().notNull().default({}),
    availableFrom: date("available_from", { mode: "date" }),
    expiresAt: date("expires_at", { mode: "date" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("edition_content_items_source_level_idx").on(table.sourceLevel),
    index("edition_content_items_status_idx").on(table.status),
    index("edition_content_items_inheritance_mode_idx").on(table.inheritanceMode),
    index("edition_content_items_deleted_at_idx").on(table.deletedAt)
  ]
);

export const territoryEditionContent = pgTable(
  "territory_edition_content",
  {
    id,
    territoryEditionId: uuid("territory_edition_id").notNull().references(() => territoryEditions.id),
    sourceContentItemId: uuid("source_content_item_id").notNull().references(() => editionContentItems.id),
    sourceVersion: integer("source_version").notNull().default(1),
    inheritanceState: text("inheritance_state").notNull().default("inherited"),
    localOverride: jsonb("local_override").$type<Record<string, unknown>>().notNull().default({}),
    effectiveContent: jsonb("effective_content").$type<Record<string, unknown>>().notNull().default({}),
    locked: boolean("locked").notNull().default(false),
    localisedByUserId: uuid("localised_by_user_id").references(() => users.id),
    localisedAt: date("localised_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("territory_edition_content_source_uidx").on(table.territoryEditionId, table.sourceContentItemId),
    index("territory_edition_content_edition_id_idx").on(table.territoryEditionId),
    index("territory_edition_content_source_id_idx").on(table.sourceContentItemId),
    index("territory_edition_content_state_idx").on(table.inheritanceState),
    index("territory_edition_content_deleted_at_idx").on(table.deletedAt)
  ]
);

export const editionPages = pgTable(
  "edition_pages",
  {
    id,
    territoryEditionId: uuid("territory_edition_id").notNull().references(() => territoryEditions.id),
    pageNumber: integer("page_number").notNull(),
    spreadNumber: integer("spread_number").notNull(),
    side: text("side").notNull(),
    status: text("status").notNull().default("empty"),
    templateVersionId: uuid("template_version_id").references(() => magazineTemplateVersions.id),
    assignedContentId: uuid("assigned_content_id").references(() => territoryEditionContent.id),
    advertiserInventoryState: text("advertiser_inventory_state").notNull().default("unassigned"),
    ownerType: text("owner_type").notNull().default("hq"),
    deadline: date("deadline", { mode: "date" }),
    sourceMarker: text("source_marker").notNull().default("central"),
    locked: boolean("locked").notNull().default(false),
    readiness: text("readiness").notNull().default("not_ready"),
    comments: jsonb("comments").$type<Array<Record<string, unknown>>>().notNull().default([]),
    issues: jsonb("issues").$type<Array<Record<string, unknown>>>().notNull().default([]),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("edition_pages_edition_page_uidx").on(table.territoryEditionId, table.pageNumber),
    index("edition_pages_edition_id_idx").on(table.territoryEditionId),
    index("edition_pages_status_idx").on(table.status),
    index("edition_pages_template_version_id_idx").on(table.templateVersionId),
    index("edition_pages_readiness_idx").on(table.readiness),
    index("edition_pages_deleted_at_idx").on(table.deletedAt)
  ]
);

export const editionPageRevisions = pgTable(
  "edition_page_revisions",
  {
    id,
    pageId: uuid("page_id").notNull().references(() => editionPages.id),
    revisionNumber: integer("revision_number").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    changeType: text("change_type").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    warnings: jsonb("warnings").$type<Array<Record<string, unknown>>>().notNull().default([]),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("edition_page_revisions_page_revision_uidx").on(table.pageId, table.revisionNumber),
    index("edition_page_revisions_page_id_idx").on(table.pageId),
    index("edition_page_revisions_change_type_idx").on(table.changeType),
    index("edition_page_revisions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const preflightResults = pgTable(
  "preflight_results",
  {
    id,
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    territoryEditionId: uuid("territory_edition_id").references(() => territoryEditions.id),
    status: text("status").notNull(),
    checks: jsonb("checks").$type<Array<Record<string, unknown>>>().notNull().default([]),
    fixes: jsonb("fixes").$type<Array<Record<string, unknown>>>().notNull().default([]),
    originalArtifact: jsonb("original_artifact").$type<Record<string, unknown>>().notNull().default({}),
    derivedArtifact: jsonb("derived_artifact").$type<Record<string, unknown>>().notNull().default({}),
    unfixableIssues: jsonb("unfixable_issues").$type<Array<Record<string, unknown>>>().notNull().default([]),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("preflight_results_entity_idx").on(table.entityType, table.entityId),
    index("preflight_results_territory_edition_id_idx").on(table.territoryEditionId),
    index("preflight_results_status_idx").on(table.status),
    index("preflight_results_deleted_at_idx").on(table.deletedAt)
  ]
);

export const publicationOutputs = pgTable(
  "publication_outputs",
  {
    id,
    territoryEditionId: uuid("territory_edition_id").notNull().references(() => territoryEditions.id),
    outputType: text("output_type").notNull(),
    status: text("status").notNull(),
    version: integer("version").notNull(),
    sourcePageSnapshot: jsonb("source_page_snapshot").$type<Array<Record<string, unknown>>>().notNull().default([]),
    artifact: jsonb("artifact").$type<Record<string, unknown>>().notNull().default({}),
    preflightResultId: uuid("preflight_result_id").references(() => preflightResults.id),
    idempotencyKey: text("idempotency_key").notNull(),
    corrections: jsonb("corrections").$type<Array<Record<string, unknown>>>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    generatedByUserId: uuid("generated_by_user_id").references(() => users.id),
    generatedAt: date("generated_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("publication_outputs_idempotency_uidx").on(table.idempotencyKey),
    index("publication_outputs_territory_edition_id_idx").on(table.territoryEditionId),
    index("publication_outputs_type_status_idx").on(table.outputType, table.status),
    index("publication_outputs_deleted_at_idx").on(table.deletedAt)
  ]
);

export const contentItems = pgTable(
  "content_items",
  {
    id,
    title: text("title").notNull(),
    standfirst: text("standfirst"),
    contentType: text("content_type").notNull(),
    ownerLevel: text("owner_level").notNull().default("network"),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    status: text("status").notNull().default("draft"),
    authorUserId: uuid("author_user_id").references(() => users.id),
    sourceType: text("source_type").notNull().default("human"),
    sourceReference: text("source_reference"),
    heroArtifactReference: jsonb("hero_artifact_reference").$type<Record<string, unknown>>().notNull().default({}),
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    relevantDates: jsonb("relevant_dates").$type<Record<string, unknown>>().notNull().default({}),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
    advertiserId: uuid("advertiser_id"),
    commercialBookingId: uuid("commercial_booking_id"),
    editionContentItemId: uuid("edition_content_item_id").references(() => editionContentItems.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: date("approved_at", { mode: "date" }),
    publishedAt: date("published_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("content_items_type_idx").on(table.contentType),
    index("content_items_owner_level_idx").on(table.ownerLevel),
    index("content_items_territory_id_idx").on(table.territoryId),
    index("content_items_status_idx").on(table.status),
    index("content_items_deleted_at_idx").on(table.deletedAt)
  ]
);

export const contentItemVersions = pgTable(
  "content_item_versions",
  {
    id,
    contentItemId: uuid("content_item_id").notNull().references(() => contentItems.id),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    changeSummary: text("change_summary"),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("content_item_versions_item_version_uidx").on(table.contentItemId, table.versionNumber),
    index("content_item_versions_item_id_idx").on(table.contentItemId),
    index("content_item_versions_status_idx").on(table.status),
    index("content_item_versions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const contentChannelVariants = pgTable(
  "content_channel_variants",
  {
    id,
    contentItemId: uuid("content_item_id").notNull().references(() => contentItems.id),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("not_created"),
    currentVersionId: uuid("current_version_id"),
    territoryId: uuid("territory_id").references(() => territories.id),
    scheduledAt: date("scheduled_at", { mode: "date" }),
    publishedAt: date("published_at", { mode: "date" }),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("content_channel_variants_item_channel_territory_uidx").on(table.contentItemId, table.channel, table.territoryId),
    index("content_channel_variants_item_id_idx").on(table.contentItemId),
    index("content_channel_variants_channel_idx").on(table.channel),
    index("content_channel_variants_status_idx").on(table.status),
    index("content_channel_variants_deleted_at_idx").on(table.deletedAt)
  ]
);

export const contentChannelVariantVersions = pgTable(
  "content_channel_variant_versions",
  {
    id,
    variantId: uuid("variant_id").notNull().references(() => contentChannelVariants.id),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("ai_draft"),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    generatedByTaskId: uuid("generated_by_task_id"),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: date("approved_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("content_channel_variant_versions_variant_version_uidx").on(table.variantId, table.versionNumber),
    index("content_channel_variant_versions_variant_id_idx").on(table.variantId),
    index("content_channel_variant_versions_status_idx").on(table.status),
    index("content_channel_variant_versions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const contentLocalisations = pgTable(
  "content_localisations",
  {
    id,
    masterContentItemId: uuid("master_content_item_id").notNull().references(() => contentItems.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    localContentItemId: uuid("local_content_item_id").references(() => contentItems.id),
    state: text("state").notNull().default("inherited"),
    lockedFields: jsonb("locked_fields").$type<string[]>().notNull().default([]),
    editableFields: jsonb("editable_fields").$type<string[]>().notNull().default([]),
    localOverrides: jsonb("local_overrides").$type<Record<string, unknown>>().notNull().default({}),
    masterVersionNumber: integer("master_version_number").notNull().default(1),
    reviewedAt: date("reviewed_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("content_localisations_master_territory_uidx").on(table.masterContentItemId, table.territoryId),
    index("content_localisations_master_id_idx").on(table.masterContentItemId),
    index("content_localisations_territory_id_idx").on(table.territoryId),
    index("content_localisations_state_idx").on(table.state),
    index("content_localisations_deleted_at_idx").on(table.deletedAt)
  ]
);

export const contentAiTasks = pgTable(
  "content_ai_tasks",
  {
    id,
    task: text("task").notNull(),
    contentItemId: uuid("content_item_id").notNull().references(() => contentItems.id),
    sourceVersionId: uuid("source_version_id").references(() => contentItemVersions.id),
    targetChannel: text("target_channel"),
    status: text("status").notNull().default("generated"),
    providerKey: text("provider_key"),
    modelReference: text("model_reference"),
    promptTemplateVersion: text("prompt_template_version").notNull(),
    generatedOutput: jsonb("generated_output").$type<Record<string, unknown>>().notNull(),
    generatedAt: date("generated_at", { mode: "date" }).notNull(),
    humanDecision: text("human_decision"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    decidedAt: date("decided_at", { mode: "date" }),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("content_ai_tasks_task_idx").on(table.task),
    index("content_ai_tasks_content_item_id_idx").on(table.contentItemId),
    index("content_ai_tasks_target_channel_idx").on(table.targetChannel),
    index("content_ai_tasks_deleted_at_idx").on(table.deletedAt)
  ]
);

export const contentWebsitePublishingJobs = pgTable(
  "content_website_publishing_jobs",
  {
    id,
    contentItemId: uuid("content_item_id").notNull().references(() => contentItems.id),
    variantId: uuid("variant_id").references(() => contentChannelVariants.id),
    providerKey: text("provider_key").notNull().default("development"),
    status: text("status").notNull().default("ready"),
    preparedSnapshot: jsonb("prepared_snapshot").$type<Record<string, unknown>>().notNull(),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    preparedAt: date("prepared_at", { mode: "date" }).notNull(),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("content_website_jobs_idempotency_uidx").on(table.idempotencyKey),
    index("content_website_jobs_content_item_id_idx").on(table.contentItemId),
    index("content_website_jobs_status_idx").on(table.status),
    index("content_website_jobs_deleted_at_idx").on(table.deletedAt)
  ]
);

export const contentDomainEvents = pgTable(
  "content_domain_events",
  {
    id,
    eventType: text("event_type").notNull(),
    contentItemId: uuid("content_item_id").references(() => contentItems.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: date("occurred_at", { mode: "date" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    processedAt: date("processed_at", { mode: "date" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("content_domain_events_idempotency_uidx").on(table.idempotencyKey),
    index("content_domain_events_type_idx").on(table.eventType),
    index("content_domain_events_content_item_id_idx").on(table.contentItemId)
  ]
);

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id,
    channel: text("channel").notNull(),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    externalAccountReference: text("external_account_reference").notNull(),
    displayName: text("display_name").notNull(),
    connectionStatus: text("connection_status").notNull().default("connected"),
    connectionHealth: text("connection_health").notNull().default("healthy"),
    capabilityMetadata: jsonb("capability_metadata").$type<Record<string, unknown>>().notNull().default({}),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("social_accounts_external_reference_uidx").on(table.channel, table.externalAccountReference),
    index("social_accounts_channel_idx").on(table.channel),
    index("social_accounts_territory_id_idx").on(table.territoryId),
    index("social_accounts_connection_status_idx").on(table.connectionStatus),
    index("social_accounts_deleted_at_idx").on(table.deletedAt)
  ]
);

export const socialPublications = pgTable(
  "social_publications",
  {
    id,
    contentItemId: uuid("content_item_id").notNull().references(() => contentItems.id),
    variantId: uuid("variant_id").references(() => contentChannelVariants.id),
    variantVersionId: uuid("variant_version_id").references(() => contentChannelVariantVersions.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    socialAccountId: uuid("social_account_id").notNull().references(() => socialAccounts.id),
    channel: text("channel").notNull(),
    approvalState: text("approval_state").notNull().default("draft"),
    publishState: text("publish_state").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    timezone: text("timezone").notNull().default("Europe/London"),
    immutableSnapshot: jsonb("immutable_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    mediaArtifactReferences: jsonb("media_artifact_references").$type<Array<Record<string, unknown>>>().notNull().default([]),
    cta: text("cta"),
    linkUrl: text("link_url"),
    advertiserId: uuid("advertiser_id"),
    commercialBookingId: uuid("commercial_booking_id"),
    publishedExternalReference: text("published_external_reference"),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    failureMetadata: jsonb("failure_metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    scheduledByUserId: uuid("scheduled_by_user_id").references(() => users.id),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("social_publications_idempotency_uidx").on(table.idempotencyKey),
    index("social_publications_content_item_id_idx").on(table.contentItemId),
    index("social_publications_variant_id_idx").on(table.variantId),
    index("social_publications_territory_id_idx").on(table.territoryId),
    index("social_publications_account_id_idx").on(table.socialAccountId),
    index("social_publications_publish_state_idx").on(table.publishState),
    index("social_publications_scheduled_at_idx").on(table.scheduledAt),
    index("social_publications_deleted_at_idx").on(table.deletedAt)
  ]
);

export const socialPublishJobs = pgTable(
  "social_publish_jobs",
  {
    id,
    publicationId: uuid("publication_id").notNull().references(() => socialPublications.id),
    status: text("status").notNull().default("queued"),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    providerKey: text("provider_key").notNull().default("development"),
    providerRequest: jsonb("provider_request").$type<Record<string, unknown>>().notNull().default({}),
    providerResponse: jsonb("provider_response").$type<Record<string, unknown>>().notNull().default({}),
    lastError: text("last_error"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("social_publish_jobs_idempotency_uidx").on(table.idempotencyKey),
    index("social_publish_jobs_publication_id_idx").on(table.publicationId),
    index("social_publish_jobs_status_idx").on(table.status),
    index("social_publish_jobs_run_after_idx").on(table.runAfter)
  ]
);

export const socialProviderEvents = pgTable(
  "social_provider_events",
  {
    id,
    publicationId: uuid("publication_id").references(() => socialPublications.id),
    providerKey: text("provider_key").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("social_provider_events_uidx").on(table.providerKey, table.providerEventId),
    index("social_provider_events_publication_id_idx").on(table.publicationId),
    index("social_provider_events_event_type_idx").on(table.eventType)
  ]
);
