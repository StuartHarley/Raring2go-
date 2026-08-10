import { auditActions } from "@raring2go/audit";
import { describe, expect, it } from "vitest";
import {
  assertNoDuplicatedIdentityData,
  createFranchise,
  getFranchise360,
  listActiveFranchises,
  updateFranchise
} from "./service";
import type { FranchiseData, FranchiseRecord } from "./types";
import type { PermissionData } from "@raring2go/permissions";

const ids = {
  users: {
    hq: "user_hq",
    owner: "user_owner"
  },
  organisations: {
    hq: "org_hq",
    franchise: "org_franchise",
    other: "org_other"
  },
  territories: {
    own: "territory_own",
    other: "territory_other"
  },
  roles: {
    hq: "role_hq",
    local: "role_local",
    readonly: "role_readonly"
  },
  permissions: {
    view: "permission_franchise_view",
    create: "permission_franchise_create",
    edit: "permission_franchise_edit"
  },
  franchises: {
    own: "franchise_own",
    other: "franchise_other",
    archived: "franchise_archived"
  }
};

const permissionData: PermissionData = {
  roleAssignments: [
    {
      id: "assignment_hq",
      userId: ids.users.hq,
      roleId: ids.roles.hq,
      organisationId: ids.organisations.hq
    },
    {
      id: "assignment_local",
      userId: ids.users.owner,
      roleId: ids.roles.local,
      organisationId: ids.organisations.franchise,
      territoryId: ids.territories.own
    }
  ],
  rolePermissions: [
    {
      roleId: ids.roles.hq,
      permission: {
        id: ids.permissions.view,
        module: "franchise",
        action: "view"
      },
      scope: "network"
    },
    {
      roleId: ids.roles.hq,
      permission: {
        id: ids.permissions.create,
        module: "franchise",
        action: "create"
      },
      scope: "network"
    },
    {
      roleId: ids.roles.hq,
      permission: {
        id: ids.permissions.edit,
        module: "franchise",
        action: "edit"
      },
      scope: "network"
    },
    {
      roleId: ids.roles.local,
      permission: {
        id: ids.permissions.view,
        module: "franchise",
        action: "view"
      },
      scope: "own_territory"
    }
  ],
  territories: [
    {
      id: ids.territories.own,
      franchiseOrganisationId: ids.organisations.franchise
    },
    {
      id: ids.territories.other,
      franchiseOrganisationId: ids.organisations.other
    }
  ]
};

function data(): FranchiseData {
  return {
    franchises: [
      franchise({
        id: ids.franchises.own,
        franchiseOrganisationId: ids.organisations.franchise,
        primaryTerritoryId: ids.territories.own
      }),
      franchise({
        id: ids.franchises.other,
        franchiseOrganisationId: ids.organisations.other,
        primaryTerritoryId: ids.territories.other
      }),
      franchise({
        id: ids.franchises.archived,
        franchiseOrganisationId: ids.organisations.franchise,
        primaryTerritoryId: ids.territories.own,
        status: "archived",
        deletedAt: new Date("2026-08-10T00:00:00.000Z")
      })
    ],
    contacts: [
      {
        id: "contact_owner",
        franchiseId: ids.franchises.own,
        userId: ids.users.owner,
        label: "Owner",
        isPrimary: true
      },
      {
        id: "contact_external",
        franchiseId: ids.franchises.own,
        label: "Bookkeeper",
        name: "External Contact",
        email: "bookkeeper@example.com",
        isPrimary: false
      }
    ],
    organisations: [
      {
        id: ids.organisations.hq,
        kind: "hq",
        name: "HQ"
      },
      {
        id: ids.organisations.franchise,
        kind: "franchise",
        name: "Raring2go Sutton Coldfield"
      },
      {
        id: ids.organisations.other,
        kind: "franchise",
        name: "Raring2go Elsewhere"
      }
    ],
    territories: [
      {
        id: ids.territories.own,
        franchiseOrganisationId: ids.organisations.franchise,
        code: "SUT",
        name: "Sutton Coldfield",
        status: "active"
      },
      {
        id: ids.territories.other,
        franchiseOrganisationId: ids.organisations.other,
        code: "OTH",
        name: "Elsewhere",
        status: "active"
      }
    ],
    users: [
      {
        id: ids.users.hq,
        email: "hq@example.com",
        displayName: "HQ"
      },
      {
        id: ids.users.owner,
        email: "owner@example.com",
        displayName: "Owner"
      }
    ],
    activity: [
      {
        id: "event_1",
        action: auditActions.franchiseUpdate,
        entityType: "franchise",
        entityId: ids.franchises.own,
        createdAt: new Date("2026-08-10T00:00:00.000Z")
      }
    ]
  };
}

describe("franchise service", () => {
  it("returns deterministic relationship data without duplicated identities", () => {
    const view = getFranchise360(
      {
        userId: ids.users.hq,
        organisationId: ids.organisations.hq
      },
      permissionData,
      data(),
      ids.franchises.own
    );

    expect(view.franchise.franchiseOrganisationId).toBe(ids.organisations.franchise);
    expect(view.franchise.primaryTerritoryId).toBe(ids.territories.own);
    expect(view.owner?.id).toBe(ids.users.owner);
    expect(assertNoDuplicatedIdentityData(view.franchise)).toBe(true);
  });

  it("allows authorised network view and excludes archived records", () => {
    expect(
      listActiveFranchises(
        {
          userId: ids.users.hq,
          organisationId: ids.organisations.hq
        },
        permissionData,
        data()
      ).map((franchiseRecord) => franchiseRecord.id)
    ).toEqual([ids.franchises.own, ids.franchises.other]);
  });

  it("allows authorised own-territory view", () => {
    expect(
      getFranchise360(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        data(),
        ids.franchises.own
      ).territory.name
    ).toBe("Sutton Coldfield");
  });

  it("denies cross-territory URL access", () => {
    expect(() =>
      getFranchise360(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        data(),
        ids.franchises.other
      )
    ).toThrow("outside the active territory");
  });

  it("denies create and edit without capability", async () => {
    await expect(
      createFranchise(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        audit(),
        data(),
        franchise({
          id: "franchise_new",
          franchiseOrganisationId: ids.organisations.franchise,
          primaryTerritoryId: ids.territories.own
        })
      )
    ).rejects.toThrow("No permission grant");

    await expect(
      updateFranchise(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        audit(),
        data(),
        {
          franchiseId: ids.franchises.own,
          patch: {
            supportStatus: "enhanced"
          }
        }
      )
    ).rejects.toThrow("No permission grant");
  });

  it("writes audit events for mutations", async () => {
    const franchiseData = data();
    const recorder = audit();

    await createFranchise(
      {
        userId: ids.users.hq,
        organisationId: ids.organisations.hq
      },
      permissionData,
      recorder,
      franchiseData,
      franchise({
        id: "franchise_new",
        franchiseOrganisationId: ids.organisations.franchise,
        primaryTerritoryId: ids.territories.own
      })
    );

    await updateFranchise(
      {
        userId: ids.users.hq,
        organisationId: ids.organisations.hq
      },
      permissionData,
      recorder,
      franchiseData,
      {
        franchiseId: ids.franchises.own,
        patch: {
          supportStatus: "enhanced"
        }
      }
    );

    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.franchiseCreate,
      auditActions.franchiseUpdate
    ]);
  });

  it("renders deferred tabs without future domain tables", () => {
    expect(
      getFranchise360(
        {
          userId: ids.users.hq,
          organisationId: ids.organisations.hq
        },
        permissionData,
        data(),
        ids.franchises.own
      ).placeholders
    ).toEqual({
      performance: "deferred",
      agreement: "deferred",
      compliance: "deferred",
      training: "deferred",
      support: "deferred",
      documents: "deferred"
    });
  });
});

function franchise(input: Partial<FranchiseRecord>): FranchiseRecord {
  return {
    id: "franchise",
    franchiseOrganisationId: ids.organisations.franchise,
    primaryTerritoryId: ids.territories.own,
    primaryOwnerUserId: ids.users.owner,
    status: "active",
    lifecycleStage: "trading",
    launchDate: "2024-09-01",
    renewalDate: "2027-09-01",
    onboardingStatus: "complete",
    supportStatus: "standard",
    tags: [],
    ...input
  };
}

function audit() {
  return {
    events: [] as Array<{ action: string }>,
    async record(event: { action: string }) {
      this.events.push(event);
    }
  };
}
