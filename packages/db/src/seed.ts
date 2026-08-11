import { sql } from "drizzle-orm";
import { createDb } from "./client";
import { fixtureIds, foundationSeed } from "./fixtures";
import {
  auditEvents,
  audienceConsentEvents,
  audienceContacts,
  audienceSegments,
  audienceTerritorySubscriptions,
  advertiserActivityEvents,
  advertiserContacts,
  advertiserInvoiceSequences,
  advertiserTerms,
  advertiserMetricSnapshots,
  advertisers,
  commercialPackages,
  commercialProducts,
  commercialProposalItems,
  commercialProposals,
  contentAiTasks,
  contentChannelVariantVersions,
  contentChannelVariants,
  contentItemVersions,
  contentItems,
  contentLocalisations,
  emailTemplates,
  networkNewsletterMasters,
  agreementTemplates,
  agreementVersions,
  authInvitations,
  complianceRequirements,
  franchiseArtifactReferences,
  franchiseComplianceRecords,
  franchiseContacts,
  franchiseDocuments,
  franchiseDocumentVersions,
  franchises,
  franchiseInsurancePolicies,
  inventorySlots,
  memberships,
  onboardingTemplatePhases,
  onboardingTemplateTasks,
  onboardingTemplates,
  organisations,
  opportunities,
  pipelineStages,
  priceBookItems,
  priceBooks,
  permissions,
  rolePermissions,
  roles,
  magazineTemplates,
  magazineTemplateVersions,
  masterEditions,
  seasons,
  socialAccounts,
  socialPublications,
  socialPublishJobs,
  territories,
  territoryEditions,
  userRoleAssignments,
  users
} from "./schema";

export async function seedDatabase(databaseUrl?: string) {
  const { db, sql: client } = createDb(databaseUrl);

  try {
    await db.insert(organisations).values([...foundationSeed.organisations]).onConflictDoUpdate({
      target: organisations.id,
      set: {
        kind: sql`excluded.kind`,
        name: sql`excluded.name`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(territories).values([...foundationSeed.territories]).onConflictDoUpdate({
      target: territories.id,
      set: {
        franchiseOrganisationId: sql`excluded.franchise_organisation_id`,
        code: sql`excluded.code`,
        name: sql`excluded.name`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(users).values([...foundationSeed.users]).onConflictDoUpdate({
      target: users.id,
      set: {
        email: sql`excluded.email`,
        displayName: sql`excluded.display_name`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(roles).values([...foundationSeed.roles]).onConflictDoUpdate({
      target: roles.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        isSystem: sql`excluded.is_system`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(permissions).values([...foundationSeed.permissions]).onConflictDoUpdate({
      target: permissions.id,
      set: {
        module: sql`excluded.module`,
        action: sql`excluded.action`,
        description: sql`excluded.description`,
        updatedAt: sql`now()`
      }
    });

    await db.insert(memberships).values([
      {
        id: "00000000-0000-4000-8000-000000000501",
        userId: fixtureIds.users.superAdmin,
        organisationId: fixtureIds.organisations.hq
      },
      {
        id: "00000000-0000-4000-8000-000000000502",
        userId: fixtureIds.users.franchisee,
        organisationId: fixtureIds.organisations.franchise
      }
    ]).onConflictDoNothing();

    await db.insert(rolePermissions).values([
      {
        roleId: fixtureIds.roles.superAdmin,
        permissionId: fixtureIds.permissions.systemAdminister,
        scope: "system",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.rolesView,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.territoryView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.franchiseView,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.franchiseCreate,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.franchiseEdit,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.franchiseView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.agreementView,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.agreementGenerate,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.agreementSubmitApproval,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.agreementApprove,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.hqAdmin,
        permissionId: fixtureIds.permissions.agreementVoid,
        scope: "network",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.agreementView,
        scope: "own_territory",
        constraints: {}
      },
      ...[
        fixtureIds.permissions.agreementSendSignature,
        fixtureIds.permissions.agreementCancelSignature,
        fixtureIds.permissions.agreementResendSignature,
        fixtureIds.permissions.agreementViewSignatureStatus,
        fixtureIds.permissions.agreementRecordSignatureEvent,
        fixtureIds.permissions.agreementDownloadExecuted
      ].map((permissionId) => ({
        roleId: fixtureIds.roles.hqAdmin,
        permissionId,
        scope: "network" as const,
        constraints: {}
      })),
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.agreementViewSignatureStatus,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.agreementDownloadExecuted,
        scope: "own_territory",
        constraints: {}
      },
      ...[
        fixtureIds.permissions.documentView,
        fixtureIds.permissions.documentUpload,
        fixtureIds.permissions.documentDownload,
        fixtureIds.permissions.documentArchive,
        fixtureIds.permissions.complianceView,
        fixtureIds.permissions.complianceManageRequirements,
        fixtureIds.permissions.complianceSubmitEvidence,
        fixtureIds.permissions.complianceVerify,
        fixtureIds.permissions.complianceManageActions,
        fixtureIds.permissions.complianceViewNetwork,
        fixtureIds.permissions.onboardingView,
        fixtureIds.permissions.onboardingManage,
        fixtureIds.permissions.onboardingTemplateManage,
        fixtureIds.permissions.onboardingTaskComplete,
        fixtureIds.permissions.onboardingTaskAssign,
        fixtureIds.permissions.onboardingApproveMilestone,
        fixtureIds.permissions.onboardingApproveLaunch,
        fixtureIds.permissions.editionView,
        fixtureIds.permissions.editionCreate,
        fixtureIds.permissions.editionEdit,
        fixtureIds.permissions.editionApprove,
        fixtureIds.permissions.editionRelease,
        fixtureIds.permissions.editionTemplateCreate,
        fixtureIds.permissions.editionTemplateEdit,
        fixtureIds.permissions.editionTemplateApprove,
        fixtureIds.permissions.editionTemplatePublish,
        fixtureIds.permissions.editionPageEdit,
        fixtureIds.permissions.editionLocalContentEdit,
        fixtureIds.permissions.editionLockedContentManage,
        fixtureIds.permissions.editionPreflightOverride,
        fixtureIds.permissions.editionGeneratePrint,
        fixtureIds.permissions.editionGenerateDigital,
        fixtureIds.permissions.advertiserView,
        fixtureIds.permissions.advertiserCreate,
        fixtureIds.permissions.advertiserEdit,
        fixtureIds.permissions.advertiserContactManage,
        fixtureIds.permissions.advertiserActivityRecord,
        fixtureIds.permissions.opportunityView,
        fixtureIds.permissions.opportunityCreate,
        fixtureIds.permissions.opportunityEdit,
        fixtureIds.permissions.catalogueView,
        fixtureIds.permissions.pricingManage,
        fixtureIds.permissions.inventoryReserve,
        fixtureIds.permissions.proposalView,
        fixtureIds.permissions.proposalCreate,
        fixtureIds.permissions.bookingAccept,
        fixtureIds.permissions.proposalAccept,
        fixtureIds.permissions.proposalRespond,
        fixtureIds.permissions.financeView,
        fixtureIds.permissions.invoiceCreate,
        fixtureIds.permissions.invoiceEditDraft,
        fixtureIds.permissions.invoiceIssue,
        fixtureIds.permissions.creditCreate,
        fixtureIds.permissions.paymentRecord,
        fixtureIds.permissions.paymentAllocate,
        fixtureIds.permissions.paymentReconcile,
        fixtureIds.permissions.financeExport,
        fixtureIds.permissions.artworkView,
        fixtureIds.permissions.artworkManage,
        fixtureIds.permissions.artworkSubmit,
        fixtureIds.permissions.artworkApprove,
        fixtureIds.permissions.fulfilmentView,
        fixtureIds.permissions.fulfilmentManage,
        fixtureIds.permissions.proofView,
        fixtureIds.permissions.proofCreate,
        fixtureIds.permissions.renewalView,
        fixtureIds.permissions.renewalManage,
        fixtureIds.permissions.analyticsView,
        fixtureIds.permissions.audienceView,
        fixtureIds.permissions.audienceManage,
        fixtureIds.permissions.consentManage,
        fixtureIds.permissions.segmentView,
        fixtureIds.permissions.segmentManage,
        fixtureIds.permissions.audienceImportManage,
        fixtureIds.permissions.emailView,
        fixtureIds.permissions.emailCreate,
        fixtureIds.permissions.emailApprove,
        fixtureIds.permissions.emailSchedule,
        fixtureIds.permissions.emailSend,
        fixtureIds.permissions.emailRecordDelivery,
        fixtureIds.permissions.newsletterFactoryView,
        fixtureIds.permissions.newsletterFactoryManage,
        fixtureIds.permissions.newsletterFactoryApprove,
        fixtureIds.permissions.newsletterFactoryContribute,
        fixtureIds.permissions.contentView,
        fixtureIds.permissions.contentCreate,
        fixtureIds.permissions.contentEdit,
        fixtureIds.permissions.contentApprove,
        fixtureIds.permissions.contentLocalise,
        fixtureIds.permissions.contentDistributeNetwork,
        fixtureIds.permissions.contentAiGenerate,
        fixtureIds.permissions.contentAiApprove,
        fixtureIds.permissions.contentWebsitePublish,
        fixtureIds.permissions.socialView,
        fixtureIds.permissions.socialCreate,
        fixtureIds.permissions.socialEdit,
        fixtureIds.permissions.socialApprove,
        fixtureIds.permissions.socialSchedule,
        fixtureIds.permissions.socialPublish,
        fixtureIds.permissions.socialCancel,
        fixtureIds.permissions.socialManageAccounts,
        fixtureIds.permissions.socialNetworkDistribute
      ].map((permissionId) => ({
        roleId: fixtureIds.roles.hqAdmin,
        permissionId,
        scope: "network" as const,
        constraints: {}
      })),
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.documentView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.documentDownload,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.complianceView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.complianceSubmitEvidence,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.onboardingView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.onboardingTaskComplete,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.editionView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.editionPageEdit,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.editionLocalContentEdit,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.advertiserView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.advertiserCreate,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.advertiserEdit,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.advertiserContactManage,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.advertiserActivityRecord,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.opportunityView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.opportunityCreate,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.opportunityEdit,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.catalogueView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.inventoryReserve,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.proposalView,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.proposalCreate,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.bookingAccept,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.proposalAccept,
        scope: "own_territory",
        constraints: {}
      },
      {
        roleId: fixtureIds.roles.franchisee,
        permissionId: fixtureIds.permissions.proposalRespond,
        scope: "own_territory",
        constraints: {}
      },
      ...[
        fixtureIds.permissions.financeView,
        fixtureIds.permissions.invoiceCreate,
        fixtureIds.permissions.invoiceEditDraft,
        fixtureIds.permissions.invoiceIssue,
        fixtureIds.permissions.creditCreate,
        fixtureIds.permissions.paymentRecord,
        fixtureIds.permissions.paymentAllocate,
        fixtureIds.permissions.artworkView,
        fixtureIds.permissions.artworkManage,
        fixtureIds.permissions.artworkSubmit,
        fixtureIds.permissions.artworkApprove,
        fixtureIds.permissions.fulfilmentView,
        fixtureIds.permissions.fulfilmentManage,
        fixtureIds.permissions.proofView,
        fixtureIds.permissions.proofCreate,
        fixtureIds.permissions.renewalView,
        fixtureIds.permissions.renewalManage,
        fixtureIds.permissions.analyticsView,
        fixtureIds.permissions.audienceView,
        fixtureIds.permissions.audienceManage,
        fixtureIds.permissions.consentManage,
        fixtureIds.permissions.segmentView,
        fixtureIds.permissions.segmentManage,
        fixtureIds.permissions.audienceImportManage,
        fixtureIds.permissions.emailView,
        fixtureIds.permissions.emailCreate,
        fixtureIds.permissions.emailApprove,
        fixtureIds.permissions.emailSchedule,
        fixtureIds.permissions.emailSend,
        fixtureIds.permissions.emailRecordDelivery,
        fixtureIds.permissions.newsletterFactoryView,
        fixtureIds.permissions.newsletterFactoryContribute,
        fixtureIds.permissions.contentView,
        fixtureIds.permissions.contentLocalise,
        fixtureIds.permissions.contentAiGenerate,
        fixtureIds.permissions.socialView,
        fixtureIds.permissions.socialCreate,
        fixtureIds.permissions.socialEdit,
        fixtureIds.permissions.socialApprove,
        fixtureIds.permissions.socialSchedule,
        fixtureIds.permissions.socialCancel
      ].map((permissionId) => ({
        roleId: fixtureIds.roles.franchisee,
        permissionId,
        scope: "own_territory" as const,
        constraints: {}
      }))
    ]).onConflictDoNothing();

    await db.insert(userRoleAssignments).values([
      {
        id: "00000000-0000-4000-8000-000000000601",
        userId: fixtureIds.users.superAdmin,
        roleId: fixtureIds.roles.superAdmin,
        organisationId: fixtureIds.organisations.hq
      },
      {
        id: "00000000-0000-4000-8000-000000000603",
        userId: fixtureIds.users.superAdmin,
        roleId: fixtureIds.roles.hqAdmin,
        organisationId: fixtureIds.organisations.hq
      },
      {
        id: "00000000-0000-4000-8000-000000000602",
        userId: fixtureIds.users.franchisee,
        roleId: fixtureIds.roles.franchisee,
        organisationId: fixtureIds.organisations.franchise,
        territoryId: fixtureIds.territories.suttonColdfield
      }
    ]).onConflictDoNothing();

    await db.insert(auditEvents).values({
      id: "00000000-0000-4000-8000-000000000701",
      actorUserId: fixtureIds.users.superAdmin,
      action: "seed.foundation",
      entityType: "organisation",
      entityId: fixtureIds.organisations.franchise,
      organisationId: fixtureIds.organisations.hq,
      payload: {
        deterministic: true,
        ticket: "FND-003"
      }
    }).onConflictDoNothing();

    await db.insert(authInvitations).values({
      id: fixtureIds.invitations.franchiseStaff,
      email: "staff@example.raring2go.test",
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield,
      tokenHash:
        "0000000000000000000000000000000000000000000000000000000000000801",
      status: "pending",
      invitedByUserId: fixtureIds.users.superAdmin,
      expiresAt: new Date("2099-01-01T00:00:00.000Z")
    }).onConflictDoNothing();

    await db.insert(advertisers).values(foundationSeed.advertisers.map((advertiser) => ({
      ...advertiser,
      firstBookedOn: advertiser.firstBookedOn ? new Date(advertiser.firstBookedOn) : null,
      lastBookedOn: advertiser.lastBookedOn ? new Date(advertiser.lastBookedOn) : null,
      lapsedOn: advertiser.lapsedOn ? new Date(advertiser.lapsedOn) : null,
      tags: [...advertiser.tags],
      commercialMetadata: { ...advertiser.commercialMetadata }
    }))).onConflictDoUpdate({
      target: advertisers.id,
      set: {
        advertiserOrganisationId: sql`excluded.advertiser_organisation_id`,
        owningTerritoryId: sql`excluded.owning_territory_id`,
        accountOwnerUserId: sql`excluded.account_owner_user_id`,
        status: sql`excluded.status`,
        relationshipState: sql`excluded.relationship_state`,
        source: sql`excluded.source`,
        firstBookedOn: sql`excluded.first_booked_on`,
        lastBookedOn: sql`excluded.last_booked_on`,
        lapsedOn: sql`excluded.lapsed_on`,
        averageSaleValueMinor: sql`excluded.average_sale_value_minor`,
        annualAdvertiserValueMinor: sql`excluded.annual_advertiser_value_minor`,
        currency: sql`excluded.currency`,
        tags: sql`excluded.tags`,
        commercialMetadata: sql`excluded.commercial_metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(advertiserContacts).values([...foundationSeed.advertiserContacts]).onConflictDoUpdate({
      target: advertiserContacts.id,
      set: {
        advertiserId: sql`excluded.advertiser_id`,
        userId: sql`excluded.user_id`,
        label: sql`excluded.label`,
        name: sql`excluded.name`,
        email: sql`excluded.email`,
        phone: sql`excluded.phone`,
        role: sql`excluded.role`,
        isPrimary: sql`excluded.is_primary`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(advertiserActivityEvents).values(foundationSeed.advertiserActivityEvents.map((event) => ({
      ...event,
      metadata: { ...event.metadata }
    }))).onConflictDoUpdate({
      target: advertiserActivityEvents.id,
      set: {
        advertiserId: sql`excluded.advertiser_id`,
        territoryId: sql`excluded.territory_id`,
        actorUserId: sql`excluded.actor_user_id`,
        activityType: sql`excluded.activity_type`,
        title: sql`excluded.title`,
        body: sql`excluded.body`,
        relatedEntityType: sql`excluded.related_entity_type`,
        relatedEntityId: sql`excluded.related_entity_id`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(advertiserMetricSnapshots).values(foundationSeed.advertiserMetricSnapshots.map((snapshot) => ({
      ...snapshot,
      packageMix: { ...snapshot.packageMix },
      digitalMix: { ...snapshot.digitalMix },
      benchmarkMetadata: { ...snapshot.benchmarkMetadata }
    }))).onConflictDoUpdate({
      target: advertiserMetricSnapshots.id,
      set: {
        advertiserId: sql`excluded.advertiser_id`,
        territoryId: sql`excluded.territory_id`,
        periodKey: sql`excluded.period_key`,
        averageSaleValueMinor: sql`excluded.average_sale_value_minor`,
        annualAdvertiserValueMinor: sql`excluded.annual_advertiser_value_minor`,
        bookingCount: sql`excluded.booking_count`,
        packageMix: sql`excluded.package_mix`,
        digitalMix: sql`excluded.digital_mix`,
        conversionState: sql`excluded.conversion_state`,
        churnRisk: sql`excluded.churn_risk`,
        overdueDebtMinor: sql`excluded.overdue_debt_minor`,
        benchmarkMetadata: sql`excluded.benchmark_metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(pipelineStages).values([...foundationSeed.pipelineStages]).onConflictDoUpdate({
      target: pipelineStages.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        sortOrder: sql`excluded.sort_order`,
        probabilityDefault: sql`excluded.probability_default`,
        isClosed: sql`excluded.is_closed`,
        outcome: sql`excluded.outcome`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(opportunities).values(foundationSeed.opportunities.map((opportunity) => ({
      ...opportunity,
      expectedCloseDate: opportunity.expectedCloseDate ? new Date(opportunity.expectedCloseDate) : null,
      nextActionDate: opportunity.nextActionDate ? new Date(opportunity.nextActionDate) : null,
      closedAt: opportunity.closedAt ? new Date(opportunity.closedAt) : null
    }))).onConflictDoUpdate({
      target: opportunities.id,
      set: {
        advertiserId: sql`excluded.advertiser_id`,
        territoryId: sql`excluded.territory_id`,
        ownerUserId: sql`excluded.owner_user_id`,
        stageId: sql`excluded.stage_id`,
        source: sql`excluded.source`,
        title: sql`excluded.title`,
        estimatedValueMinor: sql`excluded.estimated_value_minor`,
        currency: sql`excluded.currency`,
        probability: sql`excluded.probability`,
        expectedCloseDate: sql`excluded.expected_close_date`,
        nextAction: sql`excluded.next_action`,
        nextActionDate: sql`excluded.next_action_date`,
        notes: sql`excluded.notes`,
        lostReason: sql`excluded.lost_reason`,
        competitor: sql`excluded.competitor`,
        closedAt: sql`excluded.closed_at`,
        createdByUserId: sql`excluded.created_by_user_id`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(commercialProducts).values(foundationSeed.commercialProducts.map((product) => ({
      ...product,
      metadata: { ...product.metadata }
    }))).onConflictDoUpdate({
      target: commercialProducts.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        channel: sql`excluded.channel`,
        status: sql`excluded.status`,
        requiresInventory: sql`excluded.requires_inventory`,
        requiresArtwork: sql`excluded.requires_artwork`,
        taxCode: sql`excluded.tax_code`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(commercialPackages).values(foundationSeed.commercialPackages.map((bundle) => ({
      ...bundle,
      lines: [...bundle.lines],
      metadata: { ...bundle.metadata }
    }))).onConflictDoUpdate({
      target: commercialPackages.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        status: sql`excluded.status`,
        lines: sql`excluded.lines`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(priceBooks).values(foundationSeed.priceBooks.map((book) => ({
      ...book,
      effectiveFrom: book.effectiveFrom ? new Date(book.effectiveFrom) : null,
      effectiveTo: book.effectiveTo ? new Date(book.effectiveTo) : null
    }))).onConflictDoUpdate({
      target: priceBooks.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        territoryId: sql`excluded.territory_id`,
        status: sql`excluded.status`,
        effectiveFrom: sql`excluded.effective_from`,
        effectiveTo: sql`excluded.effective_to`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(priceBookItems).values(foundationSeed.priceBookItems.map((item) => ({
      ...item,
      metadata: { ...item.metadata }
    }))).onConflictDoUpdate({
      target: priceBookItems.id,
      set: {
        priceBookId: sql`excluded.price_book_id`,
        productId: sql`excluded.product_id`,
        standardPriceMinor: sql`excluded.standard_price_minor`,
        minimumPriceMinor: sql`excluded.minimum_price_minor`,
        currency: sql`excluded.currency`,
        approvalRequiredBelowMinor: sql`excluded.approval_required_below_minor`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(inventorySlots).values(foundationSeed.inventorySlots.map((slot) => ({
      ...slot,
      metadata: { ...slot.metadata }
    }))).onConflictDoUpdate({
      target: inventorySlots.id,
      set: {
        territoryEditionId: sql`excluded.territory_edition_id`,
        editionPageId: sql`excluded.edition_page_id`,
        territoryId: sql`excluded.territory_id`,
        productId: sql`excluded.product_id`,
        slotKey: sql`excluded.slot_key`,
        inventoryClass: sql`excluded.inventory_class`,
        exclusive: sql`excluded.exclusive`,
        status: sql`excluded.status`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(commercialProposals).values(foundationSeed.commercialProposals.map((proposal) => ({
      ...proposal,
      validUntil: proposal.validUntil ? new Date(proposal.validUntil) : null,
      sentOn: proposal.sentOn ? new Date(proposal.sentOn) : null,
      acceptedOn: proposal.acceptedOn ? new Date(proposal.acceptedOn) : null,
      metadata: { ...proposal.metadata }
    }))).onConflictDoUpdate({
      target: commercialProposals.id,
      set: {
        advertiserId: sql`excluded.advertiser_id`,
        opportunityId: sql`excluded.opportunity_id`,
        territoryId: sql`excluded.territory_id`,
        status: sql`excluded.status`,
        version: sql`excluded.version`,
        title: sql`excluded.title`,
        totalValueMinor: sql`excluded.total_value_minor`,
        currency: sql`excluded.currency`,
        validUntil: sql`excluded.valid_until`,
        sentOn: sql`excluded.sent_on`,
        acceptedOn: sql`excluded.accepted_on`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(commercialProposalItems).values(foundationSeed.commercialProposalItems.map((item) => ({
      ...item,
      metadata: { ...item.metadata }
    }))).onConflictDoUpdate({
      target: commercialProposalItems.id,
      set: {
        proposalId: sql`excluded.proposal_id`,
        productId: sql`excluded.product_id`,
        packageId: sql`excluded.package_id`,
        inventorySlotId: sql`excluded.inventory_slot_id`,
        description: sql`excluded.description`,
        quantity: sql`excluded.quantity`,
        unitPriceMinor: sql`excluded.unit_price_minor`,
        totalPriceMinor: sql`excluded.total_price_minor`,
        currency: sql`excluded.currency`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(advertiserTerms).values(foundationSeed.advertiserTerms.map((terms) => ({
      ...terms,
      approvedAt: terms.approvedAt ? new Date(terms.approvedAt) : null,
      contentSnapshot: { ...terms.contentSnapshot }
    }))).onConflictDoUpdate({
      target: advertiserTerms.id,
      set: {
        key: sql`excluded.key`,
        version: sql`excluded.version`,
        status: sql`excluded.status`,
        title: sql`excluded.title`,
        contentHash: sql`excluded.content_hash`,
        contentSnapshot: sql`excluded.content_snapshot`,
        approvedAt: sql`excluded.approved_at`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(advertiserInvoiceSequences).values([...foundationSeed.advertiserInvoiceSequences]).onConflictDoUpdate({
      target: advertiserInvoiceSequences.id,
      set: {
        issuerOrganisationId: sql`excluded.issuer_organisation_id`,
        key: sql`excluded.key`,
        prefix: sql`excluded.prefix`,
        nextNumber: sql`excluded.next_number`,
        padding: sql`excluded.padding`,
        updatedAt: sql`now()`
      }
    });

    await db.insert(audienceContacts).values(foundationSeed.audienceContacts.map((contact) => ({
      ...contact,
      tags: [...contact.tags],
      metadata: { ...contact.metadata }
    }))).onConflictDoUpdate({
      target: audienceContacts.id,
      set: {
        email: sql`excluded.email`,
        emailNormalised: sql`excluded.email_normalised`,
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        emailStatus: sql`excluded.email_status`,
        tags: sql`excluded.tags`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(audienceTerritorySubscriptions).values(foundationSeed.audienceTerritorySubscriptions.map((subscription) => ({
      ...subscription,
      preferences: { ...subscription.preferences },
      subscribedAt: subscription.subscribedAt ? new Date(subscription.subscribedAt) : null,
      unsubscribedAt: subscription.unsubscribedAt ? new Date(subscription.unsubscribedAt) : null
    }))).onConflictDoUpdate({
      target: audienceTerritorySubscriptions.id,
      set: {
        status: sql`excluded.status`,
        source: sql`excluded.source`,
        preferences: sql`excluded.preferences`,
        subscribedAt: sql`excluded.subscribed_at`,
        unsubscribedAt: sql`excluded.unsubscribed_at`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(audienceConsentEvents).values(foundationSeed.audienceConsentEvents.map((event) => ({
      ...event,
      occurredAt: new Date(event.occurredAt),
      evidence: { ...event.evidence }
    }))).onConflictDoNothing();

    await db.insert(audienceSegments).values(foundationSeed.audienceSegments.map((segment) => ({
      ...segment,
      definition: { ...segment.definition }
    }))).onConflictDoUpdate({
      target: audienceSegments.id,
      set: {
        territoryId: sql`excluded.territory_id`,
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        segmentType: sql`excluded.segment_type`,
        definition: sql`excluded.definition`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(emailTemplates).values(foundationSeed.emailTemplates.map((template) => ({
      ...template,
      blocks: [...template.blocks],
      requiredBlocks: [...template.requiredBlocks],
      metadata: { ...template.metadata }
    }))).onConflictDoUpdate({
      target: emailTemplates.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        templateType: sql`excluded.template_type`,
        status: sql`excluded.status`,
        blocks: sql`excluded.blocks`,
        requiredBlocks: sql`excluded.required_blocks`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(networkNewsletterMasters).values(foundationSeed.networkNewsletterMasters.map((master) => ({
      ...master,
      lockedBlocks: [...master.lockedBlocks],
      optionalBlocks: [...master.optionalBlocks],
      localEditableBlocks: [...master.localEditableBlocks],
      contentRules: { ...master.contentRules },
      approvedAt: master.approvedAt ? new Date(master.approvedAt) : null
    }))).onConflictDoUpdate({
      target: networkNewsletterMasters.id,
      set: {
        templateId: sql`excluded.template_id`,
        title: sql`excluded.title`,
        status: sql`excluded.status`,
        seasonKey: sql`excluded.season_key`,
        lockedBlocks: sql`excluded.locked_blocks`,
        optionalBlocks: sql`excluded.optional_blocks`,
        localEditableBlocks: sql`excluded.local_editable_blocks`,
        contentRules: sql`excluded.content_rules`,
        createdByUserId: sql`excluded.created_by_user_id`,
        approvedByUserId: sql`excluded.approved_by_user_id`,
        approvedAt: sql`excluded.approved_at`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(contentItems).values(foundationSeed.contentItems.map((item) => ({
      ...item,
      heroArtifactReference: { ...item.heroArtifactReference },
      categories: [...item.categories],
      tags: [...item.tags],
      relevantDates: { ...item.relevantDates },
      provenance: { ...item.provenance },
      approvedAt: item.approvedAt ? new Date(item.approvedAt) : null,
      publishedAt: item.publishedAt ? new Date(item.publishedAt) : null
    }))).onConflictDoUpdate({
      target: contentItems.id,
      set: {
        title: sql`excluded.title`,
        standfirst: sql`excluded.standfirst`,
        contentType: sql`excluded.content_type`,
        ownerLevel: sql`excluded.owner_level`,
        organisationId: sql`excluded.organisation_id`,
        territoryId: sql`excluded.territory_id`,
        status: sql`excluded.status`,
        heroArtifactReference: sql`excluded.hero_artifact_reference`,
        categories: sql`excluded.categories`,
        tags: sql`excluded.tags`,
        relevantDates: sql`excluded.relevant_dates`,
        provenance: sql`excluded.provenance`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(contentItemVersions).values(foundationSeed.contentItemVersions.map((version) => ({
      ...version,
      snapshot: { ...version.snapshot },
      provenance: { ...version.provenance }
    }))).onConflictDoNothing();

    await db.insert(contentLocalisations).values(foundationSeed.contentLocalisations.map((localisation) => ({
      ...localisation,
      lockedFields: [...localisation.lockedFields],
      editableFields: [...localisation.editableFields],
      localOverrides: { ...localisation.localOverrides },
      reviewedAt: localisation.reviewedAt ? new Date(localisation.reviewedAt) : null
    }))).onConflictDoUpdate({
      target: contentLocalisations.id,
      set: {
        state: sql`excluded.state`,
        lockedFields: sql`excluded.locked_fields`,
        editableFields: sql`excluded.editable_fields`,
        localOverrides: sql`excluded.local_overrides`,
        masterVersionNumber: sql`excluded.master_version_number`,
        reviewedAt: sql`excluded.reviewed_at`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(contentChannelVariants).values(foundationSeed.contentChannelVariants.map((variant) => ({
      ...variant,
      scheduledAt: variant.scheduledAt ? new Date(variant.scheduledAt) : null,
      publishedAt: variant.publishedAt ? new Date(variant.publishedAt) : null
    }))).onConflictDoUpdate({
      target: contentChannelVariants.id,
      set: {
        status: sql`excluded.status`,
        currentVersionId: sql`excluded.current_version_id`,
        provenance: sql`excluded.provenance`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(contentAiTasks).values(foundationSeed.contentAiTasks.map((task) => ({
      ...task,
      generatedAt: new Date(task.generatedAt),
      decidedAt: task.decidedAt ? new Date(task.decidedAt) : null
    }))).onConflictDoUpdate({
      target: contentAiTasks.id,
      set: {
        status: sql`excluded.status`,
        generatedOutput: sql`excluded.generated_output`,
        humanDecision: sql`excluded.human_decision`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(contentChannelVariantVersions).values(foundationSeed.contentChannelVariantVersions.map((version) => ({
      ...version,
      approvedAt: version.approvedAt ? new Date(version.approvedAt) : null
    }))).onConflictDoNothing();

    await db.insert(socialAccounts).values(foundationSeed.socialAccounts.map((account) => ({
      ...account,
      capabilityMetadata: { ...account.capabilityMetadata },
      providerMetadata: { ...account.providerMetadata },
      lastSyncedAt: account.lastSyncedAt ? new Date(account.lastSyncedAt) : null
    }))).onConflictDoUpdate({
      target: socialAccounts.id,
      set: {
        channel: sql`excluded.channel`,
        organisationId: sql`excluded.organisation_id`,
        territoryId: sql`excluded.territory_id`,
        externalAccountReference: sql`excluded.external_account_reference`,
        displayName: sql`excluded.display_name`,
        connectionStatus: sql`excluded.connection_status`,
        connectionHealth: sql`excluded.connection_health`,
        capabilityMetadata: sql`excluded.capability_metadata`,
        providerMetadata: sql`excluded.provider_metadata`,
        active: sql`excluded.active`,
        lastSyncedAt: sql`excluded.last_synced_at`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(socialPublications).values(foundationSeed.socialPublications.map((publication) => ({
      ...publication,
      scheduledAt: publication.scheduledAt ? new Date(publication.scheduledAt) : null,
      approvedAt: publication.approvedAt ? new Date(publication.approvedAt) : null,
      publishedAt: publication.publishedAt ? new Date(publication.publishedAt) : null,
      immutableSnapshot: { ...publication.immutableSnapshot },
      mediaArtifactReferences: [...publication.mediaArtifactReferences],
      failureMetadata: { ...publication.failureMetadata }
    }))).onConflictDoUpdate({
      target: socialPublications.id,
      set: {
        approvalState: sql`excluded.approval_state`,
        publishState: sql`excluded.publish_state`,
        scheduledAt: sql`excluded.scheduled_at`,
        timezone: sql`excluded.timezone`,
        immutableSnapshot: sql`excluded.immutable_snapshot`,
        publishedExternalReference: sql`excluded.published_external_reference`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(socialPublishJobs).values(foundationSeed.socialPublishJobs.map((job) => ({
      ...job,
      runAfter: new Date(job.runAfter),
      providerRequest: { ...job.providerRequest },
      providerResponse: { ...job.providerResponse },
      lockedAt: job.lockedAt ? new Date(job.lockedAt) : null,
      completedAt: job.completedAt ? new Date(job.completedAt) : null
    }))).onConflictDoUpdate({
      target: socialPublishJobs.id,
      set: {
        status: sql`excluded.status`,
        attempts: sql`excluded.attempts`,
        providerResponse: sql`excluded.provider_response`,
        completedAt: sql`excluded.completed_at`,
        updatedAt: sql`now()`
      }
    });

    const franchiseSeed = foundationSeed.franchises.map((franchise) => {
      const endDate = (franchise as { endDate?: string }).endDate;

      return {
        ...franchise,
        launchDate: franchise.launchDate ? new Date(franchise.launchDate) : null,
        renewalDate: franchise.renewalDate ? new Date(franchise.renewalDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        tags: [...franchise.tags]
      };
    });

    await db.insert(franchises).values(franchiseSeed).onConflictDoUpdate({
      target: franchises.id,
      set: {
        franchiseOrganisationId: sql`excluded.franchise_organisation_id`,
        primaryTerritoryId: sql`excluded.primary_territory_id`,
        primaryOwnerUserId: sql`excluded.primary_owner_user_id`,
        status: sql`excluded.status`,
        lifecycleStage: sql`excluded.lifecycle_stage`,
        launchDate: sql`excluded.launch_date`,
        renewalDate: sql`excluded.renewal_date`,
        endDate: sql`excluded.end_date`,
        onboardingStatus: sql`excluded.onboarding_status`,
        supportStatus: sql`excluded.support_status`,
        tags: sql`excluded.tags`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(franchiseContacts).values([...foundationSeed.franchiseContacts]).onConflictDoUpdate({
      target: franchiseContacts.id,
      set: {
        franchiseId: sql`excluded.franchise_id`,
        userId: sql`excluded.user_id`,
        label: sql`excluded.label`,
        name: sql`excluded.name`,
        email: sql`excluded.email`,
        phone: sql`excluded.phone`,
        isPrimary: sql`excluded.is_primary`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(agreementTemplates).values([...foundationSeed.agreementTemplates]).onConflictDoUpdate({
      target: agreementTemplates.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(agreementVersions).values(foundationSeed.agreementVersions.map((version) => ({
      ...version,
      controlledMergeFields: [...version.controlledMergeFields],
      approvedAt: version.approvedAt ? new Date(version.approvedAt) : null
    }))).onConflictDoUpdate({
      target: agreementVersions.id,
      set: {
        templateId: sql`excluded.template_id`,
        version: sql`excluded.version`,
        status: sql`excluded.status`,
        controlledMergeFields: sql`excluded.controlled_merge_fields`,
        content: sql`excluded.content`,
        approvedByUserId: sql`excluded.approved_by_user_id`,
        approvedAt: sql`excluded.approved_at`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(franchiseArtifactReferences).values([...foundationSeed.franchiseArtifactReferences]).onConflictDoUpdate({
      target: franchiseArtifactReferences.id,
      set: {
        franchiseId: sql`excluded.franchise_id`,
        entityType: sql`excluded.entity_type`,
        entityId: sql`excluded.entity_id`,
        category: sql`excluded.category`,
        label: sql`excluded.label`,
        storageKey: sql`excluded.storage_key`,
        contentType: sql`excluded.content_type`,
        checksum: sql`excluded.checksum`,
        providerMetadata: sql`excluded.provider_metadata`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(franchiseDocuments).values(foundationSeed.franchiseDocuments.map((document) => ({
      ...document,
      expiryDate: "expiryDate" in document && document.expiryDate ? new Date(document.expiryDate) : null,
      archivedAt: null
    }))).onConflictDoUpdate({
      target: franchiseDocuments.id,
      set: {
        franchiseId: sql`excluded.franchise_id`,
        organisationId: sql`excluded.organisation_id`,
        territoryId: sql`excluded.territory_id`,
        category: sql`excluded.category`,
        documentType: sql`excluded.document_type`,
        title: sql`excluded.title`,
        description: sql`excluded.description`,
        status: sql`excluded.status`,
        currentVersionId: sql`excluded.current_version_id`,
        expiryDate: sql`excluded.expiry_date`,
        uploadedByUserId: sql`excluded.uploaded_by_user_id`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(franchiseDocumentVersions).values(foundationSeed.franchiseDocumentVersions.map((version) => ({
      ...version,
      uploadedAt: version.uploadedAt ? new Date(version.uploadedAt) : null
    }))).onConflictDoUpdate({
      target: franchiseDocumentVersions.id,
      set: {
        documentId: sql`excluded.document_id`,
        versionNumber: sql`excluded.version_number`,
        artifactReferenceId: sql`excluded.artifact_reference_id`,
        uploadedByUserId: sql`excluded.uploaded_by_user_id`,
        uploadedAt: sql`excluded.uploaded_at`,
        notes: sql`excluded.notes`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(franchiseInsurancePolicies).values(foundationSeed.insurancePolicies.map((policy) => ({
      ...policy,
      coverTypes: [...policy.coverTypes],
      coverStartDate: new Date(policy.coverStartDate),
      coverEndDate: new Date(policy.coverEndDate),
      verifiedAt: null
    }))).onConflictDoUpdate({
      target: franchiseInsurancePolicies.id,
      set: {
        provider: sql`excluded.provider`,
        policyNumber: sql`excluded.policy_number`,
        coverTypes: sql`excluded.cover_types`,
        coverStartDate: sql`excluded.cover_start_date`,
        coverEndDate: sql`excluded.cover_end_date`,
        evidenceDocumentId: sql`excluded.evidence_document_id`,
        verificationStatus: sql`excluded.verification_status`,
        verifiedByUserId: sql`excluded.verified_by_user_id`,
        verifiedAt: sql`excluded.verified_at`,
        rejectedReason: sql`excluded.rejected_reason`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(complianceRequirements).values([...foundationSeed.complianceRequirements]).onConflictDoUpdate({
      target: complianceRequirements.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        requiredDocumentCategory: sql`excluded.required_document_category`,
        requiredDocumentType: sql`excluded.required_document_type`,
        expiryWarningDays: sql`excluded.expiry_warning_days`,
        active: sql`excluded.active`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(franchiseComplianceRecords).values(foundationSeed.complianceRecords.map((record) => ({
      ...record,
      expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
      verifiedAt: null
    }))).onConflictDoUpdate({
      target: franchiseComplianceRecords.id,
      set: {
        franchiseId: sql`excluded.franchise_id`,
        requirementId: sql`excluded.requirement_id`,
        evidenceDocumentId: sql`excluded.evidence_document_id`,
        status: sql`excluded.status`,
        expiresAt: sql`excluded.expires_at`,
        verifiedByUserId: sql`excluded.verified_by_user_id`,
        verifiedAt: sql`excluded.verified_at`,
        rejectedReason: sql`excluded.rejected_reason`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(onboardingTemplates).values([...foundationSeed.onboardingTemplates]).onConflictDoUpdate({
      target: onboardingTemplates.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        status: sql`excluded.status`,
        readinessRules: sql`excluded.readiness_rules`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(onboardingTemplatePhases).values([...foundationSeed.onboardingTemplatePhases]).onConflictDoUpdate({
      target: onboardingTemplatePhases.id,
      set: {
        templateId: sql`excluded.template_id`,
        name: sql`excluded.name`,
        sortOrder: sql`excluded.sort_order`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(onboardingTemplateTasks).values(foundationSeed.onboardingTemplateTasks.map((task) => ({
      ...task,
      dueRule: { ...task.dueRule },
      dependencyRules: [...task.dependencyRules]
    }))).onConflictDoUpdate({
      target: onboardingTemplateTasks.id,
      set: {
        phaseId: sql`excluded.phase_id`,
        title: sql`excluded.title`,
        description: sql`excluded.description`,
        ownerType: sql`excluded.owner_type`,
        required: sql`excluded.required`,
        approvalRequired: sql`excluded.approval_required`,
        dueRule: sql`excluded.due_rule`,
        dependencyRules: sql`excluded.dependency_rules`,
        readinessGate: sql`excluded.readiness_gate`,
        sortOrder: sql`excluded.sort_order`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(seasons).values(foundationSeed.seasons.map((season) => ({
      ...season,
      publicationDate: season.publicationDate ? new Date(season.publicationDate) : null,
      bookingDeadline: season.bookingDeadline ? new Date(season.bookingDeadline) : null,
      artworkDeadline: season.artworkDeadline ? new Date(season.artworkDeadline) : null,
      editorialDeadline: season.editorialDeadline ? new Date(season.editorialDeadline) : null,
      proofDeadline: season.proofDeadline ? new Date(season.proofDeadline) : null,
      printDeadline: season.printDeadline ? new Date(season.printDeadline) : null,
      distributionDate: season.distributionDate ? new Date(season.distributionDate) : null
    }))).onConflictDoUpdate({
      target: seasons.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        year: sql`excluded.year`,
        season: sql`excluded.season`,
        status: sql`excluded.status`,
        accent: sql`excluded.accent`,
        publicationDate: sql`excluded.publication_date`,
        bookingDeadline: sql`excluded.booking_deadline`,
        artworkDeadline: sql`excluded.artwork_deadline`,
        editorialDeadline: sql`excluded.editorial_deadline`,
        proofDeadline: sql`excluded.proof_deadline`,
        printDeadline: sql`excluded.print_deadline`,
        distributionDate: sql`excluded.distribution_date`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(masterEditions).values([...foundationSeed.masterEditions]).onConflictDoUpdate({
      target: masterEditions.id,
      set: {
        seasonId: sql`excluded.season_id`,
        organisationId: sql`excluded.organisation_id`,
        title: sql`excluded.title`,
        status: sql`excluded.status`,
        pageCount: sql`excluded.page_count`,
        version: sql`excluded.version`,
        readiness: sql`excluded.readiness`,
        publicationArchive: sql`excluded.publication_archive`,
        locked: sql`excluded.locked`,
        createdByUserId: sql`excluded.created_by_user_id`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(territoryEditions).values(foundationSeed.territoryEditions.map((edition) => ({
      ...edition,
      publicationDate: edition.publicationDate ? new Date(edition.publicationDate) : null,
      bookingDeadline: edition.bookingDeadline ? new Date(edition.bookingDeadline) : null,
      artworkDeadline: edition.artworkDeadline ? new Date(edition.artworkDeadline) : null,
      editorialDeadline: edition.editorialDeadline ? new Date(edition.editorialDeadline) : null,
      proofDeadline: edition.proofDeadline ? new Date(edition.proofDeadline) : null,
      printDeadline: edition.printDeadline ? new Date(edition.printDeadline) : null,
      distributionDate: edition.distributionDate ? new Date(edition.distributionDate) : null
    }))).onConflictDoUpdate({
      target: territoryEditions.id,
      set: {
        masterEditionId: sql`excluded.master_edition_id`,
        seasonId: sql`excluded.season_id`,
        territoryId: sql`excluded.territory_id`,
        franchiseOrganisationId: sql`excluded.franchise_organisation_id`,
        editorUserId: sql`excluded.editor_user_id`,
        title: sql`excluded.title`,
        status: sql`excluded.status`,
        publicationDate: sql`excluded.publication_date`,
        bookingDeadline: sql`excluded.booking_deadline`,
        artworkDeadline: sql`excluded.artwork_deadline`,
        editorialDeadline: sql`excluded.editorial_deadline`,
        proofDeadline: sql`excluded.proof_deadline`,
        printDeadline: sql`excluded.print_deadline`,
        distributionDate: sql`excluded.distribution_date`,
        pageCount: sql`excluded.page_count`,
        printStatus: sql`excluded.print_status`,
        digitalStatus: sql`excluded.digital_status`,
        readiness: sql`excluded.readiness`,
        version: sql`excluded.version`,
        publicationArchive: sql`excluded.publication_archive`,
        generatedFromMasterVersion: sql`excluded.generated_from_master_version`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(magazineTemplates).values([...foundationSeed.magazineTemplates]).onConflictDoUpdate({
      target: magazineTemplates.id,
      set: {
        key: sql`excluded.key`,
        name: sql`excluded.name`,
        category: sql`excluded.category`,
        status: sql`excluded.status`,
        createdByUserId: sql`excluded.created_by_user_id`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    await db.insert(magazineTemplateVersions).values(foundationSeed.magazineTemplateVersions.map((version) => ({
      ...version,
      lockedElements: [...version.lockedElements],
      editableZones: [...version.editableZones],
      imageZones: [...version.imageZones],
      copyZones: [...version.copyZones],
      headlineZones: [...version.headlineZones],
      advertiserZones: [...version.advertiserZones],
      approvedAt: version.approvedAt ? new Date(version.approvedAt) : null,
      publishedAt: version.publishedAt ? new Date(version.publishedAt) : null
    }))).onConflictDoUpdate({
      target: magazineTemplateVersions.id,
      set: {
        templateId: sql`excluded.template_id`,
        version: sql`excluded.version`,
        status: sql`excluded.status`,
        pageDimensions: sql`excluded.page_dimensions`,
        bleed: sql`excluded.bleed`,
        trim: sql`excluded.trim`,
        margins: sql`excluded.margins`,
        grid: sql`excluded.grid`,
        lockedElements: sql`excluded.locked_elements`,
        editableZones: sql`excluded.editable_zones`,
        imageZones: sql`excluded.image_zones`,
        copyZones: sql`excluded.copy_zones`,
        headlineZones: sql`excluded.headline_zones`,
        advertiserZones: sql`excluded.advertiser_zones`,
        footerFurniture: sql`excluded.footer_furniture`,
        printRules: sql`excluded.print_rules`,
        digitalEnhancements: sql`excluded.digital_enhancements`,
        approvedByUserId: sql`excluded.approved_by_user_id`,
        approvedAt: sql`excluded.approved_at`,
        publishedAt: sql`excluded.published_at`,
        updatedAt: sql`now()`,
        deletedAt: sql`null`
      }
    });

    return fixtureIds;
  } finally {
    await client.end();
  }
}

async function main() {
  await seedDatabase();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
