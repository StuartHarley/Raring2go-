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
    rolesView: "00000000-0000-4000-8000-000000000403"
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
    }
  ]
} as const;
