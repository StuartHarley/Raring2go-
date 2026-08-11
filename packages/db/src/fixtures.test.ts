import { describe, expect, it } from "vitest";
import { fixtureIds, foundationSeed } from "./fixtures";

describe("foundation fixtures", () => {
  it("uses deterministic ids for repeatable seeds", () => {
    expect(fixtureIds.organisations.hq).toBe(
      "00000000-0000-4000-8000-000000000001"
    );
    expect(foundationSeed.organisations).toHaveLength(3);
  });

  it("keeps seed permissions intentionally minimal", () => {
    expect(foundationSeed.permissions.map((permission) => permission.module)).toEqual([
      "system",
      "territory",
      "roles",
      "franchise",
      "franchise",
      "franchise",
      "franchise.agreement",
      "franchise.agreement",
      "franchise.agreement",
      "franchise.agreement",
      "franchise.agreement",
      "franchise.agreement",
      "franchise.agreement",
      "franchise.agreement",
      "franchise.agreement",
      "franchise.agreement",
      "franchise.agreement",
      "franchise.document",
      "franchise.document",
      "franchise.document",
      "franchise.document",
      "franchise.compliance",
      "franchise.compliance",
      "franchise.compliance",
      "franchise.compliance",
      "franchise.compliance",
      "franchise.compliance",
      "franchise.onboarding",
      "franchise.onboarding",
      "franchise.onboarding",
      "franchise.onboarding",
      "franchise.onboarding",
      "franchise.onboarding",
      "franchise.onboarding",
      "edition",
      "edition",
      "edition",
      "edition",
      "edition",
      "edition.template",
      "edition.template",
      "edition.template",
      "edition.template",
      "edition.page",
      "edition.content",
      "edition.content",
      "edition.preflight",
      "edition.output",
      "edition.output",
      "advertiser",
      "advertiser",
      "advertiser",
      "advertiser.contact",
      "advertiser.activity",
      "advertiser.opportunity",
      "advertiser.opportunity",
      "advertiser.opportunity",
      "advertiser.catalogue",
      "advertiser.pricing",
      "advertiser.inventory",
      "advertiser.proposal",
      "advertiser.proposal",
      "advertiser.booking",
      "advertiser.proposal",
      "advertiser.proposal",
      "advertiser.finance",
      "advertiser.invoice",
      "advertiser.invoice",
      "advertiser.invoice",
      "advertiser.credit",
      "advertiser.payment",
      "advertiser.payment",
      "advertiser.payment",
      "advertiser.finance",
      "advertiser.artwork",
      "advertiser.artwork",
      "advertiser.artwork",
      "advertiser.artwork",
      "advertiser.fulfilment",
      "advertiser.fulfilment",
      "advertiser.proof",
      "advertiser.proof",
      "advertiser.renewal",
      "advertiser.renewal",
      "advertiser.analytics",
      "marketing.audience",
      "marketing.audience",
      "marketing.consent",
      "marketing.segment",
      "marketing.segment",
      "marketing.import",
      "marketing.email",
      "marketing.email",
      "marketing.email",
      "marketing.email",
      "marketing.email",
      "marketing.email",
      "marketing.newsletter_factory",
      "marketing.newsletter_factory",
      "marketing.newsletter_factory",
      "marketing.newsletter_factory",
      "content",
      "content",
      "content",
      "content",
      "content",
      "content",
      "content.ai",
      "content.ai",
      "content.website",
      "social",
      "social",
      "social",
      "social",
      "social",
      "social",
      "social",
      "social",
      "social",
      "marketing.journey",
      "marketing.journey",
      "marketing.journey",
      "marketing.journey",
      "marketing.journey",
      "marketing.journey",
      "marketing.journey"
    ]);
  });

  it("includes deterministic approved agreement template versions", () => {
    expect(fixtureIds.agreementTemplates.standardFranchise).toBe(
      "00000000-0000-4000-8000-000000000921"
    );
    expect(foundationSeed.agreementVersions.map((version) => version.status)).toEqual([
      "approved",
      "approved"
    ]);
  });

  it("includes a deterministic franchise relationship fixture", () => {
    expect(fixtureIds.franchises.suttonColdfield).toBe(
      "00000000-0000-4000-8000-000000000901"
    );
    expect(foundationSeed.franchises[0]?.franchiseOrganisationId).toBe(
      fixtureIds.organisations.franchise
    );
    expect(foundationSeed.franchises[0]?.primaryTerritoryId).toBe(
      fixtureIds.territories.suttonColdfield
    );
  });

  it("includes a deterministic franchise document vault fixture", () => {
    expect(fixtureIds.franchiseDocuments.suttonWelcomePack).toBe(
      "00000000-0000-4000-8000-000000000931"
    );
    expect(foundationSeed.franchiseDocuments[0]?.currentVersionId).toBe(
      fixtureIds.franchiseDocumentVersions.suttonWelcomePackV1
    );
    expect(foundationSeed.franchiseArtifactReferences[0]?.entityType).toBe(
      "franchise_document"
    );
  });

  it("includes deterministic insurance and compliance fixtures", () => {
    expect(fixtureIds.insurancePolicies.suttonPublicLiability).toBe(
      "00000000-0000-4000-8000-000000000937"
    );
    expect(foundationSeed.complianceRequirements[0]?.key).toBe(
      "public-liability-insurance"
    );
    expect(foundationSeed.complianceRecords[0]?.evidenceDocumentId).toBe(
      fixtureIds.franchiseDocuments.suttonInsurance
    );
  });

  it("includes a deterministic onboarding launch template fixture", () => {
    expect(fixtureIds.onboardingTemplates.starter).toBe(
      "00000000-0000-4000-8000-000000000940"
    );
    expect(foundationSeed.onboardingTemplates[0]?.key).toBe(
      "raring2go-starter-launch"
    );
    expect(foundationSeed.onboardingTemplatePhases).toHaveLength(7);
    expect(foundationSeed.onboardingTemplateTasks.map((task) => task.readinessGate)).toContain(true);
  });

  it("includes deterministic publishing edition fixtures", () => {
    expect(fixtureIds.seasons.autumn2026).toBe(
      "00000000-0000-4000-8000-000000001001"
    );
    expect(foundationSeed.seasons[0]?.key).toBe("autumn-2026");
    expect(foundationSeed.masterEditions[0]?.seasonId).toBe(
      fixtureIds.seasons.autumn2026
    );
    expect(foundationSeed.territoryEditions[0]).toMatchObject({
      masterEditionId: fixtureIds.masterEditions.autumn2026,
      territoryId: fixtureIds.territories.suttonColdfield,
      printStatus: "not_started",
      digitalStatus: "not_started"
    });
    expect(foundationSeed.magazineTemplateVersions[0]).toMatchObject({
      templateId: fixtureIds.magazineTemplates.autumnCover,
      status: "published"
    });
  });

  it("includes deterministic advertiser CRM fixtures", () => {
    expect(fixtureIds.advertisers.example).toBe(
      "00000000-0000-4000-8000-000000000701"
    );
    expect(foundationSeed.advertisers[0]).toMatchObject({
      advertiserOrganisationId: fixtureIds.organisations.advertiser,
      owningTerritoryId: fixtureIds.territories.suttonColdfield,
      relationshipState: "retained",
      averageSaleValueMinor: 42500,
      annualAdvertiserValueMinor: 170000
    });
  });

  it("includes deterministic advertiser pipeline fixtures", () => {
    expect(foundationSeed.pipelineStages.map((stage) => stage.key)).toEqual([
      "lead",
      "qualified",
      "proposal",
      "won",
      "lost"
    ]);
    expect(foundationSeed.opportunities[0]).toMatchObject({
      advertiserId: fixtureIds.advertisers.example,
      stageId: fixtureIds.pipelineStages.qualified,
      expectedCloseDate: "2026-08-18",
      nextActionDate: "2026-08-10"
    });
  });

  it("includes deterministic commercial catalogue and inventory fixtures", () => {
    expect(foundationSeed.commercialProducts[0]).toMatchObject({
      key: "full-page-ad",
      channel: "magazine",
      requiresInventory: true,
      requiresArtwork: true
    });
    expect(foundationSeed.priceBookItems[0]).toMatchObject({
      productId: fixtureIds.commercialProducts.fullPageAdvert,
      standardPriceMinor: 52500,
      minimumPriceMinor: 42500
    });
    expect(foundationSeed.inventorySlots[0]).toMatchObject({
      territoryEditionId: fixtureIds.territoryEditions.suttonAutumn2026,
      productId: fixtureIds.commercialProducts.fullPageAdvert,
      exclusive: true
    });
  });

  it("includes deterministic commercial proposal fixtures without accepted booking side effects", () => {
    expect(foundationSeed.commercialProposals[0]).toMatchObject({
      advertiserId: fixtureIds.advertisers.example,
      opportunityId: fixtureIds.opportunities.exampleRenewal,
      status: "sent",
      totalValueMinor: 52500
    });
    expect(foundationSeed.commercialProposalItems[0]).toMatchObject({
      proposalId: fixtureIds.commercialProposals.exampleAutumn,
      inventorySlotId: fixtureIds.inventorySlots.suttonAutumnPage3
    });
    expect(foundationSeed.commercialBookings).toEqual([]);
    expect(foundationSeed.commercialProductionRequests).toEqual([]);
  });

  it("includes deterministic advertiser terms without acceptance side effects", () => {
    expect(foundationSeed.advertiserTerms[0]).toMatchObject({
      key: "standard-advertiser-terms",
      version: "2026.1",
      status: "approved"
    });
    expect(foundationSeed.advertiserProposalAcceptances).toEqual([]);
    expect(foundationSeed.advertiserDomainEvents).toEqual([]);
  });

  it("includes deterministic advertiser finance sequence without fake finance state", () => {
    expect(foundationSeed.advertiserInvoiceSequences[0]).toMatchObject({
      issuerOrganisationId: fixtureIds.organisations.franchise,
      prefix: "R2G",
      nextNumber: 1
    });
    expect(foundationSeed.advertiserInvoices).toEqual([]);
    expect(foundationSeed.advertiserPayments).toEqual([]);
  });

  it("does not seed fake advertiser artwork records", () => {
    expect(foundationSeed.artworkRequirements).toEqual([]);
    expect(foundationSeed.artworkVersions).toEqual([]);
    expect(foundationSeed.campaignFulfilments).toEqual([]);
    expect(foundationSeed.proofPacks).toEqual([]);
    expect(foundationSeed.renewalPrompts).toEqual([]);
  });

  it("includes native audience fixtures without duplicating multi-territory identity", () => {
    expect(foundationSeed.audienceContacts).toHaveLength(1);
    expect(foundationSeed.audienceTerritorySubscriptions).toHaveLength(2);
    expect(new Set(foundationSeed.audienceTerritorySubscriptions.map((subscription) => subscription.contactId))).toEqual(
      new Set([fixtureIds.audienceContacts.parentOne])
    );
    expect(foundationSeed.audienceConsentEvents).toHaveLength(1);
    expect(foundationSeed.audienceSuppressions).toEqual([]);
    expect(foundationSeed.emailTemplates[0]?.requiredBlocks).toContain("unsubscribe");
    expect(foundationSeed.emailCampaigns).toEqual([]);
    expect(foundationSeed.emailDeliveryRecords).toEqual([]);
    expect(foundationSeed.networkNewsletterMasters[0]).toMatchObject({
      id: fixtureIds.networkNewsletterMasters.autumnFamilyGuide,
      status: "approved",
      seasonKey: "autumn"
    });
    expect(foundationSeed.territoryNewsletterEditions).toEqual([]);
    expect(foundationSeed.newsletterFactoryRuns).toEqual([]);
    expect(foundationSeed.contentItems[0]).toMatchObject({
      id: fixtureIds.contentItems.halfTermGuide,
      ownerLevel: "network"
    });
    expect(foundationSeed.contentLocalisations[0]).toMatchObject({
      territoryId: fixtureIds.territories.suttonColdfield,
      state: "locally_overridden"
    });
    expect(foundationSeed.contentChannelVariants.map((variant) => variant.channel)).toEqual([
      "website",
      "newsletter",
      "facebook"
    ]);
    expect(foundationSeed.socialAccounts.map((account) => account.channel)).toEqual([
      "facebook",
      "instagram"
    ]);
    expect(foundationSeed.socialPublications[0]).toMatchObject({
      id: fixtureIds.socialPublications.halfTermFacebookSutton,
      publishState: "published",
      territoryId: fixtureIds.territories.suttonColdfield
    });
  });

  it("includes a deterministic invitation fixture for IAM-001", () => {
    expect(fixtureIds.invitations.franchiseStaff).toBe(
      "00000000-0000-4000-8000-000000000801"
    );
  });

  it("includes deterministic privacy-light audience preference fixtures", () => {
    expect(fixtureIds.audiencePreferenceProfiles.parentOne).toBe(
      "00000000-0000-4000-8000-000000000769"
    );
    expect(foundationSeed.audiencePreferenceProfiles[0]?.childAgeBands).toEqual([
      "primary"
    ]);
    expect(foundationSeed.audiencePreferenceProfiles[0]?.privacyMetadata).toMatchObject({
      dataMinimisation: "broad_age_bands_only"
    });
    expect(foundationSeed.audienceSavedContent[0]?.contactId).toBe(
      fixtureIds.audienceContacts.parentOne
    );
  });
});
