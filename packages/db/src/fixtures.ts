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
    agreementDownloadExecuted: "00000000-0000-4000-8000-000000000417"
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
  ]
} as const;
