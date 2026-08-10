import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    executedAt: date("executed_at", { mode: "date" }),
    signedAgreementArtifactId: uuid("signed_agreement_artifact_id"),
    completionCertificateArtifactId: uuid("completion_certificate_artifact_id"),
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

export const franchiseArtifactReferences = pgTable(
  "franchise_artifact_references",
  {
    id,
    franchiseId: uuid("franchise_id")
      .notNull()
      .references(() => franchises.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    category: text("category").notNull(),
    label: text("label").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type"),
    checksum: text("checksum"),
    providerMetadata: jsonb("provider_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    lockedAt: date("locked_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("franchise_artifacts_franchise_id_idx").on(table.franchiseId),
    index("franchise_artifacts_entity_idx").on(table.entityType, table.entityId),
    index("franchise_artifacts_category_idx").on(table.category),
    index("franchise_artifacts_deleted_at_idx").on(table.deletedAt)
  ]
);

export const agreementSignatureRequests = pgTable(
  "agreement_signature_requests",
  {
    id,
    franchiseAgreementId: uuid("franchise_agreement_id")
      .notNull()
      .references(() => franchiseAgreements.id),
    status: text("status").notNull().default("draft"),
    providerKey: text("provider_key").notNull(),
    providerRequestId: text("provider_request_id"),
    providerMetadata: jsonb("provider_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sentAt: date("sent_at", { mode: "date" }),
    cancelledAt: date("cancelled_at", { mode: "date" }),
    expiredAt: date("expired_at", { mode: "date" }),
    declinedAt: date("declined_at", { mode: "date" }),
    completedAt: date("completed_at", { mode: "date" }),
    reissuedFromRequestId: uuid("reissued_from_request_id"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("agreement_signature_requests_agreement_id_idx").on(table.franchiseAgreementId),
    index("agreement_signature_requests_status_idx").on(table.status),
    index("agreement_signature_requests_provider_request_id_idx").on(table.providerRequestId),
    index("agreement_signature_requests_deleted_at_idx").on(table.deletedAt)
  ]
);

export const agreementSigners = pgTable(
  "agreement_signers",
  {
    id,
    signatureRequestId: uuid("signature_request_id")
      .notNull()
      .references(() => agreementSignatureRequests.id),
    role: text("role").notNull(),
    userId: uuid("user_id").references(() => users.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    signingOrder: integer("signing_order").notNull(),
    required: boolean("required").notNull().default(true),
    status: text("status").notNull().default("pending"),
    completedAt: date("completed_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("agreement_signers_request_id_idx").on(table.signatureRequestId),
    index("agreement_signers_status_idx").on(table.status),
    index("agreement_signers_deleted_at_idx").on(table.deletedAt)
  ]
);

export const agreementSignatureEvents = pgTable(
  "agreement_signature_events",
  {
    id,
    signatureRequestId: uuid("signature_request_id")
      .notNull()
      .references(() => agreementSignatureRequests.id),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    processedAt: date("processed_at", { mode: "date" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("agreement_signature_events_provider_event_uidx").on(
      table.signatureRequestId,
      table.providerEventId
    ),
    index("agreement_signature_events_request_id_idx").on(table.signatureRequestId),
    index("agreement_signature_events_type_idx").on(table.eventType)
  ]
);

export const franchiseDomainEvents = pgTable(
  "franchise_domain_events",
  {
    id,
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    processedAt: date("processed_at", { mode: "date" }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("franchise_domain_events_idempotency_uidx").on(table.idempotencyKey),
    index("franchise_domain_events_type_idx").on(table.eventType),
    index("franchise_domain_events_entity_idx").on(table.entityType, table.entityId)
  ]
);

export const franchiseDocuments = pgTable(
  "franchise_documents",
  {
    id,
    franchiseId: uuid("franchise_id")
      .notNull()
      .references(() => franchises.id),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    territoryId: uuid("territory_id")
      .notNull()
      .references(() => territories.id),
    category: text("category").notNull(),
    documentType: text("document_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    currentVersionId: uuid("current_version_id"),
    expiryDate: date("expiry_date", { mode: "date" }),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id),
    archivedAt: date("archived_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("franchise_documents_franchise_id_idx").on(table.franchiseId),
    index("franchise_documents_territory_id_idx").on(table.territoryId),
    index("franchise_documents_category_idx").on(table.category),
    index("franchise_documents_status_idx").on(table.status),
    index("franchise_documents_expiry_date_idx").on(table.expiryDate),
    index("franchise_documents_deleted_at_idx").on(table.deletedAt)
  ]
);

export const franchiseDocumentVersions = pgTable(
  "franchise_document_versions",
  {
    id,
    documentId: uuid("document_id")
      .notNull()
      .references(() => franchiseDocuments.id),
    versionNumber: integer("version_number").notNull(),
    artifactReferenceId: uuid("artifact_reference_id")
      .notNull()
      .references(() => franchiseArtifactReferences.id),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id),
    uploadedAt: date("uploaded_at", { mode: "date" }),
    notes: text("notes"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("franchise_document_versions_doc_number_uidx").on(
      table.documentId,
      table.versionNumber
    ),
    index("franchise_document_versions_document_id_idx").on(table.documentId),
    index("franchise_document_versions_artifact_id_idx").on(table.artifactReferenceId),
    index("franchise_document_versions_deleted_at_idx").on(table.deletedAt)
  ]
);

export const franchiseInsurancePolicies = pgTable(
  "franchise_insurance_policies",
  {
    id,
    franchiseId: uuid("franchise_id").notNull().references(() => franchises.id),
    provider: text("provider").notNull(),
    policyNumber: text("policy_number").notNull(),
    coverTypes: text("cover_types").array().notNull().default([]),
    coverStartDate: date("cover_start_date", { mode: "date" }).notNull(),
    coverEndDate: date("cover_end_date", { mode: "date" }).notNull(),
    evidenceDocumentId: uuid("evidence_document_id").references(() => franchiseDocuments.id),
    verificationStatus: text("verification_status").notNull().default("pending"),
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id),
    verifiedAt: date("verified_at", { mode: "date" }),
    rejectedReason: text("rejected_reason"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("franchise_insurance_policies_franchise_id_idx").on(table.franchiseId),
    index("franchise_insurance_policies_cover_end_date_idx").on(table.coverEndDate),
    index("franchise_insurance_policies_verification_status_idx").on(table.verificationStatus),
    index("franchise_insurance_policies_deleted_at_idx").on(table.deletedAt)
  ]
);

export const complianceRequirements = pgTable(
  "compliance_requirements",
  {
    id,
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    requiredDocumentCategory: text("required_document_category"),
    requiredDocumentType: text("required_document_type"),
    expiryWarningDays: integer("expiry_warning_days").notNull().default(30),
    active: boolean("active").notNull().default(true),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("compliance_requirements_key_idx").on(table.key),
    index("compliance_requirements_active_idx").on(table.active),
    index("compliance_requirements_deleted_at_idx").on(table.deletedAt)
  ]
);

export const franchiseComplianceRecords = pgTable(
  "franchise_compliance_records",
  {
    id,
    franchiseId: uuid("franchise_id").notNull().references(() => franchises.id),
    requirementId: uuid("requirement_id").notNull().references(() => complianceRequirements.id),
    evidenceDocumentId: uuid("evidence_document_id").references(() => franchiseDocuments.id),
    status: text("status").notNull().default("missing"),
    expiresAt: date("expires_at", { mode: "date" }),
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id),
    verifiedAt: date("verified_at", { mode: "date" }),
    rejectedReason: text("rejected_reason"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("franchise_compliance_records_franchise_requirement_uidx").on(
      table.franchiseId,
      table.requirementId
    ),
    index("franchise_compliance_records_franchise_id_idx").on(table.franchiseId),
    index("franchise_compliance_records_status_idx").on(table.status),
    index("franchise_compliance_records_expires_at_idx").on(table.expiresAt),
    index("franchise_compliance_records_deleted_at_idx").on(table.deletedAt)
  ]
);
