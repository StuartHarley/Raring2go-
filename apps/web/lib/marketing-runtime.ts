import {
  listAudienceContacts,
  listEmailCampaigns,
  getPreferenceCentre,
  listJourneys,
  listNewsletterFactory,
  loadMarketingData
} from "@raring2go/marketing";
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
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.emailView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.newsletterFactoryView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.journeyView, "network"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.audienceView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.segmentView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.newsletterFactoryView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.journeyView, "own_territory")
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

export async function readEmailCampaignOverview(context: MarketingActorContext) {
  const { db, sql } = createDb();

  try {
    return listEmailCampaigns(context, marketingPermissionData, await loadMarketingData(db));
  } finally {
    await sql.end();
  }
}

export async function readNewsletterFactoryOverview(context: MarketingActorContext) {
  const { db, sql } = createDb();

  try {
    return listNewsletterFactory(context, marketingPermissionData, await loadMarketingData(db));
  } finally {
    await sql.end();
  }
}

export async function readJourneyOverview(context: MarketingActorContext) {
  const { db, sql } = createDb();

  try {
    return listJourneys(context, marketingPermissionData, await loadMarketingData(db));
  } finally {
    await sql.end();
  }
}

export async function readPreferenceCentre(context: MarketingActorContext, contactId = fixtureIds.audienceContacts.parentOne) {
  const { db, sql } = createDb();

  try {
    return getPreferenceCentre(context, marketingPermissionData, await loadMarketingData(db), contactId);
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
