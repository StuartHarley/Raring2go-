import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agreementTemplates,
  agreementVersions,
  complianceRequirements,
  agreementSignatureEvents,
  agreementSignatureRequests,
  agreementSigners,
  audienceConsentEvents,
  audienceContacts,
  audiencePreferenceProfiles,
  publicAnalyticsEvents,
  audienceSavedContent,
  audienceSegments,
  audienceSuppressions,
  audienceTerritorySubscriptions,
  emailCampaignVersions,
  emailCampaigns,
  emailDeliveryRecords,
  emailRecipientSnapshots,
  emailTemplates,
  marketingJourneyAudienceEntries,
  marketingJourneyExecutions,
  marketingJourneyStepExecutions,
  marketingJourneyVersions,
  marketingJourneys,
  networkNewsletterMasters,
  newsletterFactoryRuns,
  territoryNewsletterEditions,
  advertiserActivityEvents,
  advertiserContacts,
  advertiserDomainEvents,
  advertiserCreditNoteLines,
  advertiserCreditNotes,
  advertiserInvoiceLines,
  advertiserInvoiceSequences,
  advertiserInvoices,
  advertiserMetricSnapshots,
  advertiserPaymentAllocations,
  advertiserPayments,
  advertiserProposalAcceptances,
  advertiserProviderSyncReferences,
  advertiserTerms,
  advertisers,
  artworkRequirements,
  artworkVersions,
  campaignFulfilments,
  commercialPackages,
  commercialProducts,
  commercialBookingItems,
  commercialBookings,
  commercialProductionRequests,
  commercialProposalItems,
  commercialProposals,
  contentAiTasks,
  contentChannelVariantVersions,
  contentChannelVariants,
  contentDomainEvents,
  contentItemVersions,
  contentItems,
  contentLocalisations,
  contentWebsitePublishingJobs,
  socialAccounts,
  socialProviderEvents,
  socialPublications,
  socialPublishJobs,
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
  inventoryReservations,
  inventorySlots,
  opportunities,
  pipelineStages,
  proofPacks,
  priceBookItems,
  priceBooks,
  renewalPrompts,
  preflightResults,
  publicationOutputs,
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

  it("models advertiser CRM records through organisation and territory references", () => {
    expect(advertisers.advertiserOrganisationId.name).toBe("advertiser_organisation_id");
    expect(advertisers.owningTerritoryId.name).toBe("owning_territory_id");
    expect(advertisers.relationshipState.name).toBe("relationship_state");
    expect(advertisers.averageSaleValueMinor.name).toBe("average_sale_value_minor");
    expect(advertisers.annualAdvertiserValueMinor.name).toBe("annual_advertiser_value_minor");
    expect((advertisers as unknown as Record<string, unknown>).legalName).toBeUndefined();
    expect((advertisers as unknown as Record<string, unknown>).companyNumber).toBeUndefined();
    expect((advertisers as unknown as Record<string, unknown>).vatNumber).toBeUndefined();
  });

  it("models advertiser contacts, activity and metric snapshots", () => {
    expect(advertiserContacts.advertiserId.name).toBe("advertiser_id");
    expect(advertiserContacts.userId.name).toBe("user_id");
    expect(advertiserContacts.isPrimary.name).toBe("is_primary");
    expect(advertiserActivityEvents.relatedEntityType.name).toBe("related_entity_type");
    expect(advertiserActivityEvents.metadata.name).toBe("metadata");
    expect(advertiserMetricSnapshots.packageMix.name).toBe("package_mix");
    expect(advertiserMetricSnapshots.digitalMix.name).toBe("digital_mix");
    expect(advertiserMetricSnapshots.overdueDebtMinor.name).toBe("overdue_debt_minor");
  });

  it("models privacy-conscious public analytics events", () => {
    expect(publicAnalyticsEvents.eventType.name).toBe("event_type");
    expect(publicAnalyticsEvents.territoryId.name).toBe("territory_id");
    expect(publicAnalyticsEvents.parentUserId.name).toBe("parent_user_id");
    expect(publicAnalyticsEvents.metadata.name).toBe("metadata");
    expect(publicAnalyticsEvents.privacy.name).toBe("privacy");
    expect(publicAnalyticsEvents.retainUntil.name).toBe("retain_until");
    expect((publicAnalyticsEvents as unknown as Record<string, unknown>).headers).toBeUndefined();
    expect((publicAnalyticsEvents as unknown as Record<string, unknown>).cookies).toBeUndefined();
  });

  it("models configurable pipeline stages and territory-scoped opportunities", () => {
    expect(pipelineStages.key.name).toBe("key");
    expect(pipelineStages.probabilityDefault.name).toBe("probability_default");
    expect(pipelineStages.isClosed.name).toBe("is_closed");
    expect(opportunities.advertiserId.name).toBe("advertiser_id");
    expect(opportunities.stageId.name).toBe("stage_id");
    expect(opportunities.expectedCloseDate.name).toBe("expected_close_date");
    expect(opportunities.nextActionDate.name).toBe("next_action_date");
    expect(opportunities.lostReason.name).toBe("lost_reason");
  });

  it("models commercial catalogue pricing and Edition Factory inventory", () => {
    expect(commercialProducts.channel.name).toBe("channel");
    expect(commercialProducts.requiresInventory.name).toBe("requires_inventory");
    expect(commercialPackages.lines.name).toBe("lines");
    expect(priceBooks.territoryId.name).toBe("territory_id");
    expect(priceBookItems.minimumPriceMinor.name).toBe("minimum_price_minor");
    expect(priceBookItems.approvalRequiredBelowMinor.name).toBe("approval_required_below_minor");
    expect(inventorySlots.territoryEditionId.name).toBe("territory_edition_id");
    expect(inventorySlots.editionPageId.name).toBe("edition_page_id");
    expect(inventoryReservations.inventorySlotId.name).toBe("inventory_slot_id");
  });

  it("models commercial proposals, bookings and production handoff", () => {
    expect(commercialProposals.advertiserId.name).toBe("advertiser_id");
    expect(commercialProposals.opportunityId.name).toBe("opportunity_id");
    expect(commercialProposalItems.inventorySlotId.name).toBe("inventory_slot_id");
    expect(commercialBookings.proposalId.name).toBe("proposal_id");
    expect(commercialBookingItems.inventoryReservationId.name).toBe("inventory_reservation_id");
    expect(commercialProductionRequests.bookingItemId.name).toBe("booking_item_id");
    expect((commercialBookings as unknown as Record<string, unknown>).invoiceId).toBeUndefined();
    expect((commercialProposals as unknown as Record<string, unknown>).signatureEnvelopeId).toBeUndefined();
  });

  it("models advertiser commercial acceptance without forcing e-sign", () => {
    expect(advertiserTerms.contentHash.name).toBe("content_hash");
    expect(advertiserProposalAcceptances.method.name).toBe("method");
    expect(advertiserProposalAcceptances.commercialSnapshot.name).toBe("commercial_snapshot");
    expect(advertiserProposalAcceptances.providerMetadata.name).toBe("provider_metadata");
    expect(advertiserDomainEvents.idempotencyKey.name).toBe("idempotency_key");
    expect((advertiserProposalAcceptances as unknown as Record<string, unknown>).signingOrder).toBeUndefined();
    expect((advertiserProposalAcceptances as unknown as Record<string, unknown>).certificateArtifactId).toBeUndefined();
  });

  it("models advertiser invoicing, payments and reconciliation foundations", () => {
    expect(advertiserInvoiceSequences.issuerOrganisationId.name).toBe("issuer_organisation_id");
    expect(advertiserInvoices.issuerOrganisationId.name).toBe("issuer_organisation_id");
    expect(advertiserInvoices.territoryId.name).toBe("territory_id");
    expect(advertiserInvoices.invoiceNumber.name).toBe("invoice_number");
    expect(advertiserInvoices.issuedSnapshot.name).toBe("issued_snapshot");
    expect(advertiserInvoiceLines.taxRateBps.name).toBe("tax_rate_bps");
    expect(advertiserCreditNotes.invoiceId.name).toBe("invoice_id");
    expect(advertiserCreditNoteLines.taxCode.name).toBe("tax_code");
    expect(advertiserPayments.unallocatedMinor.name).toBe("unallocated_minor");
    expect(advertiserPaymentAllocations.invoiceId.name).toBe("invoice_id");
    expect(advertiserProviderSyncReferences.providerKey.name).toBe("provider_key");
    expect((advertiserInvoices as unknown as Record<string, unknown>).xeroInvoiceId).toBeUndefined();
    expect((advertiserPayments as unknown as Record<string, unknown>).stripePaymentIntentId).toBeUndefined();
  });

  it("models advertiser artwork handoff using publishing preflight references", () => {
    expect(artworkRequirements.productionRequestId.name).toBe("production_request_id");
    expect(artworkRequirements.territoryEditionId.name).toBe("territory_edition_id");
    expect(artworkRequirements.editionPageId.name).toBe("edition_page_id");
    expect(artworkRequirements.approvedVersionId.name).toBe("approved_version_id");
    expect(artworkVersions.preflightResultId.name).toBe("preflight_result_id");
    expect((artworkVersions as unknown as Record<string, unknown>).validationEngine).toBeUndefined();
  });

  it("models campaign fulfilment, proof packs and renewal prompts without provider lock-in", () => {
    expect(campaignFulfilments.bookingItemId.name).toBe("booking_item_id");
    expect(campaignFulfilments.artworkRequirementId.name).toBe("artwork_requirement_id");
    expect(campaignFulfilments.editionPageId.name).toBe("edition_page_id");
    expect(campaignFulfilments.placementReference.name).toBe("placement_reference");
    expect(proofPacks.fulfilmentId.name).toBe("fulfilment_id");
    expect(proofPacks.proofSnapshot.name).toBe("proof_snapshot");
    expect(proofPacks.artefactReference.name).toBe("artefact_reference");
    expect(renewalPrompts.sourceProofPackId.name).toBe("source_proof_pack_id");
    expect(renewalPrompts.renewalSnapshot.name).toBe("renewal_snapshot");
    expect((proofPacks as unknown as Record<string, unknown>).mailchimpCampaignId).toBeUndefined();
    expect((campaignFulfilments as unknown as Record<string, unknown>).royaltyInvoiceId).toBeUndefined();
  });

  it("models native audience identity, consent, suppression and segments", () => {
    expect(audienceContacts.emailNormalised.name).toBe("email_normalised");
    expect(audienceContacts.emailStatus.name).toBe("email_status");
    expect(audienceTerritorySubscriptions.contactId.name).toBe("contact_id");
    expect(audienceTerritorySubscriptions.territoryId.name).toBe("territory_id");
    expect(audienceConsentEvents.consentType.name).toBe("consent_type");
    expect(audienceConsentEvents.occurredAt.name).toBe("occurred_at");
    expect(audienceSuppressions.emailNormalised.name).toBe("email_normalised");
    expect(audienceSuppressions.active.name).toBe("active");
    expect(audienceSegments.segmentType.name).toBe("segment_type");
    expect((audienceContacts as unknown as Record<string, unknown>).mailchimpId).toBeUndefined();
  });

  it("models native email campaigns with provider-neutral delivery records", () => {
    expect(emailTemplates.requiredBlocks.name).toBe("required_blocks");
    expect(emailCampaigns.segmentId.name).toBe("segment_id");
    expect(emailCampaigns.status.name).toBe("status");
    expect(emailCampaignVersions.contentSnapshot.name).toBe("content_snapshot");
    expect(emailRecipientSnapshots.recipients.name).toBe("recipients");
    expect(emailRecipientSnapshots.idempotencyKey.name).toBe("idempotency_key");
    expect(emailDeliveryRecords.providerKey.name).toBe("provider_key");
    expect(emailDeliveryRecords.providerMessageId.name).toBe("provider_message_id");
    expect((emailCampaigns as unknown as Record<string, unknown>).mailchimpCampaignId).toBeUndefined();
  });

  it("models HQ newsletter factory masters separately from territory editions", () => {
    expect(networkNewsletterMasters.lockedBlocks.name).toBe("locked_blocks");
    expect(networkNewsletterMasters.localEditableBlocks.name).toBe("local_editable_blocks");
    expect(networkNewsletterMasters.contentRules.name).toBe("content_rules");
    expect(territoryNewsletterEditions.masterId.name).toBe("master_id");
    expect(territoryNewsletterEditions.territoryId.name).toBe("territory_id");
    expect(territoryNewsletterEditions.localOverrides.name).toBe("local_overrides");
    expect(newsletterFactoryRuns.idempotencyKey.name).toBe("idempotency_key");
    expect((networkNewsletterMasters as unknown as Record<string, unknown>).mailchimpTemplateId).toBeUndefined();
  });

  it("models canonical content separately from channel variants and provider publishing jobs", () => {
    expect(contentItems.contentType.name).toBe("content_type");
    expect(contentItems.ownerLevel.name).toBe("owner_level");
    expect(contentItems.provenance.name).toBe("provenance");
    expect(contentItemVersions.snapshot.name).toBe("snapshot");
    expect(contentChannelVariants.channel.name).toBe("channel");
    expect(contentChannelVariantVersions.generatedByTaskId.name).toBe("generated_by_task_id");
    expect(contentLocalisations.lockedFields.name).toBe("locked_fields");
    expect(contentAiTasks.promptTemplateVersion.name).toBe("prompt_template_version");
    expect(contentWebsitePublishingJobs.providerKey.name).toBe("provider_key");
    expect(contentDomainEvents.idempotencyKey.name).toBe("idempotency_key");
    expect((contentItems as unknown as Record<string, unknown>).wordpressPostId).toBeUndefined();
    expect((contentChannelVariants as unknown as Record<string, unknown>).mailchimpBlockId).toBeUndefined();
  });

  it("models provider-neutral social accounts, queue items and publish jobs", () => {
    expect(socialAccounts.channel.name).toBe("channel");
    expect(socialAccounts.externalAccountReference.name).toBe("external_account_reference");
    expect(socialAccounts.connectionHealth.name).toBe("connection_health");
    expect(socialPublications.variantId.name).toBe("variant_id");
    expect(socialPublications.immutableSnapshot.name).toBe("immutable_snapshot");
    expect(socialPublications.timezone.name).toBe("timezone");
    expect(socialPublishJobs.idempotencyKey.name).toBe("idempotency_key");
    expect(socialProviderEvents.providerEventId.name).toBe("provider_event_id");
    expect((socialAccounts as unknown as Record<string, unknown>).accessToken).toBeUndefined();
    expect((socialPublications as unknown as Record<string, unknown>).facebookPostId).toBeUndefined();
  });

  it("models privacy-light parent preferences and saved content", () => {
    expect(audiencePreferenceProfiles.contactId.name).toBe("contact_id");
    expect(audiencePreferenceProfiles.followedTerritoryIds.name).toBe("followed_territory_ids");
    expect(audiencePreferenceProfiles.childAgeBands.name).toBe("child_age_bands");
    expect(audiencePreferenceProfiles.interests.name).toBe("interests");
    expect(audiencePreferenceProfiles.communicationPreferences.name).toBe("communication_preferences");
    expect(audienceSavedContent.contactId.name).toBe("contact_id");
    expect(audienceSavedContent.contentType.name).toBe("content_type");
    expect((audiencePreferenceProfiles as unknown as Record<string, unknown>).childDateOfBirth).toBeUndefined();
    expect((audiencePreferenceProfiles as unknown as Record<string, unknown>).childName).toBeUndefined();
  });

  it("models approved marketing journeys and consent-safe execution state", () => {
    expect(marketingJourneys.key.name).toBe("key");
    expect(marketingJourneys.frequencyCap.name).toBe("frequency_cap");
    expect(marketingJourneyVersions.versionNumber.name).toBe("version_number");
    expect(marketingJourneyVersions.trigger.name).toBe("trigger");
    expect(marketingJourneyVersions.steps.name).toBe("steps");
    expect(marketingJourneyAudienceEntries.idempotencyKey.name).toBe("idempotency_key");
    expect(marketingJourneyExecutions.runAfter.name).toBe("run_after");
    expect(marketingJourneyStepExecutions.actionType.name).toBe("action_type");
    expect((marketingJourneys as unknown as Record<string, unknown>).mailchimpJourneyId).toBeUndefined();
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

  it("models generated print and digital outputs from territory editions", () => {
    expect(publicationOutputs.territoryEditionId.name).toBe("territory_edition_id");
    expect(publicationOutputs.outputType.name).toBe("output_type");
    expect(publicationOutputs.sourcePageSnapshot.name).toBe("source_page_snapshot");
    expect(publicationOutputs.artifact.name).toBe("artifact");
    expect(publicationOutputs.idempotencyKey.name).toBe("idempotency_key");
    expect(publicationOutputs.corrections.name).toBe("corrections");
    expect((publicationOutputs as unknown as Record<string, unknown>).printEditionId).toBeUndefined();
    expect((publicationOutputs as unknown as Record<string, unknown>).digitalEditionId).toBeUndefined();
  });
});
