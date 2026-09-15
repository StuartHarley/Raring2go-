import {
  audienceActivityEvents,
  audienceConsentEvents,
  audienceContacts,
  audienceImports,
  audiencePreferenceProfiles,
  audienceSavedContent,
  audienceSegmentMembers,
  audienceSegments,
  audienceSuppressions,
  audienceTerritorySubscriptions,
  emailCampaignVersions,
  emailCampaigns,
  emailDeliveryRecords,
  emailRecipientSnapshots,
  emailSendJobs,
  emailTemplates,
  marketingJourneyAudienceEntries,
  marketingJourneyExecutions,
  marketingJourneyStepExecutions,
  marketingJourneyVersions,
  marketingJourneys,
  networkNewsletterMasters,
  newsletterFactoryRuns,
  socialPublications,
  territoryNewsletterEditions,
  territories
} from "@raring2go/db";
import { and, eq, sql } from "drizzle-orm";
import type {
  AudienceSegment,
  AudienceSuppression,
  EmailCampaign,
  EmailCampaignVersion,
  EmailDeliveryRecord,
  EmailRecipientSnapshot,
  EmailSendJob,
  MarketingData,
  NetworkNewsletterMaster,
  NewsletterFactoryRun,
  TerritoryNewsletterEdition
} from "./types";

type MarketingDb = any;

type DrizzleDb = {
  select(): {
    from(table: unknown): Promise<Array<Record<string, unknown>>>;
  };
};

export async function loadMarketingData(db: DrizzleDb): Promise<MarketingData> {
  const [
    contactRows,
    subscriptionRows,
    consentRows,
    suppressionRows,
    segmentRows,
    segmentMemberRows,
    importRows,
    activityRows,
    preferenceRows,
    savedContentRows,
    templateRows,
    campaignRows,
    campaignVersionRows,
    recipientSnapshotRows,
    deliveryRows,
    sendJobRows,
    newsletterMasterRows,
    newsletterEditionRows,
    newsletterRunRows,
    journeyRows,
    journeyVersionRows,
    journeyEntryRows,
    journeyExecutionRows,
    journeyStepRows,
    socialPublicationRows,
    territoryRows
  ] = await Promise.all([
    db.select().from(audienceContacts),
    db.select().from(audienceTerritorySubscriptions),
    db.select().from(audienceConsentEvents),
    db.select().from(audienceSuppressions),
    db.select().from(audienceSegments),
    db.select().from(audienceSegmentMembers),
    db.select().from(audienceImports),
    db.select().from(audienceActivityEvents),
    db.select().from(audiencePreferenceProfiles),
    db.select().from(audienceSavedContent),
    db.select().from(emailTemplates),
    db.select().from(emailCampaigns),
    db.select().from(emailCampaignVersions),
    db.select().from(emailRecipientSnapshots),
    db.select().from(emailDeliveryRecords),
    db.select().from(emailSendJobs),
    db.select().from(networkNewsletterMasters),
    db.select().from(territoryNewsletterEditions),
    db.select().from(newsletterFactoryRuns),
    db.select().from(marketingJourneys),
    db.select().from(marketingJourneyVersions),
    db.select().from(marketingJourneyAudienceEntries),
    db.select().from(marketingJourneyExecutions),
    db.select().from(marketingJourneyStepExecutions),
    db.select().from(socialPublications),
    db.select().from(territories)
  ]);

  return {
    contacts: contactRows as MarketingData["contacts"],
    subscriptions: subscriptionRows.map(dateRows(["subscribedAt", "unsubscribedAt"])) as MarketingData["subscriptions"],
    consentEvents: consentRows.map(dateRows(["occurredAt"])) as MarketingData["consentEvents"],
    suppressions: suppressionRows.map(dateRows(["suppressedAt"])) as MarketingData["suppressions"],
    segments: segmentRows as MarketingData["segments"],
    segmentMembers: segmentMemberRows.map(dateRows(["addedAt"])) as MarketingData["segmentMembers"],
    imports: importRows as MarketingData["imports"],
    activityEvents: activityRows.map(dateRows(["occurredAt"])) as MarketingData["activityEvents"],
    preferenceProfiles: preferenceRows as MarketingData["preferenceProfiles"],
    savedContent: savedContentRows.map(dateRows(["savedAt"])) as MarketingData["savedContent"],
    emailTemplates: templateRows as MarketingData["emailTemplates"],
    emailCampaigns: campaignRows.map(dateRows(["scheduledAt", "approvedAt", "sentAt"])) as MarketingData["emailCampaigns"],
    emailCampaignVersions: campaignVersionRows.map(dateRows(["approvedAt"])) as MarketingData["emailCampaignVersions"],
    emailRecipientSnapshots: recipientSnapshotRows.map(dateRows(["generatedAt"])) as MarketingData["emailRecipientSnapshots"],
    emailDeliveryRecords: deliveryRows.map(dateRows(["eventAt"])) as MarketingData["emailDeliveryRecords"],
    emailSendJobs: sendJobRows.map(dateRows(["nextAttemptAt"])) as MarketingData["emailSendJobs"],
    networkNewsletterMasters: newsletterMasterRows.map(dateRows(["approvedAt"])) as MarketingData["networkNewsletterMasters"],
    territoryNewsletterEditions: newsletterEditionRows.map(dateRows(["generatedAt", "approvedAt"])) as MarketingData["territoryNewsletterEditions"],
    newsletterFactoryRuns: newsletterRunRows.map(dateRows(["generatedAt"])) as MarketingData["newsletterFactoryRuns"],
    journeys: journeyRows.map(dateRows(["approvedAt", "activatedAt", "pausedAt"])) as MarketingData["journeys"],
    journeyVersions: journeyVersionRows.map(dateRows(["approvedAt"])) as MarketingData["journeyVersions"],
    journeyAudienceEntries: journeyEntryRows.map(dateRows(["enteredAt", "exitedAt"])) as MarketingData["journeyAudienceEntries"],
    journeyExecutions: journeyExecutionRows.map(dateRows(["runAfter", "completedAt"])) as MarketingData["journeyExecutions"],
    journeyStepExecutions: journeyStepRows.map(dateRows(["scheduledFor", "completedAt"])) as MarketingData["journeyStepExecutions"],
    socialPublications: socialPublicationRows.map(dateRows(["scheduledAt", "publishedAt"])) as MarketingData["socialPublications"],
    territories: territoryRows as MarketingData["territories"]
  };
}

function dateRows(keys: string[]) {
  return (row: Record<string, unknown>) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      keys.includes(key) && value instanceof Date ? value.toISOString() : value
    ])
  );
}

export async function insertSegmentRecord(db: MarketingDb, segment: AudienceSegment) {
  await db.insert(audienceSegments).values({
    id: segment.id,
    territoryId: segment.territoryId ?? null,
    key: segment.key,
    name: segment.name,
    segmentType: segment.segmentType,
    definition: segment.definition,
    status: segment.status
  });
}

export async function updateSegmentRecord(db: MarketingDb, segment: AudienceSegment) {
  await db
    .update(audienceSegments)
    .set({
      name: segment.name,
      definition: segment.definition,
      status: segment.status
    })
    .where(eq(audienceSegments.id, segment.id));
}

export async function insertEmailCampaignGraph(
  db: MarketingDb,
  input: { campaign: EmailCampaign; version: EmailCampaignVersion }
) {
  await db.insert(emailCampaigns).values({
    ...input.campaign,
    scheduledAt: input.campaign.scheduledAt ? new Date(input.campaign.scheduledAt) : null,
    approvedAt: input.campaign.approvedAt ? new Date(input.campaign.approvedAt) : null,
    sentAt: input.campaign.sentAt ? new Date(input.campaign.sentAt) : null
  });
  await db.insert(emailCampaignVersions).values({
    ...input.version,
    approvedAt: input.version.approvedAt ? new Date(input.version.approvedAt) : null
  });
}

export async function updateEmailCampaignRecord(db: MarketingDb, campaign: EmailCampaign) {
  await db
    .update(emailCampaigns)
    .set({
      status: campaign.status,
      scheduledAt: campaign.scheduledAt ? new Date(campaign.scheduledAt) : null,
      approvedAt: campaign.approvedAt ? new Date(campaign.approvedAt) : null,
      sentAt: campaign.sentAt ? new Date(campaign.sentAt) : null
    })
    .where(eq(emailCampaigns.id, campaign.id));
}

export async function updateEmailCampaignVersionRecord(db: MarketingDb, version: EmailCampaignVersion) {
  await db
    .update(emailCampaignVersions)
    .set({
      status: version.status,
      approvedByUserId: version.approvedByUserId,
      approvedAt: version.approvedAt ? new Date(version.approvedAt) : null
    })
    .where(eq(emailCampaignVersions.id, version.id));
}

export async function insertEmailRecipientSnapshotRecord(db: MarketingDb, snapshot: EmailRecipientSnapshot) {
  await db
    .insert(emailRecipientSnapshots)
    .values({
      ...snapshot,
      generatedAt: new Date(snapshot.generatedAt)
    })
    .onConflictDoNothing();
}

export async function insertNetworkNewsletterMasterRecord(db: MarketingDb, master: NetworkNewsletterMaster) {
  await db.insert(networkNewsletterMasters).values({
    ...master,
    approvedAt: master.approvedAt ? new Date(master.approvedAt) : null
  });
}

export async function updateNetworkNewsletterMasterRecord(db: MarketingDb, master: NetworkNewsletterMaster) {
  await db
    .update(networkNewsletterMasters)
    .set({
      status: master.status,
      approvedByUserId: master.approvedByUserId,
      approvedAt: master.approvedAt ? new Date(master.approvedAt) : null
    })
    .where(eq(networkNewsletterMasters.id, master.id));
}

export async function upsertTerritoryNewsletterEditionRecord(db: MarketingDb, edition: TerritoryNewsletterEdition) {
  const values = {
    ...edition,
    generatedAt: new Date(edition.generatedAt),
    approvedAt: edition.approvedAt ? new Date(edition.approvedAt) : null
  };

  await db
    .insert(territoryNewsletterEditions)
    .values(values)
    .onConflictDoUpdate({
      target: territoryNewsletterEditions.id,
      set: {
        emailCampaignId: values.emailCampaignId,
        status: values.status,
        inheritedBlocks: values.inheritedBlocks,
        localOverrides: values.localOverrides,
        warnings: values.warnings,
        generatedAt: values.generatedAt,
        approvedAt: values.approvedAt
      }
    });
}

export async function insertNewsletterFactoryRunRecord(db: MarketingDb, run: NewsletterFactoryRun) {
  await db
    .insert(newsletterFactoryRuns)
    .values({
      ...run,
      generatedAt: new Date(run.generatedAt)
    })
    .onConflictDoNothing();
}

export async function insertEmailSendJobRecord(db: MarketingDb, job: EmailSendJob) {
  await db.insert(emailSendJobs).values({
    ...job,
    nextAttemptAt: new Date(job.nextAttemptAt)
  });
}

export async function claimNextEmailSendJob(db: MarketingDb): Promise<EmailSendJob | undefined> {
  const claimed = await db.execute(sql`
    UPDATE email_send_jobs
    SET status = 'processing', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM email_send_jobs
      WHERE (status = 'queued' AND next_attempt_at <= now())
         OR (status = 'processing' AND updated_at < now() - interval '5 minutes')
      ORDER BY next_attempt_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const claimedId = (Array.isArray(claimed) ? claimed[0] : claimed.rows?.[0])?.id as string | undefined;

  if (!claimedId) {
    return undefined;
  }

  const [row] = await db.select().from(emailSendJobs).where(eq(emailSendJobs.id, claimedId));
  return row ? (dateRows(["nextAttemptAt"])(row) as EmailSendJob) : undefined;
}

export async function loadEmailSendJobBundle(db: MarketingDb, jobId: string) {
  const [job] = await db.select().from(emailSendJobs).where(eq(emailSendJobs.id, jobId));

  if (!job) {
    return undefined;
  }

  const [campaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, job.campaignId));
  const [version] = await db.select().from(emailCampaignVersions).where(eq(emailCampaignVersions.id, job.campaignVersionId));
  const [snapshot] = await db.select().from(emailRecipientSnapshots).where(eq(emailRecipientSnapshots.id, job.recipientSnapshotId));

  if (!campaign || !version || !snapshot) {
    return undefined;
  }

  return {
    job: dateRows(["nextAttemptAt"])(job) as EmailSendJob,
    campaign: dateRows(["scheduledAt", "approvedAt", "sentAt"])(campaign) as EmailCampaign,
    version: dateRows(["approvedAt"])(version) as EmailCampaignVersion,
    snapshot: dateRows(["generatedAt"])(snapshot) as EmailRecipientSnapshot
  };
}

export async function advanceEmailSendJob(
  db: MarketingDb,
  jobId: string,
  patch: { cursor?: number; status?: EmailSendJob["status"]; lastError?: string | null; nextAttemptAt?: string }
) {
  await db
    .update(emailSendJobs)
    .set({
      ...(patch.cursor !== undefined ? { cursor: patch.cursor } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      ...(patch.nextAttemptAt !== undefined ? { nextAttemptAt: new Date(patch.nextAttemptAt) } : {})
    })
    .where(eq(emailSendJobs.id, jobId));
}

export async function findDeliveryRecordByProviderMessage(
  db: MarketingDb,
  providerKey: string,
  providerMessageId: string
): Promise<EmailDeliveryRecord | undefined> {
  const [row] = await db
    .select()
    .from(emailDeliveryRecords)
    .where(and(eq(emailDeliveryRecords.providerKey, providerKey), eq(emailDeliveryRecords.providerMessageId, providerMessageId)))
    .limit(1);

  return row ? (dateRows(["eventAt"])(row) as EmailDeliveryRecord) : undefined;
}

export async function loadDeliveryEventContext(db: MarketingDb, providerKey: string, providerMessageId: string) {
  const original = await findDeliveryRecordByProviderMessage(db, providerKey, providerMessageId);

  if (!original) {
    return undefined;
  }

  const [contact] = original.contactId
    ? await db.select().from(audienceContacts).where(eq(audienceContacts.id, original.contactId))
    : [];
  const suppressions = original.contactId
    ? ((await db.select().from(audienceSuppressions).where(eq(audienceSuppressions.contactId, original.contactId))).map(
        dateRows(["suppressedAt"])
      ) as AudienceSuppression[])
    : [];

  return { original, contacts: contact ? [contact] : [], suppressions };
}

export async function insertEmailDeliveryRecordRows(db: MarketingDb, rows: EmailDeliveryRecord[]) {
  if (rows.length === 0) {
    return;
  }

  await db
    .insert(emailDeliveryRecords)
    .values(
      rows.map((row) => ({
        ...row,
        eventAt: row.eventAt ? new Date(row.eventAt) : null
      }))
    )
    .onConflictDoNothing();
}

export async function loadContactForUnsubscribe(db: MarketingDb, contactId: string) {
  const [contact] = await db.select().from(audienceContacts).where(eq(audienceContacts.id, contactId));

  if (!contact) {
    return undefined;
  }

  const suppressionRows = await db.select().from(audienceSuppressions).where(eq(audienceSuppressions.contactId, contactId));

  return {
    contact,
    suppressions: suppressionRows.map(dateRows(["suppressedAt"])) as AudienceSuppression[]
  };
}

export async function insertSuppressionRecord(db: MarketingDb, suppression: AudienceSuppression) {
  await db
    .insert(audienceSuppressions)
    .values({
      ...suppression,
      suppressedAt: new Date(suppression.suppressedAt)
    })
    .onConflictDoNothing();
}

export async function updateContactEmailStatusRecord(db: MarketingDb, contactId: string, emailStatus: string) {
  await db.update(audienceContacts).set({ emailStatus }).where(eq(audienceContacts.id, contactId));
}
