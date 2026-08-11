import {
  getAdvertiser360,
  listCatalogue,
  listAdvertisers,
  listPipeline,
  loadAdvertisingData
} from "@raring2go/advertising";
import { createDb, fixtureIds, foundationSeed } from "@raring2go/db";
import type { AdvertisingActorContext } from "@raring2go/advertising";
import type { PermissionData } from "@raring2go/permissions";

export const advertisingPermissionData: PermissionData = {
  roleAssignments: [
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
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.advertiserView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.opportunityView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.catalogueView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.proposalView, "network"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.advertiserView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.opportunityView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.catalogueView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.proposalView, "own_territory")
  ],
  territories: foundationSeed.territories.map((territory) => ({
    id: territory.id,
    franchiseOrganisationId: territory.franchiseOrganisationId
  }))
};

export async function listAdvertiser360Rows(context: AdvertisingActorContext) {
  const { db, sql } = createDb();

  try {
    return listAdvertisers(context, advertisingPermissionData, await loadAdvertisingData(db));
  } finally {
    await sql.end();
  }
}

export async function readPipeline(context: AdvertisingActorContext) {
  const { db, sql } = createDb();

  try {
    return listPipeline(context, advertisingPermissionData, await loadAdvertisingData(db));
  } finally {
    await sql.end();
  }
}

export async function readCatalogue(context: AdvertisingActorContext) {
  const { db, sql } = createDb();

  try {
    return listCatalogue(context, advertisingPermissionData, await loadAdvertisingData(db));
  } finally {
    await sql.end();
  }
}

export async function readAdvertiser360(context: AdvertisingActorContext, advertiserId: string) {
  const { db, sql } = createDb();

  try {
    return getAdvertiser360(context, advertisingPermissionData, await loadAdvertisingData(db), advertiserId);
  } finally {
    await sql.end();
  }
}

function grant(roleId: string, permissionId: string, scope: string) {
  const permission = foundationSeed.permissions.find((candidate) => candidate.id === permissionId);

  if (!permission) {
    throw new Error("Advertising permission fixture is inconsistent.");
  }

  return {
    roleId,
    permission,
    scope,
    constraints: {}
  };
}
