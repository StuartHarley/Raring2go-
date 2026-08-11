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

export const audiencePreferenceProfiles = pgTable(
  "audience_preference_profiles",
  {
    id,
    contactId: uuid("contact_id").notNull().references(() => audienceContacts.id),
    homeTerritoryId: uuid("home_territory_id").references(() => territories.id),
    followedTerritoryIds: uuid("followed_territory_ids").array().notNull().default([]),
    childAgeBands: jsonb("child_age_bands").$type<string[]>().notNull().default([]),
    interests: jsonb("interests").$type<string[]>().notNull().default([]),
    eventCategories: jsonb("event_categories").$type<string[]>().notNull().default([]),
    offerPreferences: jsonb("offer_preferences").$type<string[]>().notNull().default([]),
    competitionPreferences: jsonb("competition_preferences").$type<string[]>().notNull().default([]),
    newsletterFrequency: text("newsletter_frequency").notNull().default("weekly"),
    communicationPreferences: jsonb("communication_preferences").$type<Record<string, unknown>>().notNull().default({}),
    personalisationEnabled: boolean("personalisation_enabled").notNull().default(true),
    privacyMetadata: jsonb("privacy_metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("audience_preference_profiles_contact_uidx").on(table.contactId),
    index("audience_preference_profiles_home_territory_idx").on(table.homeTerritoryId),
    index("audience_preference_profiles_deleted_at_idx").on(table.deletedAt)
  ]
);

export const audienceSavedContent = pgTable(
  "audience_saved_content",
  {
    id,
    contactId: uuid("contact_id").notNull().references(() => audienceContacts.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    contentType: text("content_type").notNull(),
    contentReferenceId: uuid("content_reference_id"),
    title: text("title").notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("audience_saved_content_contact_id_idx").on(table.contactId),
    index("audience_saved_content_territory_id_idx").on(table.territoryId),
    index("audience_saved_content_deleted_at_idx").on(table.deletedAt)
  ]
);

export const emailTemplates = pgTable(
  "email_templates",
  {
    id,
    key: text("key").notNull(),
    name: text("name").notNull(),
    templateType: text("template_type").notNull().default("newsletter"),
    status: text("status").notNull().default("draft"),
    blocks: jsonb("blocks").$type<Array<Record<string, unknown>>>().notNull().default([]),
    requiredBlocks: jsonb("required_blocks").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("email_templates_key_uidx").on(table.key),
    index("email_templates_status_idx").on(table.status),
    index("email_templates_deleted_at_idx").on(table.deletedAt)
  ]
);

export const emailCampaigns = pgTable(
  "email_campaigns",
  {
    id,
    territoryId: uuid("territory_id").references(() => territories.id),
    templateId: uuid("template_id").references(() => emailTemplates.id),
    segmentId: uuid("segment_id").references(() => audienceSegments.id),
    campaignType: text("campaign_type").notNull().default("newsletter"),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull(),
    subject: text("subject").notNull(),
    preheader: text("preheader"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("email_campaigns_territory_id_idx").on(table.territoryId),
    index("email_campaigns_segment_id_idx").on(table.segmentId),
    index("email_campaigns_status_idx").on(table.status),
    index("email_campaigns_deleted_at_idx").on(table.deletedAt)
  ]
);

export const emailCampaignVersions = pgTable(
  "email_campaign_versions",
  {
    id,
    campaignId: uuid("campaign_id").notNull().references(() => emailCampaigns.id),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    subject: text("subject").notNull(),
    preheader: text("preheader"),
    contentSnapshot: jsonb("content_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("email_campaign_versions_campaign_version_uidx").on(table.campaignId, table.versionNumber),
    index("email_campaign_versions_campaign_id_idx").on(table.campaignId),
    index("email_campaign_versions_status_idx").on(table.status),
    index("email_campaign_versions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const emailRecipientSnapshots = pgTable(
  "email_recipient_snapshots",
  {
    id,
    campaignId: uuid("campaign_id").notNull().references(() => emailCampaigns.id),
    campaignVersionId: uuid("campaign_version_id").notNull().references(() => emailCampaignVersions.id),
    segmentId: uuid("segment_id").references(() => audienceSegments.id),
    status: text("status").notNull().default("created"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    recipientCount: integer("recipient_count").notNull().default(0),
    excludedCount: integer("excluded_count").notNull().default(0),
    recipients: jsonb("recipients").$type<Array<Record<string, unknown>>>().notNull().default([]),
    exclusions: jsonb("exclusions").$type<Array<Record<string, unknown>>>().notNull().default([]),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("email_recipient_snapshots_idempotency_uidx").on(table.idempotencyKey),
    index("email_recipient_snapshots_campaign_id_idx").on(table.campaignId)
  ]
);

export const emailDeliveryRecords = pgTable(
  "email_delivery_records",
  {
    id,
    campaignId: uuid("campaign_id").notNull().references(() => emailCampaigns.id),
    campaignVersionId: uuid("campaign_version_id").notNull().references(() => emailCampaignVersions.id),
    recipientSnapshotId: uuid("recipient_snapshot_id").references(() => emailRecipientSnapshots.id),
    contactId: uuid("contact_id").references(() => audienceContacts.id),
    emailNormalised: text("email_normalised").notNull(),
    providerKey: text("provider_key"),
    providerMessageId: text("provider_message_id"),
    status: text("status").notNull().default("queued"),
    eventType: text("event_type"),
    eventAt: timestamp("event_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("email_delivery_provider_message_uidx").on(table.providerKey, table.providerMessageId, table.eventType),
    index("email_delivery_campaign_id_idx").on(table.campaignId),
    index("email_delivery_contact_id_idx").on(table.contactId),
    index("email_delivery_status_idx").on(table.status),
    index("email_delivery_deleted_at_idx").on(table.deletedAt)
  ]
);

export const networkNewsletterMasters = pgTable(
  "network_newsletter_masters",
  {
    id,
    templateId: uuid("template_id").notNull().references(() => emailTemplates.id),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    seasonKey: text("season_key"),
    lockedBlocks: jsonb("locked_blocks").$type<Array<Record<string, unknown>>>().notNull().default([]),
    optionalBlocks: jsonb("optional_blocks").$type<Array<Record<string, unknown>>>().notNull().default([]),
    localEditableBlocks: jsonb("local_editable_blocks").$type<Array<Record<string, unknown>>>().notNull().default([]),
    contentRules: jsonb("content_rules").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("network_newsletter_masters_template_id_idx").on(table.templateId),
    index("network_newsletter_masters_status_idx").on(table.status),
    index("network_newsletter_masters_deleted_at_idx").on(table.deletedAt)
  ]
);

export const territoryNewsletterEditions = pgTable(
  "territory_newsletter_editions",
  {
    id,
    masterId: uuid("master_id").notNull().references(() => networkNewsletterMasters.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    emailCampaignId: uuid("email_campaign_id").references(() => emailCampaigns.id),
    status: text("status").notNull().default("draft"),
    inheritedBlocks: jsonb("inherited_blocks").$type<Array<Record<string, unknown>>>().notNull().default([]),
    localOverrides: jsonb("local_overrides").$type<Record<string, unknown>>().notNull().default({}),
    warnings: jsonb("warnings").$type<Array<Record<string, unknown>>>().notNull().default([]),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("territory_newsletter_editions_master_territory_uidx").on(table.masterId, table.territoryId),
    index("territory_newsletter_editions_master_id_idx").on(table.masterId),
    index("territory_newsletter_editions_territory_id_idx").on(table.territoryId),
    index("territory_newsletter_editions_status_idx").on(table.status),
    index("territory_newsletter_editions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const newsletterFactoryRuns = pgTable(
  "newsletter_factory_runs",
  {
    id,
    masterId: uuid("master_id").notNull().references(() => networkNewsletterMasters.id),
    status: text("status").notNull().default("completed"),
    totalTerritories: integer("total_territories").notNull().default(0),
    readyCount: integer("ready_count").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    blockedCount: integer("blocked_count").notNull().default(0),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => [
    uniqueIndex("newsletter_factory_runs_idempotency_uidx").on(table.idempotencyKey),
    index("newsletter_factory_runs_master_id_idx").on(table.masterId)
  ]
);

export const marketingJourneys = pgTable(
  "marketing_journeys",
  {
    id,
    key: text("key").notNull(),
    name: text("name").notNull(),
    territoryId: uuid("territory_id").references(() => territories.id),
    status: text("status").notNull().default("draft"),
    purpose: text("purpose").notNull().default("marketing"),
    description: text("description"),
    frequencyCap: jsonb("frequency_cap").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("marketing_journeys_key_uidx").on(table.key),
    index("marketing_journeys_territory_id_idx").on(table.territoryId),
    index("marketing_journeys_status_idx").on(table.status),
    index("marketing_journeys_deleted_at_idx").on(table.deletedAt)
  ]
);

export const marketingJourneyVersions = pgTable(
  "marketing_journey_versions",
  {
    id,
    journeyId: uuid("journey_id").notNull().references(() => marketingJourneys.id),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    trigger: jsonb("trigger").$type<Record<string, unknown>>().notNull(),
    conditions: jsonb("conditions").$type<Array<Record<string, unknown>>>().notNull().default([]),
    steps: jsonb("steps").$type<Array<Record<string, unknown>>>().notNull().default([]),
    aiSuggestions: jsonb("ai_suggestions").$type<Record<string, unknown>>().notNull().default({}),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("marketing_journey_versions_journey_version_uidx").on(table.journeyId, table.versionNumber),
    index("marketing_journey_versions_journey_id_idx").on(table.journeyId),
    index("marketing_journey_versions_status_idx").on(table.status),
    index("marketing_journey_versions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const marketingJourneyAudienceEntries = pgTable(
  "marketing_journey_audience_entries",
  {
    id,
    journeyId: uuid("journey_id").notNull().references(() => marketingJourneys.id),
    journeyVersionId: uuid("journey_version_id").notNull().references(() => marketingJourneyVersions.id),
    contactId: uuid("contact_id").notNull().references(() => audienceContacts.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    sourceEventType: text("source_event_type").notNull(),
    sourceEventId: text("source_event_id"),
    status: text("status").notNull().default("active"),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull(),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    exitReason: text("exit_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => [
    uniqueIndex("marketing_journey_entries_idempotency_uidx").on(table.idempotencyKey),
    index("marketing_journey_entries_contact_id_idx").on(table.contactId),
    index("marketing_journey_entries_journey_id_idx").on(table.journeyId),
    index("marketing_journey_entries_status_idx").on(table.status)
  ]
);

export const marketingJourneyExecutions = pgTable(
  "marketing_journey_executions",
  {
    id,
    entryId: uuid("entry_id").notNull().references(() => marketingJourneyAudienceEntries.id),
    journeyId: uuid("journey_id").notNull().references(() => marketingJourneys.id),
    status: text("status").notNull().default("queued"),
    currentStepKey: text("current_step_key"),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    failureReason: text("failure_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("marketing_journey_executions_idempotency_uidx").on(table.idempotencyKey),
    index("marketing_journey_executions_entry_id_idx").on(table.entryId),
    index("marketing_journey_executions_status_idx").on(table.status),
    index("marketing_journey_executions_run_after_idx").on(table.runAfter)
  ]
);

export const marketingJourneyStepExecutions = pgTable(
  "marketing_journey_step_executions",
  {
    id,
    executionId: uuid("execution_id").notNull().references(() => marketingJourneyExecutions.id),
    stepKey: text("step_key").notNull(),
    actionType: text("action_type").notNull(),
    status: text("status").notNull().default("queued"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("marketing_journey_step_exec_idempotency_uidx").on(table.idempotencyKey),
    index("marketing_journey_step_exec_execution_id_idx").on(table.executionId),
    index("marketing_journey_step_exec_status_idx").on(table.status)
  ]
);
