import { randomUUID } from "node:crypto";
import {
  approveEmailCampaignVersion,
  approveNetworkNewsletterMaster,
  createEmailCampaign,
  createNetworkNewsletterMaster,
  createNewsletterEditionCampaign,
  createRecipientSnapshot,
  enqueueEmailSend,
  generateTerritoryNewsletterEditions,
  insertEmailCampaignGraph,
  insertEmailRecipientSnapshotRecord,
  insertEmailSendJobRecord,
  insertNetworkNewsletterMasterRecord,
  insertNewsletterFactoryRunRecord,
  listAudienceContacts,
  listEmailCampaigns,
  getPreferenceCentre,
  listJourneys,
  listMarketingAnalytics,
  listMarketingCommandCentre,
  listNewsletterFactory,
  listSegments,
  loadMarketingData,
  recordTerritoryNewsletterOverride,
  scheduleEmailCampaign,
  updateEmailCampaignRecord,
  updateEmailCampaignVersionRecord,
  updateNetworkNewsletterMasterRecord,
  upsertTerritoryNewsletterEditionRecord
} from "@raring2go/marketing";
import { recordAuditEvent } from "@raring2go/audit";
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
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.emailCreate, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.emailApprove, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.emailSchedule, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.emailSend, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.newsletterFactoryView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.newsletterFactoryManage, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.newsletterFactoryApprove, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.newsletterFactoryContribute, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.journeyView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.marketingAnalyticsView, "network"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.audienceView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.segmentView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailCreate, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailApprove, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailSchedule, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailSend, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.newsletterFactoryView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.newsletterFactoryContribute, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.journeyView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.marketingAnalyticsView, "own_territory")
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

export function listNetworkTerritories() {
  return foundationSeed.territories.map((territory) => ({ id: territory.id, name: territory.name }));
}

export async function readSegments(context: MarketingActorContext) {
  const { db, sql } = createDb();

  try {
    return listSegments(context, marketingPermissionData, await loadMarketingData(db));
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

export async function readMarketingAnalytics(context: MarketingActorContext) {
  const { db, sql } = createDb();

  try {
    return listMarketingAnalytics(context, marketingPermissionData, await loadMarketingData(db));
  } finally {
    await sql.end();
  }
}

export async function readMarketingCommandCentre(context: MarketingActorContext) {
  const { db, sql } = createDb();

  try {
    return listMarketingCommandCentre(context, marketingPermissionData, await loadMarketingData(db));
  } finally {
    await sql.end();
  }
}

export async function composeEmailCampaign(
  context: MarketingActorContext,
  input: {
    campaignId: string;
    versionId: string;
    segmentId: string;
    title: string;
    subject: string;
    preheader: string | null;
    body: string;
  }
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const segment = data.segments.find((candidate) => candidate.id === input.segmentId && !candidate.deletedAt);

      if (!segment) {
        throw new Error("Audience segment was not found.");
      }

      const campaign = {
        id: input.campaignId,
        territoryId: segment.territoryId ?? null,
        templateId: fixtureIds.emailTemplates.standardNewsletter,
        segmentId: input.segmentId,
        campaignType: "newsletter",
        status: "draft" as const,
        title: input.title,
        subject: input.subject,
        preheader: input.preheader,
        scheduledAt: null,
        approvedAt: null,
        sentAt: null,
        metadata: {}
      };
      const version = {
        id: input.versionId,
        campaignId: campaign.id,
        versionNumber: 1,
        status: "draft",
        subject: input.subject,
        preheader: input.preheader,
        contentSnapshot: { text: input.body },
        createdByUserId: context.userId
      };
      await createEmailCampaign(context, marketingPermissionData, auditFor(tx), data, campaign, version);
      await insertEmailCampaignGraph(tx, { campaign, version });
      return campaign;
    });
  } finally {
    await sql.end();
  }
}

export async function approveCampaignVersion(context: MarketingActorContext, campaignId: string, versionId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const version = await approveEmailCampaignVersion(
        context,
        marketingPermissionData,
        auditFor(tx),
        data,
        campaignId,
        versionId,
        new Date().toISOString()
      );
      const campaign = data.emailCampaigns.find((candidate) => candidate.id === campaignId)!;
      await updateEmailCampaignVersionRecord(tx, version);
      await updateEmailCampaignRecord(tx, campaign);
      return version;
    });
  } finally {
    await sql.end();
  }
}

export async function generateCampaignRecipientSnapshot(context: MarketingActorContext, campaignId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const campaign = data.emailCampaigns.find((candidate) => candidate.id === campaignId && !candidate.deletedAt);

      if (!campaign) {
        throw new Error("Email campaign was not found.");
      }

      const version = data.emailCampaignVersions
        .filter((candidate) => candidate.campaignId === campaignId && candidate.status === "approved" && !candidate.deletedAt)
        .sort((left, right) => right.versionNumber - left.versionNumber)[0];

      if (!version) {
        throw new Error("Campaign has no approved version to send.");
      }

      const snapshot = await createRecipientSnapshot(context, marketingPermissionData, auditFor(tx), data, {
        id: randomUUID(),
        campaignId,
        campaignVersionId: version.id,
        segmentId: campaign.segmentId,
        status: "created",
        generatedAt: new Date().toISOString(),
        idempotencyKey: `${campaignId}:${version.id}`
      });
      await insertEmailRecipientSnapshotRecord(tx, snapshot);
      return snapshot;
    });
  } finally {
    await sql.end();
  }
}

export async function scheduleCampaign(context: MarketingActorContext, campaignId: string, scheduledAt: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const campaign = await scheduleEmailCampaign(context, marketingPermissionData, auditFor(tx), data, campaignId, scheduledAt);
      await updateEmailCampaignRecord(tx, campaign);
      const newJobId = randomUUID();
      const job = enqueueEmailSend(context, marketingPermissionData, data, { id: newJobId, campaignId });
      if (job.id === newJobId) {
        await insertEmailSendJobRecord(tx, job);
      }
      return { campaign, job };
    });
  } finally {
    await sql.end();
  }
}

export async function sendCampaignNow(context: MarketingActorContext, campaignId: string) {
  return scheduleCampaign(context, campaignId, new Date().toISOString());
}

export async function createNewsletterMaster(
  context: MarketingActorContext,
  input: { masterId: string; title: string; seasonKey: string | null; requireLocalContent: boolean }
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const master = {
        id: input.masterId,
        templateId: fixtureIds.emailTemplates.standardNewsletter,
        title: input.title,
        status: "draft" as const,
        seasonKey: input.seasonKey,
        lockedBlocks: [{ key: "brand-header", type: "header", locked: true }, { key: "unsubscribe", type: "footer", locked: true }],
        optionalBlocks: [{ key: "network-ideas", type: "article_collection" }],
        localEditableBlocks: [{ key: "local-picks", type: "local_article_collection" }],
        contentRules: input.requireLocalContent ? { requiredLocalBlocks: ["local-picks"] } : {},
        createdByUserId: context.userId,
        approvedByUserId: null,
        approvedAt: null
      };
      await createNetworkNewsletterMaster(context, marketingPermissionData, auditFor(tx), data, master);
      await insertNetworkNewsletterMasterRecord(tx, master);
      return master;
    });
  } finally {
    await sql.end();
  }
}

export async function approveNewsletterMaster(context: MarketingActorContext, masterId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const master = await approveNetworkNewsletterMaster(
        context,
        marketingPermissionData,
        auditFor(tx),
        data,
        masterId,
        new Date().toISOString()
      );
      await updateNetworkNewsletterMasterRecord(tx, master);
      return master;
    });
  } finally {
    await sql.end();
  }
}

export async function generateNewsletterEditions(context: MarketingActorContext, masterId: string, territoryIds: string[]) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const idempotencyKey = `${masterId}:${[...territoryIds].sort().join(",")}`;
      const run = await generateTerritoryNewsletterEditions(context, marketingPermissionData, auditFor(tx), data, {
        id: randomUUID(),
        masterId,
        territoryIds,
        generatedAt: new Date().toISOString(),
        idempotencyKey
      });
      const master = data.networkNewsletterMasters.find((candidate) => candidate.id === masterId)!;
      await updateNetworkNewsletterMasterRecord(tx, master);
      for (const territoryId of territoryIds) {
        const edition = data.territoryNewsletterEditions.find(
          (candidate) => candidate.masterId === masterId && candidate.territoryId === territoryId
        );
        if (edition) {
          await upsertTerritoryNewsletterEditionRecord(tx, edition);
        }
      }
      await insertNewsletterFactoryRunRecord(tx, run);
      return run;
    });
  } finally {
    await sql.end();
  }
}

export async function addNewsletterEditionOverride(
  context: MarketingActorContext,
  editionId: string,
  overrides: Record<string, unknown>
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const edition = await recordTerritoryNewsletterOverride(context, marketingPermissionData, auditFor(tx), data, editionId, overrides);
      await upsertTerritoryNewsletterEditionRecord(tx, edition);
      return edition;
    });
  } finally {
    await sql.end();
  }
}

export async function createCampaignFromEdition(
  context: MarketingActorContext,
  input: { editionId: string; campaignId: string; versionId: string; segmentId: string; subject: string; preheader: string | null }
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const result = await createNewsletterEditionCampaign(context, marketingPermissionData, auditFor(tx), data, input);
      await insertEmailCampaignGraph(tx, { campaign: result.campaign, version: result.version });
      await upsertTerritoryNewsletterEditionRecord(tx, result.edition);
      return result.campaign;
    });
  } finally {
    await sql.end();
  }
}

type MarketingAuditInput = {
  action: string;
  actorUserId?: string | null;
  entityType: string;
  entityId?: string | null;
  organisationId?: string | null;
  territoryId?: string | null;
  payload?: Record<string, unknown>;
};

function auditFor(db: Parameters<typeof recordAuditEvent>[0]) {
  return {
    record: (input: MarketingAuditInput) =>
      recordAuditEvent(db, {
        action: input.action,
        actor: { type: "human", userId: input.actorUserId ?? "" },
        entity: { type: input.entityType, id: input.entityId ?? undefined },
        scope: { organisationId: input.organisationId ?? undefined, territoryId: input.territoryId ?? undefined },
        after: input.payload
      }).then(() => undefined)
  };
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
