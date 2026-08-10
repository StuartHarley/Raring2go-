import { boolean, date, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

export const franchises = pgTable(
  "franchises",
  {
    id,
    franchiseOrganisationId: uuid("franchise_organisation_id")
      .notNull()
      .references(() => organisations.id),
    primaryTerritoryId: uuid("primary_territory_id")
      .notNull()
      .references(() => territories.id),
    primaryOwnerUserId: uuid("primary_owner_user_id").references(() => users.id),
    status: text("status").notNull().default("active"),
    lifecycleStage: text("lifecycle_stage").notNull().default("trading"),
    launchDate: date("launch_date", { mode: "date" }),
    renewalDate: date("renewal_date", { mode: "date" }),
    endDate: date("end_date", { mode: "date" }),
    onboardingStatus: text("onboarding_status").notNull().default("not_started"),
    supportStatus: text("support_status").notNull().default("standard"),
    tags: text("tags").array().notNull().default([]),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("franchises_organisation_id_idx").on(table.franchiseOrganisationId),
    index("franchises_primary_territory_id_idx").on(table.primaryTerritoryId),
    index("franchises_primary_owner_user_id_idx").on(table.primaryOwnerUserId),
    index("franchises_status_idx").on(table.status),
    index("franchises_deleted_at_idx").on(table.deletedAt)
  ]
);

export const franchiseContacts = pgTable(
  "franchise_contacts",
  {
    id,
    franchiseId: uuid("franchise_id")
      .notNull()
      .references(() => franchises.id),
    userId: uuid("user_id").references(() => users.id),
    label: text("label").notNull(),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("franchise_contacts_franchise_id_idx").on(table.franchiseId),
    index("franchise_contacts_user_id_idx").on(table.userId),
    index("franchise_contacts_deleted_at_idx").on(table.deletedAt)
  ]
);

export const agreementTemplates = pgTable(
  "agreement_templates",
  {
    id,
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("agreement_templates_key_idx").on(table.key),
    index("agreement_templates_status_idx").on(table.status),
    index("agreement_templates_deleted_at_idx").on(table.deletedAt)
  ]
);

export const agreementVersions = pgTable(
  "agreement_versions",
  {
    id,
    templateId: uuid("template_id")
      .notNull()
      .references(() => agreementTemplates.id),
    version: text("version").notNull(),
    status: text("status").notNull().default("draft"),
    controlledMergeFields: jsonb("controlled_merge_fields")
      .$type<string[]>()
      .notNull()
      .default([]),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: date("approved_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("agreement_versions_template_id_idx").on(table.templateId),
    index("agreement_versions_status_idx").on(table.status),
    index("agreement_versions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const franchiseAgreements = pgTable(
  "franchise_agreements",
  {
    id,
    franchiseId: uuid("franchise_id")
      .notNull()
      .references(() => franchises.id),
    agreementVersionId: uuid("agreement_version_id")
      .notNull()
      .references(() => agreementVersions.id),
    status: text("status").notNull().default("draft"),
    mergeVariables: jsonb("merge_variables")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
    generatedContent: jsonb("generated_content")
      .$type<Record<string, unknown>>()
      .notNull(),
    submittedAt: date("submitted_at", { mode: "date" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: date("approved_at", { mode: "date" }),
    voidedAt: date("voided_at", { mode: "date" }),
    supersededByAgreementId: uuid("superseded_by_agreement_id"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("franchise_agreements_franchise_id_idx").on(table.franchiseId),
    index("franchise_agreements_version_id_idx").on(table.agreementVersionId),
    index("franchise_agreements_status_idx").on(table.status),
    index("franchise_agreements_deleted_at_idx").on(table.deletedAt)
  ]
);
