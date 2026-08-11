import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agreementTemplates,
  agreementVersions,
  complianceRequirements,
  agreementSignatureEvents,
  agreementSignatureRequests,
  agreementSigners,
  auditEvents,
  franchiseArtifactReferences,
  franchiseAgreements,
  franchiseComplianceRecords,
  franchiseComplianceActions,
  franchiseComplianceReminders,
  franchiseDocumentVersions,
  franchiseDocuments,
  franchiseDomainEvents,
  franchiseInsurancePolicies,
  franchiseOnboardingBlockers,
  franchiseOnboardingProgrammes,
  franchiseOnboardingTasks,
  franchises,
  editionContentItems,
  editionPages,
  editionPageRevisions,
  magazineTemplates,
  magazineTemplateVersions,
  masterEditions,
  onboardingTemplatePhases,
  onboardingTemplates,
  onboardingTemplateTasks,
  preflightResults,
  organisations,
  seasons,
  territories,
  territoryEditions,
  territoryEditionContent,
  users
} from "./schema";

describe("foundation schema", () => {
  it("uses global unique email for the shared identity model", () => {
    expect(users.email.name).toBe("email");
  });

  it("keeps audit entity references durable and not foreign-keyed", () => {
    expect(auditEvents.entityType.name).toBe("entity_type");
    expect(auditEvents.entityId.name).toBe("entity_id");

    const migration = readFileSync("migrations/0000_faulty_plazm.sql", "utf8");

    expect(migration).toContain('"entity_type" text NOT NULL');
    expect(migration).toContain('"entity_id" uuid');
    expect(migration).not.toMatch(
      /ALTER TABLE "audit_events".*FOREIGN KEY \("entity_id"\)/
    );
  });

  it("distinguishes organisation and territory scoping columns", () => {
    expect(organisations.id.name).toBe("id");
    expect(territories.franchiseOrganisationId.name).toBe(
      "franchise_organisation_id"
    );
  });

  it("models franchise relationships through existing organisation and territory records", () => {
    expect(franchises.franchiseOrganisationId.name).toBe("franchise_organisation_id");
    expect(franchises.primaryTerritoryId.name).toBe("primary_territory_id");
    expect(franchises.primaryOwnerUserId.name).toBe("primary_owner_user_id");
    expect((franchises as unknown as Record<string, unknown>).legalName).toBeUndefined();
    expect((franchises as unknown as Record<string, unknown>).companyNumber).toBeUndefined();
    expect((franchises as unknown as Record<string, unknown>).vatNumber).toBeUndefined();
  });

  it("separates agreement templates, versions and generated franchise instances", () => {
    expect(agreementTemplates.key.name).toBe("key");
    expect(agreementVersions.templateId.name).toBe("template_id");
    expect(franchiseAgreements.agreementVersionId.name).toBe("agreement_version_id");
    expect(franchiseAgreements.mergeVariables.name).toBe("merge_variables");
  });

  it("models provider-neutral signing artefacts and events without a document vault", () => {
    expect(agreementSignatureRequests.providerKey.name).toBe("provider_key");
    expect(agreementSigners.signingOrder.name).toBe("signing_order");
    expect(agreementSignatureEvents.providerEventId.name).toBe("provider_event_id");
    expect(franchiseArtifactReferences.storageKey.name).toBe("storage_key");
    expect(franchiseDomainEvents.idempotencyKey.name).toBe("idempotency_key");
    expect((franchiseArtifactReferences as unknown as Record<string, unknown>).folderId).toBeUndefined();
  });

  it("models the franchise document vault through provider-neutral artefact references", () => {
    expect(franchiseDocuments.franchiseId.name).toBe("franchise_id");
    expect(franchiseDocuments.currentVersionId.name).toBe("current_version_id");
    expect(franchiseDocuments.expiryDate.name).toBe("expiry_date");
    expect(franchiseDocumentVersions.artifactReferenceId.name).toBe("artifact_reference_id");
    expect((franchiseDocuments as unknown as Record<string, unknown>).storageBucket).toBeUndefined();
    expect((franchiseDocumentVersions as unknown as Record<string, unknown>).providerDocumentId).toBeUndefined();
  });

  it("models insurance and compliance through evidence document references", () => {
    expect(franchiseInsurancePolicies.evidenceDocumentId.name).toBe("evidence_document_id");
    expect(franchiseInsurancePolicies.verificationStatus.name).toBe("verification_status");
    expect(complianceRequirements.requiredDocumentType.name).toBe("required_document_type");
    expect(franchiseComplianceRecords.requirementId.name).toBe("requirement_id");
    expect(franchiseComplianceRecords.evidenceDocumentId.name).toBe("evidence_document_id");
    expect((franchiseInsurancePolicies as unknown as Record<string, unknown>).reminderState).toBeUndefined();
    expect((franchiseComplianceRecords as unknown as Record<string, unknown>).score).toBeUndefined();
  });

  it("models compliance action and reminder foundations with idempotency", () => {
    expect(franchiseComplianceActions.idempotencyKey.name).toBe("idempotency_key");
    expect(franchiseComplianceActions.dueDate.name).toBe("due_date");
    expect(franchiseComplianceReminders.complianceActionId.name).toBe("compliance_action_id");
    expect(franchiseComplianceReminders.scheduledFor.name).toBe("scheduled_for");
    expect((franchiseComplianceActions as unknown as Record<string, unknown>).workflowDefinitionId).toBeUndefined();
  });

  it("models configurable onboarding templates and launch programmes", () => {
    expect(onboardingTemplates.key.name).toBe("key");
    expect(onboardingTemplatePhases.templateId.name).toBe("template_id");
    expect(onboardingTemplateTasks.dueRule.name).toBe("due_rule");
    expect(onboardingTemplateTasks.dependencyRules.name).toBe("dependency_rules");
    expect(franchiseOnboardingProgrammes.idempotencyKey.name).toBe("idempotency_key");
    expect(franchiseOnboardingProgrammes.targetLaunchDate.name).toBe("target_launch_date");
    expect(franchiseOnboardingTasks.dueDateOverridden.name).toBe("due_date_overridden");
    expect(franchiseOnboardingBlockers.status.name).toBe("status");
    expect((franchiseOnboardingProgrammes as unknown as Record<string, unknown>).royaltyPlanId).toBeUndefined();
  });

  it("models one master edition generating territory editions for print and digital", () => {
    expect(seasons.key.name).toBe("key");
    expect(seasons.publicationDate.name).toBe("publication_date");
    expect(masterEditions.seasonId.name).toBe("season_id");
    expect(masterEditions.pageCount.name).toBe("page_count");
    expect(territoryEditions.masterEditionId.name).toBe("master_edition_id");
    expect(territoryEditions.territoryId.name).toBe("territory_id");
    expect(territoryEditions.printStatus.name).toBe("print_status");
    expect(territoryEditions.digitalStatus.name).toBe("digital_status");
    expect(territoryEditions.generatedFromMasterVersion.name).toBe("generated_from_master_version");
    expect((territoryEditions as unknown as Record<string, unknown>).digitalEditionId).toBeUndefined();
  });

  it("models versioned magazine templates with editable and locked production zones", () => {
    expect(magazineTemplates.key.name).toBe("key");
    expect(magazineTemplates.category.name).toBe("category");
    expect(magazineTemplateVersions.templateId.name).toBe("template_id");
    expect(magazineTemplateVersions.pageDimensions.name).toBe("page_dimensions");
    expect(magazineTemplateVersions.lockedElements.name).toBe("locked_elements");
    expect(magazineTemplateVersions.editableZones.name).toBe("editable_zones");
    expect(magazineTemplateVersions.printRules.name).toBe("print_rules");
    expect(magazineTemplateVersions.digitalEnhancements.name).toBe("digital_enhancements");
    expect((magazineTemplateVersions as unknown as Record<string, unknown>).indesignFilePath).toBeUndefined();
  });

  it("models inherited and localised edition content without overwriting local overrides", () => {
    expect(editionContentItems.inheritanceMode.name).toBe("inheritance_mode");
    expect(editionContentItems.targeting.name).toBe("targeting");
    expect(territoryEditionContent.sourceContentItemId.name).toBe("source_content_item_id");
    expect(territoryEditionContent.sourceVersion.name).toBe("source_version");
    expect(territoryEditionContent.inheritanceState.name).toBe("inheritance_state");
    expect(territoryEditionContent.localOverride.name).toBe("local_override");
    expect(territoryEditionContent.effectiveContent.name).toBe("effective_content");
  });

  it("models edition flatplan pages with template content and readiness state", () => {
    expect(editionPages.territoryEditionId.name).toBe("territory_edition_id");
    expect(editionPages.pageNumber.name).toBe("page_number");
    expect(editionPages.spreadNumber.name).toBe("spread_number");
    expect(editionPages.templateVersionId.name).toBe("template_version_id");
    expect(editionPages.assignedContentId.name).toBe("assigned_content_id");
    expect(editionPages.sourceMarker.name).toBe("source_marker");
    expect(editionPages.readiness.name).toBe("readiness");
  });

  it("models local editor autosave revisions for page workflow", () => {
    expect(editionPageRevisions.pageId.name).toBe("page_id");
    expect(editionPageRevisions.revisionNumber.name).toBe("revision_number");
    expect(editionPageRevisions.changeType.name).toBe("change_type");
    expect(editionPageRevisions.snapshot.name).toBe("snapshot");
    expect(editionPageRevisions.warnings.name).toBe("warnings");
  });

  it("models preflight results with original and derived artefact metadata", () => {
    expect(preflightResults.entityType.name).toBe("entity_type");
    expect(preflightResults.entityId.name).toBe("entity_id");
    expect(preflightResults.territoryEditionId.name).toBe("territory_edition_id");
    expect(preflightResults.originalArtifact.name).toBe("original_artifact");
    expect(preflightResults.derivedArtifact.name).toBe("derived_artifact");
    expect(preflightResults.unfixableIssues.name).toBe("unfixable_issues");
    expect((preflightResults as unknown as Record<string, unknown>).indesignDocumentId).toBeUndefined();
  });
});
