import { listAudienceContacts, loadMarketingData } from "@raring2go/marketing";
import { createDb, fixtureIds, foundationSeed } from "@raring2go/db";
import type { MarketingActorContext } from "@raring2go/marketing";
import type { PermissionData } from "@raring2go/permissions";

export const marketingPermissionData: PermissionData = {
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
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.audienceView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.segmentView, "network"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.audienceView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.segmentView, "own_territory")
  ],
  territories: foundationSeed.territories.map((territory) => ({
    id: territory.id,
    franchiseOrganisationId: territory.franchiseOrganisationId
  }))
};

export async function readAudienceOverview(context: MarketingActorContext) {
  const { db, sql } = createDb();

  try {
    return listAudienceContacts(context, marketingPermissionData, await loadMarketingData(db));
  } finally {
    await sql.end();
  }
}

function grant(roleId: string, permissionId: string, scope: string) {
  const permission = foundationSeed.permissions.find((candidate) => candidate.id === permissionId);
  if (!permission) {
    throw new Error("Fixture permission seed is inconsistent.");
  }
  return {
    roleId,
    permission,
    scope,
    constraints: {}
  };
}
