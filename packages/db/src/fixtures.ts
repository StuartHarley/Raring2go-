export const fixtureIds = {
  organisations: {
    hq: "00000000-0000-4000-8000-000000000001",
    franchise: "00000000-0000-4000-8000-000000000002",
    advertiser: "00000000-0000-4000-8000-000000000003"
  },
  territories: {
    suttonColdfield: "00000000-0000-4000-8000-000000000101",
    solihull: "00000000-0000-4000-8000-000000000102"
  },
  users: {
    superAdmin: "00000000-0000-4000-8000-000000000201",
    franchisee: "00000000-0000-4000-8000-000000000202"
  },
  roles: {
    superAdmin: "00000000-0000-4000-8000-000000000301",
    hqAdmin: "00000000-0000-4000-8000-000000000302",
    franchisee: "00000000-0000-4000-8000-000000000303"
  },
  permissions: {
    systemAdminister: "00000000-0000-4000-8000-000000000401",
    territoryView: "00000000-0000-4000-8000-000000000402",
    rolesView: "00000000-0000-4000-8000-000000000403",
    franchiseView: "00000000-0000-4000-8000-000000000404",
    franchiseCreate: "00000000-0000-4000-8000-000000000405",
    franchiseEdit: "00000000-0000-4000-8000-000000000406",
    agreementView: "00000000-0000-4000-8000-000000000407",
    agreementGenerate: "00000000-0000-4000-8000-000000000408",
    agreementSubmitApproval: "00000000-0000-4000-8000-000000000409",
    agreementApprove: "00000000-0000-4000-8000-000000000410",
    agreementVoid: "00000000-0000-4000-8000-000000000411",
    agreementSendSignature: "00000000-0000-4000-8000-000000000412",
    agreementCancelSignature: "00000000-0000-4000-8000-000000000413",
    agreementResendSignature: "00000000-0000-4000-8000-000000000414",
    agreementViewSignatureStatus: "00000000-0000-4000-8000-000000000415",
    agreementRecordSignatureEvent: "00000000-0000-4000-8000-000000000416",
    agreementDownloadExecuted: "00000000-0000-4000-8000-000000000417",
    documentView: "00000000-0000-4000-8000-000000000418",
    documentUpload: "00000000-0000-4000-8000-000000000419",
    documentDownload: "00000000-0000-4000-8000-000000000420",
    documentArchive: "00000000-0000-4000-8000-000000000421",
    complianceView: "00000000-0000-4000-8000-000000000422",
    complianceManageRequirements: "00000000-0000-4000-8000-000000000423",
    complianceSubmitEvidence: "00000000-0000-4000-8000-000000000424",
    complianceVerify: "00000000-0000-4000-8000-000000000425",
    complianceManageActions: "00000000-0000-4000-8000-000000000426",
    complianceViewNetwork: "00000000-0000-4000-8000-000000000427",
    onboardingView: "00000000-0000-4000-8000-000000000428",
    onboardingManage: "00000000-0000-4000-8000-000000000429",
    onboardingTemplateManage: "00000000-0000-4000-8000-000000000430",
    onboardingTaskComplete: "00000000-0000-4000-8000-000000000431",
    onboardingTaskAssign: "00000000-0000-4000-8000-000000000432",
    onboardingApproveMilestone: "00000000-0000-4000-8000-000000000433",
    onboardingApproveLaunch: "00000000-0000-4000-8000-000000000434",
    editionView: "00000000-0000-4000-8000-000000000435",
    editionCreate: "00000000-0000-4000-8000-000000000436",
    editionEdit: "00000000-0000-4000-8000-000000000437",
    editionApprove: "00000000-0000-4000-8000-000000000438",
    editionRelease: "00000000-0000-4000-8000-000000000439",
    editionTemplateCreate: "00000000-0000-4000-8000-000000000440",
    editionTemplateEdit: "00000000-0000-4000-8000-000000000441",
    editionTemplateApprove: "00000000-0000-4000-8000-000000000442",
    editionTemplatePublish: "00000000-0000-4000-8000-000000000443",
    editionPageEdit: "00000000-0000-4000-8000-000000000444",
    editionLocalContentEdit: "00000000-0000-4000-8000-000000000445",
    editionLockedContentManage: "00000000-0000-4000-8000-000000000446",
    editionPreflightOverride: "00000000-0000-4000-8000-000000000447",
    editionGeneratePrint: "00000000-0000-4000-8000-000000000448",
    editionGenerateDigital: "00000000-0000-4000-8000-000000000449"
  },
  franchises: {
    suttonColdfield: "00000000-0000-4000-8000-000000000901"
  },
  franchiseContacts: {
    suttonOwner: "00000000-0000-4000-8000-000000000911"
  },
  agreementTemplates: {
    standardFranchise: "00000000-0000-4000-8000-000000000921"
  },
  agreementVersions: {
    standardFranchiseV1: "00000000-0000-4000-8000-000000000922",
    standardFranchiseV2: "00000000-0000-4000-8000-000000000923"
  },
  franchiseAgreements: {
    suttonDraft: "00000000-0000-4000-8000-000000000924"
  },
  franchiseDocuments: {
    suttonWelcomePack: "00000000-0000-4000-8000-000000000931",
    suttonInsurance: "00000000-0000-4000-8000-000000000934"
  },
  franchiseDocumentVersions: {
    suttonWelcomePackV1: "00000000-0000-4000-8000-000000000932",
    suttonInsuranceV1: "00000000-0000-4000-8000-000000000935"
  },
  franchiseArtifacts: {
    suttonWelcomePack: "00000000-0000-4000-8000-000000000933",
    suttonInsurance: "00000000-0000-4000-8000-000000000936"
  },
  insurancePolicies: {
    suttonPublicLiability: "00000000-0000-4000-8000-000000000937"
  },
  complianceRequirements: {
    publicLiabilityInsurance: "00000000-0000-4000-8000-000000000938"
  },
  complianceRecords: {
    suttonPublicLiabilityInsurance: "00000000-0000-4000-8000-000000000939"
  },
  onboardingTemplates: {
    starter: "00000000-0000-4000-8000-000000000940"
  },
  onboardingTemplatePhases: {
    setup: "00000000-0000-4000-8000-000000000941",
    systems: "00000000-0000-4000-8000-000000000942",
    training: "00000000-0000-4000-8000-000000000943",
    commercial: "00000000-0000-4000-8000-000000000944",
    editorial: "00000000-0000-4000-8000-000000000945",
    audience: "00000000-0000-4000-8000-000000000946",
    readiness: "00000000-0000-4000-8000-000000000947"
  },
  onboardingTemplateTasks: {
    agreementExecuted: "00000000-0000-4000-8000-000000000948",
    complianceComplete: "00000000-0000-4000-8000-000000000949",
    accessReady: "00000000-0000-4000-8000-000000000950",
    trainingComplete: "00000000-0000-4000-8000-000000000951",
    mediaPackReady: "00000000-0000-4000-8000-000000000952",
    editionSelected: "00000000-0000-4000-8000-000000000953",
    launchApproved: "00000000-0000-4000-8000-000000000954"
  },
  seasons: {
    autumn2026: "00000000-0000-4000-8000-000000001001"
  },
  masterEditions: {
    autumn2026: "00000000-0000-4000-8000-000000001002"
  },
  territoryEditions: {
    suttonAutumn2026: "00000000-0000-4000-8000-000000001003"
  },
  magazineTemplates: {
    autumnCover: "00000000-0000-4000-8000-000000001004"
  },
  magazineTemplateVersions: {
    autumnCoverV1: "00000000-0000-4000-8000-000000001005"
  },
  invitations: {
    franchiseStaff: "00000000-0000-4000-8000-000000000801"
  }
} as const;

export const foundationSeed = {
  organisations: [
    { id: fixtureIds.organisations.hq, kind: "hq", name: "Raring2go Head Office" },
    {
      id: fixtureIds.organisations.franchise,
      kind: "franchise",
      name: "Raring2go Sutton Coldfield"
    },
    {
      id: fixtureIds.organisations.advertiser,
      kind: "advertiser",
      name: "Example Advertiser"
    }
  ],
  territories: [
    {
      id: fixtureIds.territories.suttonColdfield,
      franchiseOrganisationId: fixtureIds.organisations.franchise,
      code: "SUT",
      name: "Sutton Coldfield"
    },
    {
      id: fixtureIds.territories.solihull,
      franchiseOrganisationId: null,
      code: "SOL",
      name: "Solihull"
    }
  ],
  users: [
    {
      id: fixtureIds.users.superAdmin,
      email: "superadmin@example.raring2go.test",
      displayName: "Super Admin Fixture"
    },
    {
      id: fixtureIds.users.franchisee,
      email: "franchisee@example.raring2go.test",
      displayName: "Franchisee Fixture"
    }
  ],
  roles: [
    {
      id: fixtureIds.roles.superAdmin,
      key: "super_admin",
      name: "Super Admin",
      description: "System-level administration for fixture verification.",
      isSystem: true
    },
    {
      id: fixtureIds.roles.hqAdmin,
      key: "hq_admin",
      name: "HQ Admin",
      description: "Network-level administration fixture role.",
      isSystem: true
    },
    {
      id: fixtureIds.roles.franchisee,
      key: "franchisee",
      name: "Franchisee",
      description: "Own-territory franchise fixture role.",
      isSystem: true
    }
  ],
  permissions: [
    {
      id: fixtureIds.permissions.systemAdminister,
      module: "system",
      action: "administer",
      description: "Administer system settings."
    },
    {
      id: fixtureIds.permissions.territoryView,
      module: "territory",
      action: "view",
      description: "View territory-scoped records."
    },
    {
      id: fixtureIds.permissions.rolesView,
      module: "roles",
      action: "view",
      description: "View roles and permission assignments."
    },
    {
      id: fixtureIds.permissions.franchiseView,
      module: "franchise",
      action: "view",
      description: "View franchise operating records."
    },
    {
      id: fixtureIds.permissions.franchiseCreate,
      module: "franchise",
      action: "create",
      description: "Create franchise operating records."
    },
    {
      id: fixtureIds.permissions.franchiseEdit,
      module: "franchise",
      action: "edit",
      description: "Edit franchise operating records."
    },
    {
      id: fixtureIds.permissions.agreementView,
      module: "franchise.agreement",
      action: "view",
      description: "View franchise agreement records."
    },
    {
      id: fixtureIds.permissions.agreementGenerate,
      module: "franchise.agreement",
      action: "generate",
      description: "Generate franchise agreement records."
    },
    {
      id: fixtureIds.permissions.agreementSubmitApproval,
      module: "franchise.agreement",
      action: "submit_approval",
      description: "Submit franchise agreements for internal approval."
    },
    {
      id: fixtureIds.permissions.agreementApprove,
      module: "franchise.agreement",
      action: "approve",
      description: "Approve franchise agreements internally."
    },
    {
      id: fixtureIds.permissions.agreementVoid,
      module: "franchise.agreement",
      action: "void",
      description: "Void franchise agreements."
    },
    {
      id: fixtureIds.permissions.agreementSendSignature,
      module: "franchise.agreement",
      action: "send_signature",
      description: "Send approved franchise agreements for signature."
    },
    {
      id: fixtureIds.permissions.agreementCancelSignature,
      module: "franchise.agreement",
      action: "cancel_signature",
      description: "Cancel franchise agreement signature requests."
    },
    {
      id: fixtureIds.permissions.agreementResendSignature,
      module: "franchise.agreement",
      action: "resend_signature",
      description: "Resend franchise agreement signature requests."
    },
    {
      id: fixtureIds.permissions.agreementViewSignatureStatus,
      module: "franchise.agreement",
      action: "view_signature_status",
      description: "View franchise agreement signing status."
    },
    {
      id: fixtureIds.permissions.agreementRecordSignatureEvent,
      module: "franchise.agreement",
      action: "record_signature_event",
      description: "Record provider-neutral franchise agreement signature events."
    },
    {
      id: fixtureIds.permissions.agreementDownloadExecuted,
      module: "franchise.agreement",
      action: "download_executed",
      description: "Download executed franchise agreement artefact references."
    },
    {
      id: fixtureIds.permissions.documentView,
      module: "franchise.document",
      action: "view",
      description: "View franchise documents."
    },
    {
      id: fixtureIds.permissions.documentUpload,
      module: "franchise.document",
      action: "upload",
      description: "Upload franchise documents and versions."
    },
    {
      id: fixtureIds.permissions.documentDownload,
      module: "franchise.document",
      action: "download",
      description: "Download franchise documents."
    },
    {
      id: fixtureIds.permissions.documentArchive,
      module: "franchise.document",
      action: "archive",
      description: "Archive franchise documents."
    },
    {
      id: fixtureIds.permissions.complianceView,
      module: "franchise.compliance",
      action: "view",
      description: "View insurance and compliance status."
    },
    {
      id: fixtureIds.permissions.complianceManageRequirements,
      module: "franchise.compliance",
      action: "manage_requirements",
      description: "Manage configurable compliance requirements."
    },
    {
      id: fixtureIds.permissions.complianceSubmitEvidence,
      module: "franchise.compliance",
      action: "submit_evidence",
      description: "Submit insurance and compliance evidence."
    },
    {
      id: fixtureIds.permissions.complianceVerify,
      module: "franchise.compliance",
      action: "verify",
      description: "Verify or reject insurance and compliance evidence."
    },
    {
      id: fixtureIds.permissions.complianceManageActions,
      module: "franchise.compliance",
      action: "manage_actions",
      description: "Create and resolve compliance actions and reminders."
    },
    {
      id: fixtureIds.permissions.complianceViewNetwork,
      module: "franchise.compliance",
      action: "view_network",
      description: "View network compliance overview."
    },
    {
      id: fixtureIds.permissions.onboardingView,
      module: "franchise.onboarding",
      action: "view",
      description: "View onboarding launch plans."
    },
    {
      id: fixtureIds.permissions.onboardingManage,
      module: "franchise.onboarding",
      action: "manage",
      description: "Create and manage onboarding programmes."
    },
    {
      id: fixtureIds.permissions.onboardingTemplateManage,
      module: "franchise.onboarding",
      action: "template_manage",
      description: "Manage onboarding templates."
    },
    {
      id: fixtureIds.permissions.onboardingTaskComplete,
      module: "franchise.onboarding",
      action: "task_complete",
      description: "Complete onboarding tasks."
    },
    {
      id: fixtureIds.permissions.onboardingTaskAssign,
      module: "franchise.onboarding",
      action: "task_assign",
      description: "Assign onboarding task ownership."
    },
    {
      id: fixtureIds.permissions.onboardingApproveMilestone,
      module: "franchise.onboarding",
      action: "approve_milestone",
      description: "Approve onboarding milestones."
    },
    {
      id: fixtureIds.permissions.onboardingApproveLaunch,
      module: "franchise.onboarding",
      action: "approve_launch",
      description: "Approve franchise launch."
    },
    {
      id: fixtureIds.permissions.editionView,
      module: "edition",
      action: "view",
      description: "View edition records."
    },
    {
      id: fixtureIds.permissions.editionCreate,
      module: "edition",
      action: "create",
      description: "Create master and territory edition records."
    },
    {
      id: fixtureIds.permissions.editionEdit,
      module: "edition",
      action: "edit",
      description: "Edit edition schedules, status and readiness."
    },
    {
      id: fixtureIds.permissions.editionApprove,
      module: "edition",
      action: "approve",
      description: "Approve editions for production."
    },
    {
      id: fixtureIds.permissions.editionRelease,
      module: "edition",
      action: "release",
      description: "Release or publish approved editions."
    },
    {
      id: fixtureIds.permissions.editionTemplateCreate,
      module: "edition.template",
      action: "create",
      description: "Create magazine templates."
    },
    {
      id: fixtureIds.permissions.editionTemplateEdit,
      module: "edition.template",
      action: "edit",
      description: "Edit magazine template drafts."
    },
    {
      id: fixtureIds.permissions.editionTemplateApprove,
      module: "edition.template",
      action: "approve",
      description: "Approve magazine template versions."
    },
    {
      id: fixtureIds.permissions.editionTemplatePublish,
      module: "edition.template",
      action: "publish",
      description: "Publish approved magazine template versions."
    },
    {
      id: fixtureIds.permissions.editionPageEdit,
      module: "edition.page",
      action: "edit",
      description: "Edit edition pages and flatplan assignments."
    },
    {
      id: fixtureIds.permissions.editionLocalContentEdit,
      module: "edition.content",
      action: "edit_local",
      description: "Edit local edition content in permitted zones."
    },
    {
      id: fixtureIds.permissions.editionLockedContentManage,
      module: "edition.content",
      action: "manage_locked",
      description: "Manage HQ locked edition content."
    },
    {
      id: fixtureIds.permissions.editionPreflightOverride,
      module: "edition.preflight",
      action: "override",
      description: "Override preflight failures with authority."
    },
    {
      id: fixtureIds.permissions.editionGeneratePrint,
      module: "edition.output",
      action: "generate_print",
      description: "Generate print edition output."
    },
    {
      id: fixtureIds.permissions.editionGenerateDigital,
      module: "edition.output",
      action: "generate_digital",
      description: "Generate digital edition output."
    }
  ],
  franchises: [
    {
      id: fixtureIds.franchises.suttonColdfield,
      franchiseOrganisationId: fixtureIds.organisations.franchise,
      primaryTerritoryId: fixtureIds.territories.suttonColdfield,
      primaryOwnerUserId: fixtureIds.users.franchisee,
      status: "active",
      lifecycleStage: "trading",
      launchDate: "2024-09-01",
      renewalDate: "2027-09-01",
      onboardingStatus: "complete",
      supportStatus: "standard",
      tags: ["fixture", "midlands"]
    }
  ],
  franchiseContacts: [
    {
      id: fixtureIds.franchiseContacts.suttonOwner,
      franchiseId: fixtureIds.franchises.suttonColdfield,
      userId: fixtureIds.users.franchisee,
      label: "Owner",
      isPrimary: true
    }
  ],
  agreementTemplates: [
    {
      id: fixtureIds.agreementTemplates.standardFranchise,
      key: "standard-franchise-agreement",
      name: "Standard Franchise Agreement",
      status: "active"
    }
  ],
  agreementVersions: [
    {
      id: fixtureIds.agreementVersions.standardFranchiseV1,
      templateId: fixtureIds.agreementTemplates.standardFranchise,
      version: "1.0",
      status: "approved",
      controlledMergeFields: [
        "franchiseOrganisationName",
        "territoryName",
        "ownerName",
        "launchDate",
        "renewalDate"
      ],
      content: {
        title: "Raring2go Franchise Agreement",
        body: "Provider-neutral generated agreement content for FRN-002."
      },
      approvedByUserId: fixtureIds.users.superAdmin,
      approvedAt: "2026-08-10"
    },
    {
      id: fixtureIds.agreementVersions.standardFranchiseV2,
      templateId: fixtureIds.agreementTemplates.standardFranchise,
      version: "2.0",
      status: "approved",
      controlledMergeFields: [
        "franchiseOrganisationName",
        "territoryName",
        "ownerName",
        "launchDate",
        "renewalDate"
      ],
      content: {
        title: "Raring2go Franchise Agreement",
        body: "Revised provider-neutral agreement content for future drafts."
      },
      approvedByUserId: fixtureIds.users.superAdmin,
      approvedAt: "2026-08-10"
    }
  ],
  franchiseArtifactReferences: [
    {
      id: fixtureIds.franchiseArtifacts.suttonWelcomePack,
      franchiseId: fixtureIds.franchises.suttonColdfield,
      entityType: "franchise_document",
      entityId: fixtureIds.franchiseDocuments.suttonWelcomePack,
      category: "company_document",
      label: "Welcome pack PDF",
      storageKey: "seed/franchise-documents/sutton-welcome-pack.pdf",
      contentType: "application/pdf",
      checksum: "seed-checksum",
      providerMetadata: {}
    },
    {
      id: fixtureIds.franchiseArtifacts.suttonInsurance,
      franchiseId: fixtureIds.franchises.suttonColdfield,
      entityType: "franchise_document",
      entityId: fixtureIds.franchiseDocuments.suttonInsurance,
      category: "insurance_certificate",
      label: "Public liability insurance certificate",
      storageKey: "seed/franchise-documents/sutton-insurance.pdf",
      contentType: "application/pdf",
      checksum: "seed-insurance-checksum",
      providerMetadata: {}
    }
  ],
  franchiseDocuments: [
    {
      id: fixtureIds.franchiseDocuments.suttonWelcomePack,
      franchiseId: fixtureIds.franchises.suttonColdfield,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield,
      category: "company_document",
      documentType: "welcome_pack",
      title: "Sutton Coldfield Welcome Pack",
      description: "Seed document proving the franchise document vault.",
      status: "active",
      currentVersionId: fixtureIds.franchiseDocumentVersions.suttonWelcomePackV1,
      uploadedByUserId: fixtureIds.users.superAdmin
    },
    {
      id: fixtureIds.franchiseDocuments.suttonInsurance,
      franchiseId: fixtureIds.franchises.suttonColdfield,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield,
      category: "insurance_certificate",
      documentType: "public_liability",
      title: "Public Liability Insurance Certificate",
      description: "Seed evidence for FRN-005 insurance compliance.",
      status: "active",
      currentVersionId: fixtureIds.franchiseDocumentVersions.suttonInsuranceV1,
      expiryDate: "2026-09-21",
      uploadedByUserId: fixtureIds.users.franchisee
    }
  ],
  franchiseDocumentVersions: [
    {
      id: fixtureIds.franchiseDocumentVersions.suttonWelcomePackV1,
      documentId: fixtureIds.franchiseDocuments.suttonWelcomePack,
      versionNumber: 1,
      artifactReferenceId: fixtureIds.franchiseArtifacts.suttonWelcomePack,
      uploadedByUserId: fixtureIds.users.superAdmin,
      uploadedAt: "2026-08-10",
      notes: "Seed version."
    },
    {
      id: fixtureIds.franchiseDocumentVersions.suttonInsuranceV1,
      documentId: fixtureIds.franchiseDocuments.suttonInsurance,
      versionNumber: 1,
      artifactReferenceId: fixtureIds.franchiseArtifacts.suttonInsurance,
      uploadedByUserId: fixtureIds.users.franchisee,
      uploadedAt: "2026-08-10",
      notes: "Seed insurance evidence."
    }
  ],
  insurancePolicies: [
    {
      id: fixtureIds.insurancePolicies.suttonPublicLiability,
      franchiseId: fixtureIds.franchises.suttonColdfield,
      provider: "Seed Mutual",
      policyNumber: "R2G-SUT-PL-001",
      coverTypes: ["public_liability"],
      coverStartDate: "2025-09-22",
      coverEndDate: "2026-09-21",
      evidenceDocumentId: fixtureIds.franchiseDocuments.suttonInsurance,
      verificationStatus: "pending"
    }
  ],
  complianceRequirements: [
    {
      id: fixtureIds.complianceRequirements.publicLiabilityInsurance,
      key: "public-liability-insurance",
      name: "Public liability insurance",
      description: "Current public liability insurance evidence is required.",
      requiredDocumentCategory: "insurance_certificate",
      requiredDocumentType: "public_liability",
      expiryWarningDays: 60,
      active: true
    }
  ],
  complianceRecords: [
    {
      id: fixtureIds.complianceRecords.suttonPublicLiabilityInsurance,
      franchiseId: fixtureIds.franchises.suttonColdfield,
      requirementId: fixtureIds.complianceRequirements.publicLiabilityInsurance,
      evidenceDocumentId: fixtureIds.franchiseDocuments.suttonInsurance,
      status: "pending_review",
      expiresAt: "2026-09-21"
    }
  ],
  onboardingTemplates: [
    {
      id: fixtureIds.onboardingTemplates.starter,
      key: "raring2go-starter-launch",
      name: "Raring2go Starter Launch",
      status: "active",
      readinessRules: {
        gates: ["agreement_executed", "mandatory_compliance", "readiness_tasks"]
      }
    }
  ],
  onboardingTemplatePhases: [
    {
      id: fixtureIds.onboardingTemplatePhases.setup,
      templateId: fixtureIds.onboardingTemplates.starter,
      name: "Franchise setup",
      sortOrder: 1
    },
    {
      id: fixtureIds.onboardingTemplatePhases.systems,
      templateId: fixtureIds.onboardingTemplates.starter,
      name: "Systems & access",
      sortOrder: 2
    },
    {
      id: fixtureIds.onboardingTemplatePhases.training,
      templateId: fixtureIds.onboardingTemplates.starter,
      name: "Training",
      sortOrder: 3
    },
    {
      id: fixtureIds.onboardingTemplatePhases.commercial,
      templateId: fixtureIds.onboardingTemplates.starter,
      name: "Commercial launch",
      sortOrder: 4
    },
    {
      id: fixtureIds.onboardingTemplatePhases.editorial,
      templateId: fixtureIds.onboardingTemplates.starter,
      name: "Editorial & publishing setup",
      sortOrder: 5
    },
    {
      id: fixtureIds.onboardingTemplatePhases.audience,
      templateId: fixtureIds.onboardingTemplates.starter,
      name: "Audience & marketing",
      sortOrder: 6
    },
    {
      id: fixtureIds.onboardingTemplatePhases.readiness,
      templateId: fixtureIds.onboardingTemplates.starter,
      name: "Launch readiness",
      sortOrder: 7
    }
  ],
  onboardingTemplateTasks: [
    {
      id: fixtureIds.onboardingTemplateTasks.agreementExecuted,
      phaseId: fixtureIds.onboardingTemplatePhases.setup,
      title: "Agreement executed",
      ownerType: "hq",
      required: true,
      approvalRequired: false,
      dueRule: { type: "after_agreement_execution", days: 0 },
      dependencyRules: [{ type: "executed_agreement", title: "Agreement executed" }],
      readinessGate: true,
      sortOrder: 1
    },
    {
      id: fixtureIds.onboardingTemplateTasks.complianceComplete,
      phaseId: fixtureIds.onboardingTemplatePhases.setup,
      title: "Mandatory compliance complete",
      ownerType: "franchisee",
      required: true,
      approvalRequired: true,
      dueRule: { type: "after_agreement_execution", days: 14 },
      dependencyRules: [{ type: "compliance_requirement", key: "public-liability-insurance", title: "Public liability insurance" }],
      readinessGate: true,
      sortOrder: 2
    },
    {
      id: fixtureIds.onboardingTemplateTasks.accessReady,
      phaseId: fixtureIds.onboardingTemplatePhases.systems,
      title: "Systems and access ready",
      ownerType: "hq",
      required: true,
      approvalRequired: true,
      dueRule: { type: "before_target_launch", days: 45 },
      dependencyRules: [],
      readinessGate: true,
      sortOrder: 1
    },
    {
      id: fixtureIds.onboardingTemplateTasks.trainingComplete,
      phaseId: fixtureIds.onboardingTemplatePhases.training,
      title: "Critical training complete",
      ownerType: "franchisee",
      required: true,
      approvalRequired: true,
      dueRule: { type: "before_target_launch", days: 30 },
      dependencyRules: [],
      readinessGate: true,
      sortOrder: 1
    },
    {
      id: fixtureIds.onboardingTemplateTasks.mediaPackReady,
      phaseId: fixtureIds.onboardingTemplatePhases.commercial,
      title: "Media pack and first sales activity ready",
      ownerType: "hq",
      required: true,
      approvalRequired: true,
      dueRule: { type: "before_target_launch", days: 28 },
      dependencyRules: [],
      readinessGate: false,
      sortOrder: 1
    },
    {
      id: fixtureIds.onboardingTemplateTasks.editionSelected,
      phaseId: fixtureIds.onboardingTemplatePhases.editorial,
      title: "First magazine edition selected",
      ownerType: "hq",
      required: true,
      approvalRequired: true,
      dueRule: { type: "before_target_launch", days: 21 },
      dependencyRules: [],
      readinessGate: false,
      sortOrder: 1
    },
    {
      id: fixtureIds.onboardingTemplateTasks.launchApproved,
      phaseId: fixtureIds.onboardingTemplatePhases.readiness,
      title: "Final launch approval",
      ownerType: "hq",
      required: true,
      approvalRequired: true,
      dueRule: { type: "before_target_launch", days: 7 },
      dependencyRules: [
        { type: "task", id: fixtureIds.onboardingTemplateTasks.agreementExecuted, title: "Agreement executed" },
        { type: "task", id: fixtureIds.onboardingTemplateTasks.complianceComplete, title: "Compliance complete" },
        { type: "task", id: fixtureIds.onboardingTemplateTasks.trainingComplete, title: "Training complete" }
      ],
      readinessGate: true,
      sortOrder: 1
    }
  ],
  seasons: [
    {
      id: fixtureIds.seasons.autumn2026,
      key: "autumn-2026",
      name: "Autumn 2026",
      year: 2026,
      season: "autumn",
      status: "planned",
      accent: "autumn",
      publicationDate: "2026-09-01",
      bookingDeadline: "2026-07-24",
      artworkDeadline: "2026-08-07",
      editorialDeadline: "2026-08-12",
      proofDeadline: "2026-08-19",
      printDeadline: "2026-08-21",
      distributionDate: "2026-08-28"
    }
  ],
  masterEditions: [
    {
      id: fixtureIds.masterEditions.autumn2026,
      seasonId: fixtureIds.seasons.autumn2026,
      organisationId: fixtureIds.organisations.hq,
      title: "Autumn 2026 Master Edition",
      status: "draft",
      pageCount: 36,
      version: 1,
      readiness: "not_ready",
      publicationArchive: {},
      locked: false,
      createdByUserId: fixtureIds.users.superAdmin
    }
  ],
  territoryEditions: [
    {
      id: fixtureIds.territoryEditions.suttonAutumn2026,
      masterEditionId: fixtureIds.masterEditions.autumn2026,
      seasonId: fixtureIds.seasons.autumn2026,
      territoryId: fixtureIds.territories.suttonColdfield,
      franchiseOrganisationId: fixtureIds.organisations.franchise,
      editorUserId: fixtureIds.users.franchisee,
      title: "Autumn 2026 Sutton Coldfield",
      status: "draft",
      publicationDate: "2026-09-01",
      bookingDeadline: "2026-07-24",
      artworkDeadline: "2026-08-07",
      editorialDeadline: "2026-08-12",
      proofDeadline: "2026-08-19",
      printDeadline: "2026-08-21",
      distributionDate: "2026-08-28",
      pageCount: 36,
      printStatus: "not_started",
      digitalStatus: "not_started",
      readiness: "not_ready",
      version: 1,
      publicationArchive: {},
      generatedFromMasterVersion: 1
    }
  ],
  magazineTemplates: [
    {
      id: fixtureIds.magazineTemplates.autumnCover,
      key: "autumn-cover",
      name: "Autumn Front Cover",
      category: "front_cover",
      status: "approved",
      createdByUserId: fixtureIds.users.superAdmin
    }
  ],
  magazineTemplateVersions: [
    {
      id: fixtureIds.magazineTemplateVersions.autumnCoverV1,
      templateId: fixtureIds.magazineTemplates.autumnCover,
      version: 1,
      status: "published",
      pageDimensions: { width: 210, height: 297, unit: "mm" },
      bleed: { top: 3, right: 3, bottom: 3, left: 3, unit: "mm" },
      trim: { width: 210, height: 297, unit: "mm" },
      margins: { top: 12, right: 12, bottom: 14, left: 12, unit: "mm" },
      grid: { columns: 6, gutter: 4 },
      lockedElements: [
        { id: "masthead", type: "logo", rule: "do_not_distort_rotate_or_recolour" },
        { id: "season-badge", type: "seasonal_accent", token: "autumn" }
      ],
      editableZones: [
        { id: "local-cover-story", type: "headline", maxCharacters: 60 },
        { id: "local-highlights", type: "highlight_list", maxItems: 4 }
      ],
      imageZones: [
        { id: "hero-image", minDpi: 300, aspectRatio: "cover" }
      ],
      copyZones: [
        { id: "strapline", maxWords: 14 }
      ],
      headlineZones: [
        { id: "cover-headline", maxCharacters: 60 }
      ],
      advertiserZones: [
        { id: "sponsor-strip", formats: ["full_width"] }
      ],
      footerFurniture: { pageNumber: false, issueDate: true },
      printRules: { colourSpace: "cmyk", minDpi: 300, bleedRequired: true },
      digitalEnhancements: { links: true, altTextRequired: true },
      approvedByUserId: fixtureIds.users.superAdmin,
      approvedAt: "2026-08-11",
      publishedAt: "2026-08-11"
    }
  ]
} as const;
