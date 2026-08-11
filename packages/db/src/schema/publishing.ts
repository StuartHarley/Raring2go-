import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
