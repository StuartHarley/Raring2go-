import {
  createFranchise,
  getFranchise360,
  listActiveFranchises,
  updateFranchise
} from "@raring2go/franchise";
import { evaluatePermission } from "@raring2go/permissions";
import { appAuditRecorder } from "./auth-runtime";
import { fixtureIds, foundationSeed } from "@raring2go/db";
import type {
  Franchise360,
  FranchiseActorContext,
  FranchiseData,
  FranchiseRecord
} from "@raring2go/franchise";
import type { PermissionData } from "@raring2go/permissions";

const franchiseData: FranchiseData = {
  franchises: foundationSeed.franchises.map((franchise) => ({
    ...franchise,
    status: franchise.status as FranchiseRecord["status"],
    lifecycleStage: franchise.lifecycleStage as FranchiseRecord["lifecycleStage"],
    tags: [...franchise.tags]
  })),
  contacts: [...foundationSeed.franchiseContacts],
  organisations: [...foundationSeed.organisations],
  territories: foundationSeed.territories.map((territory) => ({
    ...territory,
    status:
      "status" in territory && typeof territory.status === "string"
        ? territory.status
        : "active"
  })),
  users: [...foundationSeed.users],
  activity: []
};

export const franchisePermissionData: PermissionData = {
  roleAssignments: [
    {
      id: "fixture_assignment_superadmin",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.superAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_hq",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.hqAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_franchisee",
      userId: fixtureIds.users.franchisee,
      roleId: fixtureIds.roles.franchisee,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield
    }
  ],
  rolePermissions: [
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.franchiseView,
      scope: "network"
    },
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.franchiseCreate,
      scope: "network"
    },
    {
      roleId: fixtureIds.roles.hqAdmin,
      permissionId: fixtureIds.permissions.franchiseEdit,
      scope: "network"
    },
    {
      roleId: fixtureIds.roles.franchisee,
      permissionId: fixtureIds.permissions.franchiseView,
      scope: "own_territory"
    }
  ].map((grant) => {
    const permission = foundationSeed.permissions.find(
      (candidate) => candidate.id === grant.permissionId
    );

    if (!permission) {
      throw new Error("Franchise permission fixture is inconsistent.");
    }

    return {
      roleId: grant.roleId,
      permission,
      scope: grant.scope,
      constraints: {}
    };
  }),
  territories: foundationSeed.territories.map((territory) => ({
    id: territory.id,
    franchiseOrganisationId: territory.franchiseOrganisationId
  }))
};

export function listFranchiseSummaries(context: FranchiseActorContext) {
  return listActiveFranchises(context, franchisePermissionData, franchiseData);
}

export function readFranchise360(
  context: FranchiseActorContext,
  franchiseId: string
): Franchise360 {
  const view = getFranchise360(
    context,
    franchisePermissionData,
    franchiseData,
    franchiseId
  );

  return {
    ...view,
    activity: appAuditRecorder.events
      .filter(
        (event) => event.entity.type === "franchise" && event.entity.id === franchiseId
      )
      .map((event, index) => ({
        id: `runtime_audit_${index}`,
        action: event.action,
        actorUserId: event.actor.type === "human" ? event.actor.userId : null,
        entityType: event.entity.type,
        entityId: event.entity.id,
        createdAt: new Date()
      }))
  };
}

export function canEditFranchise(context: FranchiseActorContext) {
  return evaluatePermission(
    {
      userId: context.userId,
      module: "franchise",
      action: "edit",
      context
    },
    franchisePermissionData
  ).allowed;
}

export async function createFranchiseFromInput(
  context: FranchiseActorContext,
  input: FranchiseRecord
) {
  return createFranchise(
    context,
    franchisePermissionData,
    appAuditRecorder,
    franchiseData,
    input
  );
}

export async function updateFranchiseFromInput(
  context: FranchiseActorContext,
  franchiseId: string,
  patch: Parameters<typeof updateFranchise>[4]["patch"]
) {
  return updateFranchise(
    context,
    franchisePermissionData,
    appAuditRecorder,
    franchiseData,
    {
      franchiseId,
      patch
    }
  );
}
