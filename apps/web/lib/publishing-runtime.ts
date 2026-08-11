import { createDb, fixtureIds, foundationSeed } from "@raring2go/db";
import {
  listEditionControlRoom,
  loadPublishingData
} from "@raring2go/publishing";
import type {
  EditionControlRoomRow,
  PublishingActorContext,
  PublishingData
} from "@raring2go/publishing";
import type { PermissionData } from "@raring2go/permissions";

export const publishingPermissionData: PermissionData = {
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
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.editionView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.editionPageEdit, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.editionPreflightOverride, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.editionGeneratePrint, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.editionGenerateDigital, "network"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.editionView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.editionPageEdit, "own_territory")
  ],
  territories: foundationSeed.territories.map((territory) => ({
    id: territory.id,
    franchiseOrganisationId: territory.franchiseOrganisationId
  }))
};

export async function listEditionFactoryRows(
  context: PublishingActorContext
): Promise<EditionControlRoomRow[]> {
  const data = await readPublishingData();
  return listEditionControlRoom(context, publishingPermissionData, data);
}

export async function readTerritoryEdition(
  context: PublishingActorContext,
  territoryEditionId: string
) {
  const data = await readPublishingData();
  const rows = listEditionControlRoom(context, publishingPermissionData, data);
  const row = rows.find((candidate) => candidate.territoryEdition.id === territoryEditionId);

  if (!row) {
    throw new Error("Edition was not found or is outside the active context.");
  }

  return {
    row,
    pages: data.editionPages
      .filter((page) => page.territoryEditionId === territoryEditionId && !page.deletedAt)
      .sort((left, right) => left.pageNumber - right.pageNumber),
    content: data.territoryEditionContent.filter(
      (content) => content.territoryEditionId === territoryEditionId && !content.deletedAt
    ),
    outputs: data.publicationOutputs.filter(
      (output) => output.territoryEditionId === territoryEditionId && !output.deletedAt
    )
  };
}

async function readPublishingData(): Promise<PublishingData> {
  const { db, sql } = createDb();

  try {
    return await loadPublishingData(db);
  } finally {
    await sql.end();
  }
}

function grant(roleId: string, permissionId: string, scope: string) {
  const permission = foundationSeed.permissions.find((candidate) => candidate.id === permissionId);

  if (!permission) {
    throw new Error("Publishing permission fixture is inconsistent.");
  }

  return {
    roleId,
    permission,
    scope,
    constraints: {}
  };
}
