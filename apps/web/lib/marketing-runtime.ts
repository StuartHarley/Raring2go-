import { randomUUID } from "node:crypto";
import {
  activateJourney,
  approveEmailCampaignVersion,
  approveJourneyVersion,
  approveNetworkNewsletterMaster,
  compareSubjectLineVariants,
  createEmailCampaign,
  createEmailCampaignVersion,
  createJourney,
  createNetworkNewsletterMaster,
  createNewsletterEditionCampaign,
  createRecipientSnapshot,
  createSegment,
  createWinnerRemainderSnapshot,
  declareSubjectLineWinner,
  enqueueEmailSend,
  enqueueSendTimeOptimizedSend,
  enterJourneyFromEvent,
  findActiveJourneysForTrigger,
  generateTerritoryNewsletterEditions,
  getJourneyDetail,
  insertEmailCampaignGraph,
  insertEmailCampaignVersionRecord,
  insertEmailRecipientSnapshotRecord,
  insertEmailSendJobRecord,
  insertJourneyAudienceEntryRecord,
  insertJourneyExecutionRecord,
  insertJourneyGraph,
  insertNetworkNewsletterMasterRecord,
  insertNewsletterFactoryRunRecord,
  insertSegmentRecord,
  listAudienceContacts,
  listEmailCampaigns,
  getPreferenceCentre,
  listJourneys,
  listMarketingAnalytics,
  listMarketingCommandCentre,
  listNewsletterFactory,
  listSegments,
  loadMarketingData,
  pauseJourney,
  previewSegment,
  previewSegmentDefinition,
  recordTerritoryNewsletterOverride,
  scheduleEmailCampaign,
  startSubjectLineTest,
  subscribeContactToTerritory,
  updateEmailCampaignRecord,
  updateEmailCampaignVersionRecord,
  updateJourneyDraft,
  updateJourneyRecord,
  updateJourneyVersionRecord,
  updateNetworkNewsletterMasterRecord,
  updateSegment,
  updateSegmentRecord,
  upsertAudienceTerritorySubscriptionRecord,
  upsertTerritoryNewsletterEditionRecord
} from "@raring2go/marketing";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb, fixtureIds, foundationSeed } from "@raring2go/db";
import { createDrizzleProviderConnectionRepository } from "@raring2go/integrations";
import type {
  Block,
  EmailSendProvider,
  JourneyCondition,
  JourneyStep,
  JourneyTrigger,
  MarketingActorContext,
  MarketingJourney,
  MarketingJourneyVersion
} from "@raring2go/marketing";
import { evaluatePermission, type PermissionData } from "@raring2go/permissions";
import { marketingCapabilities, type MarketingCapability } from "@raring2go/marketing";

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
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.audienceManage, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.segmentView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.segmentManage, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.emailView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.emailCreate, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.emailApprove, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.emailSchedule, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.emailSend, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.emailAiAssist, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.newsletterFactoryView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.newsletterFactoryManage, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.newsletterFactoryApprove, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.newsletterFactoryContribute, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.journeyView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.journeyCreate, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.journeyEdit, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.journeyApprove, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.journeyActivate, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.journeyPause, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.journeyExecute, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.marketingAnalyticsView, "network"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.audienceView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.segmentView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.segmentManage, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailCreate, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailApprove, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailSchedule, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailSend, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.emailAiAssist, "own_territory"),
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

export function hasMarketingCapability(context: MarketingActorContext, capability: MarketingCapability): boolean {
  const required = marketingCapabilities[capability];
  return evaluatePermission(
    {
      userId: context.userId,
      module: required.module,
      action: required.action,
      context: {
        organisationId: context.organisationId ?? undefined,
        territoryId: context.territoryId ?? undefined
      }
    },
    marketingPermissionData
  ).allowed;
}

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

export async function readSegmentsWithAudienceCounts(context: MarketingActorContext) {
  const { db, sql } = createDb();

  try {
    const data = await loadMarketingData(db);
    const segments = listSegments(context, marketingPermissionData, data);
    return segments.map((segment) => ({
      segment,
      recipientCount: previewSegment(context, marketingPermissionData, data, segment.id).length
    }));
  } finally {
    await sql.end();
  }
}

export async function previewSegmentAudience(
  context: MarketingActorContext,
  input: { territoryId?: string | null; definition: Record<string, unknown> }
) {
  const { db, sql } = createDb();

  try {
    return previewSegmentDefinition(context, marketingPermissionData, await loadMarketingData(db), input);
  } finally {
    await sql.end();
  }
}

export async function createAudienceSegment(
  context: MarketingActorContext,
  input: { key: string; name: string; territoryId?: string | null; definition: unknown }
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const segment = await createSegment(context, marketingPermissionData, auditFor(tx), data, { id: randomUUID(), ...input });
      await insertSegmentRecord(tx, segment);
      return segment;
    });
  } finally {
    await sql.end();
  }
}

export async function updateAudienceSegment(
  context: MarketingActorContext,
  segmentId: string,
  input: { name?: string; definition?: unknown }
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const segment = await updateSegment(context, marketingPermissionData, auditFor(tx), data, segmentId, input);
      await updateSegmentRecord(tx, segment);
      return segment;
    });
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

export async function readJourneyDetail(context: MarketingActorContext, journeyId: string) {
  const { db, sql } = createDb();

  try {
    return getJourneyDetail(context, marketingPermissionData, await loadMarketingData(db), journeyId);
  } finally {
    await sql.end();
  }
}

export async function createMarketingJourney(
  context: MarketingActorContext,
  input: {
    journeyId: string;
    versionId: string;
    key: string;
    name: string;
    territoryId?: string | null;
    purpose: string;
    description?: string | null;
    frequencyCap?: Record<string, unknown>;
    trigger: JourneyTrigger;
    conditions: JourneyCondition[];
    steps: JourneyStep[];
    aiSuggestions?: Record<string, unknown>;
  }
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const journey: MarketingJourney = {
        id: input.journeyId,
        key: input.key,
        name: input.name,
        territoryId: input.territoryId ?? null,
        status: "draft",
        purpose: input.purpose,
        description: input.description ?? null,
        frequencyCap: input.frequencyCap ?? {},
        metadata: {},
        createdByUserId: context.userId,
        approvedByUserId: null,
        approvedAt: null,
        activatedAt: null,
        pausedAt: null
      };
      const version: MarketingJourneyVersion = {
        id: input.versionId,
        journeyId: journey.id,
        versionNumber: 1,
        status: "draft",
        trigger: input.trigger,
        conditions: input.conditions,
        steps: input.steps,
        aiSuggestions: input.aiSuggestions ?? {},
        approvedByUserId: null,
        approvedAt: null
      };
      await createJourney(context, marketingPermissionData, auditFor(tx), data, journey, version);
      await insertJourneyGraph(tx, { journey, version });
      return journey;
    });
  } finally {
    await sql.end();
  }
}

export async function updateMarketingJourneyDraft(
  context: MarketingActorContext,
  journeyId: string,
  patch: {
    name?: string;
    description?: string | null;
    purpose?: string;
    trigger?: JourneyTrigger;
    conditions?: JourneyCondition[];
    steps?: JourneyStep[];
  }
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const { journey, version } = await updateJourneyDraft(context, marketingPermissionData, auditFor(tx), data, journeyId, patch);
      await updateJourneyRecord(tx, journey);
      await updateJourneyVersionRecord(tx, version);
      return { journey, version };
    });
  } finally {
    await sql.end();
  }
}

export async function approveMarketingJourneyVersion(context: MarketingActorContext, journeyId: string, versionId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const version = await approveJourneyVersion(
        context,
        marketingPermissionData,
        auditFor(tx),
        data,
        journeyId,
        versionId,
        new Date().toISOString()
      );
      const journey = data.journeys.find((candidate) => candidate.id === journeyId)!;
      await updateJourneyVersionRecord(tx, version);
      await updateJourneyRecord(tx, journey);
      return version;
    });
  } finally {
    await sql.end();
  }
}

export async function activateMarketingJourney(context: MarketingActorContext, journeyId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const journey = await activateJourney(context, marketingPermissionData, auditFor(tx), data, journeyId, new Date().toISOString());
      await updateJourneyRecord(tx, journey);
      return journey;
    });
  } finally {
    await sql.end();
  }
}

export async function pauseMarketingJourney(context: MarketingActorContext, journeyId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const journey = await pauseJourney(context, marketingPermissionData, auditFor(tx), data, journeyId, new Date().toISOString());
      await updateJourneyRecord(tx, journey);
      return journey;
    });
  } finally {
    await sql.end();
  }
}

/**
 * No admin/public UI calls this yet - subscribing a contact isn't a real
 * feature anywhere in the app today. This exists so the journey trigger
 * (contact_subscribed_to_territory) has a real, persisted event to fire on,
 * verified live via a script rather than a UI for now.
 */
export async function subscribeContactAndTriggerJourneys(
  context: MarketingActorContext,
  input: { contactId: string; territoryId: string; source: string; preferences?: Record<string, unknown> }
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const subscription = await subscribeContactToTerritory(context, marketingPermissionData, auditFor(tx), data, {
        id: randomUUID(),
        contactId: input.contactId,
        territoryId: input.territoryId,
        status: "subscribed",
        source: input.source,
        preferences: input.preferences ?? {},
        subscribedAt: new Date().toISOString(),
        unsubscribedAt: null
      });
      await upsertAudienceTerritorySubscriptionRecord(tx, subscription);

      const matches = findActiveJourneysForTrigger(data, { type: "contact_subscribed_to_territory" });
      const entries = [];
      for (const { journey } of matches) {
        const entry = await enterJourneyFromEvent(context, marketingPermissionData, auditFor(tx), data, {
          journeyId: journey.id,
          contactId: input.contactId,
          territoryId: input.territoryId,
          sourceEventType: "audience.subscribed",
          sourceEventId: subscription.id,
          enteredAt: new Date().toISOString(),
          idempotencyKey: `audience.subscribed:${subscription.id}:${journey.id}`
        });
        await insertJourneyAudienceEntryRecord(tx, entry);
        const execution = data.journeyExecutions.find((candidate) => candidate.entryId === entry.id);
        if (execution) {
          await insertJourneyExecutionRecord(tx, execution);
        }
        entries.push(entry);
      }
      return { subscription, entries };
    });
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
    blocks: Block[];
    sendProvider?: EmailSendProvider;
    sendConnectionId?: string | null;
    variantBSubject?: string | null;
    variantBVersionId?: string;
  }
) {
  if (input.blocks.length === 0) {
    throw new Error("Add at least one block before composing a campaign.");
  }


  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const segment = data.segments.find((candidate) => candidate.id === input.segmentId && !candidate.deletedAt);

      if (!segment) {
        throw new Error("Audience segment was not found.");
      }

      const sendProvider = input.sendProvider ?? "postmark";
      const sendConnectionId = sendProvider === "microsoft" ? (input.sendConnectionId ?? null) : null;

      if (sendProvider === "microsoft") {
        if (!sendConnectionId) {
          throw new Error("A connected Outlook mailbox is required to send via Outlook.");
        }
        const connectionRepository = createDrizzleProviderConnectionRepository(tx);
        const connection = await connectionRepository.getConnection(sendConnectionId);
        if (
          !connection ||
          connection.provider !== "microsoft" ||
          connection.status !== "connected" ||
          (segment.territoryId ? connection.territoryId !== segment.territoryId : Boolean(connection.territoryId))
        ) {
          throw new Error("The selected Outlook mailbox is not connected for this territory.");
        }
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
        sendProvider,
        sendConnectionId,
        scheduledAt: null,
        approvedAt: null,
        sentAt: null,
        metadata: {}
      };
      const runningAbTest = Boolean(input.variantBSubject);
      const version = {
        id: input.versionId,
        campaignId: campaign.id,
        versionNumber: 1,
        status: "draft",
        subject: input.subject,
        preheader: input.preheader,
        contentSnapshot: { version: 1 as const, blocks: input.blocks },
        variantKey: runningAbTest ? ("a" as const) : null,
        createdByUserId: context.userId
      };
      await createEmailCampaign(context, marketingPermissionData, auditFor(tx), data, campaign, version);
      await insertEmailCampaignGraph(tx, { campaign, version });

      if (runningAbTest) {
        if (!input.variantBVersionId) {
          throw new Error("A second version id is required to run a subject-line test.");
        }
        const variantB = {
          id: input.variantBVersionId,
          campaignId: campaign.id,
          versionNumber: 2,
          status: "draft",
          subject: input.variantBSubject!,
          preheader: input.preheader,
          contentSnapshot: version.contentSnapshot,
          variantKey: "b" as const,
          createdByUserId: context.userId
        };
        await createEmailCampaignVersion(context, marketingPermissionData, auditFor(tx), data, campaign.id, variantB);
        await insertEmailCampaignVersionRecord(tx, variantB);
      }

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

export async function scheduleCampaignWithSendTimeOptimization(
  context: MarketingActorContext,
  campaignId: string,
  input: { scheduledAt: string; defaultHour?: number }
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      await scheduleEmailCampaign(context, marketingPermissionData, auditFor(tx), data, campaignId, input.scheduledAt);
      const result = await enqueueSendTimeOptimizedSend(context, marketingPermissionData, auditFor(tx), data, {
        campaignId,
        scheduledAt: input.scheduledAt,
        defaultHour: input.defaultHour
      });
      await updateEmailCampaignRecord(tx, result.campaign);
      for (const snapshot of result.snapshots) {
        await insertEmailRecipientSnapshotRecord(tx, snapshot);
      }
      for (const job of result.jobs) {
        await insertEmailSendJobRecord(tx, job);
      }
      return result;
    });
  } finally {
    await sql.end();
  }
}

export async function startAbTest(context: MarketingActorContext, campaignId: string, sampleFraction?: number) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const result = await startSubjectLineTest(context, marketingPermissionData, auditFor(tx), data, {
        campaignId,
        sampleFraction,
        startedAt: new Date().toISOString(),
        snapshotIdA: randomUUID(),
        snapshotIdB: randomUUID(),
        jobIdA: randomUUID(),
        jobIdB: randomUUID()
      });
      await updateEmailCampaignRecord(tx, result.campaign);
      await updateEmailCampaignVersionRecord(tx, result.variantA);
      await updateEmailCampaignVersionRecord(tx, result.variantB);
      await insertEmailRecipientSnapshotRecord(tx, result.snapshotA);
      await insertEmailRecipientSnapshotRecord(tx, result.snapshotB);
      await insertEmailSendJobRecord(tx, result.jobA);
      await insertEmailSendJobRecord(tx, result.jobB);
      return result;
    });
  } finally {
    await sql.end();
  }
}

export async function readSubjectLineComparison(context: MarketingActorContext, campaignId: string) {
  const { db, sql } = createDb();

  try {
    return compareSubjectLineVariants(context, marketingPermissionData, await loadMarketingData(db), campaignId);
  } finally {
    await sql.end();
  }
}

export async function declareWinner(context: MarketingActorContext, campaignId: string, winningVersionId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const result = await declareSubjectLineWinner(context, marketingPermissionData, auditFor(tx), data, {
        campaignId,
        winningVersionId,
        decidedAt: new Date().toISOString()
      });
      await updateEmailCampaignRecord(tx, result.campaign);
      await updateEmailCampaignVersionRecord(tx, result.winner);
      await updateEmailCampaignVersionRecord(tx, result.loser);
      return result;
    });
  } finally {
    await sql.end();
  }
}

export async function generateWinnerRemainderSnapshot(context: MarketingActorContext, campaignId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadMarketingData(tx);
      const snapshot = await createWinnerRemainderSnapshot(context, marketingPermissionData, auditFor(tx), data, {
        campaignId,
        id: randomUUID(),
        generatedAt: new Date().toISOString()
      });
      await insertEmailRecipientSnapshotRecord(tx, snapshot);
      return snapshot;
    });
  } finally {
    await sql.end();
  }
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
