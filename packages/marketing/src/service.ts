import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { auditActions } from "@raring2go/audit";
import { requirePermission, type PermissionData } from "@raring2go/permissions";
import type { Block } from "./blocks";
import { normalizeContentSnapshot } from "./content-snapshot";
import { marketingCapabilities, type MarketingCapability } from "./permissions";
import { evaluateSegmentRules, normalizeSegmentDefinition, validateSegmentDefinition } from "./segment-rules";
import type {
  AudienceConsentEvent,
  AudienceContact,
  AudienceContactView,
  AudienceOverview,
  AudiencePreferenceProfile,
  AudienceSegment,
  AudienceSuppression,
  AudienceTerritorySubscription,
  EmailCampaign,
  EmailCampaignAbTestMetadata,
  EmailCampaignSendTimeOptimizationMetadata,
  EmailCampaignVersion,
  EmailCampaignOverview,
  EmailDeliveryRecord,
  EmailRecipientSnapshot,
  EmailSendJob,
  EmailTemplate,
  JourneyCondition,
  JourneyStep,
  JourneyStepSendEmail,
  JourneyTrigger,
  MarketingJourney,
  MarketingJourneyAudienceEntry,
  MarketingJourneyExecution,
  MarketingJourneyOverview,
  MarketingJourneyVersion,
  NetworkNewsletterMaster,
  NewsletterFactoryOverview,
  NewsletterFactoryRun,
  MarketingActorContext,
  MarketingAnalyticsOverview,
  MarketingCommandCentre,
  MarketingData,
  PreferenceCentreView,
  TerritoryNewsletterEdition
} from "./types";

type MarketingAuditRecorder = {
  record(event: {
    action: string;
    actorUserId?: string | null;
    entityType: string;
    entityId?: string | null;
    organisationId?: string | null;
    territoryId?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void>;
};

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

export function listAudienceContacts(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData
): AudienceOverview {
  requireMarketingPermission(context, permissions, "audienceView");
  const visibleTerritoryIds = visibleTerritories(context, data);
  const contacts = data.contacts
    .filter((contact) => !contact.deletedAt)
    .filter((contact) => contactVisibleInTerritories(contact.id, visibleTerritoryIds, data))
    .map((contact) => assembleContactView(data, contact, visibleTerritoryIds))
    .sort((left, right) => left.contact.emailNormalised.localeCompare(right.contact.emailNormalised));

  return {
    contacts,
    totals: {
      contacts: contacts.length,
      subscribed: contacts.filter((view) => view.subscriptions.some((subscription) => subscription.status === "subscribed")).length,
      suppressed: contacts.filter((view) => view.suppressions.some((suppression) => suppression.active)).length,
      territories: new Set(contacts.flatMap((view) => view.subscriptions.map((subscription) => subscription.territoryId))).size
    }
  };
}

export function getPreferenceCentre(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData,
  contactId: string
): PreferenceCentreView {
  requireMarketingPermission(context, permissions, "audienceView");
  const contact = requireContact(data, contactId);
  const visibleTerritoryIds = visibleTerritories(context, data);
  if (!contactVisibleInTerritories(contact.id, visibleTerritoryIds, data)) {
    throw new Error("Audience contact is outside the permitted scope.");
  }

  const profile = data.preferenceProfiles.find((candidate) => candidate.contactId === contact.id && !candidate.deletedAt);
  const subscriptions = data.subscriptions
    .filter((subscription) => subscription.contactId === contact.id && !subscription.deletedAt)
    .filter((subscription) => visibleTerritoryIds == null || visibleTerritoryIds.has(subscription.territoryId));
  const savedContent = data.savedContent
    .filter((saved) => saved.contactId === contact.id && !saved.deletedAt)
    .filter((saved) => visibleTerritoryIds == null || !saved.territoryId || visibleTerritoryIds.has(saved.territoryId));
  const interestSet = new Set(profile?.interests ?? []);

  return {
    contact,
    profile,
    subscriptions,
    savedContent,
    recommendedSegments: data.segments
      .filter((segment) => !segment.deletedAt && segment.status === "active")
      .filter((segment) => visibleTerritoryIds == null || !segment.territoryId || visibleTerritoryIds.has(segment.territoryId))
      .filter((segment) => segmentMatchesPreferences(segment, profile)),
    recommendedContent: data.activityEvents
      .filter((event) => !event.deletedAt)
      .filter((event) => visibleTerritoryIds == null || !event.territoryId || visibleTerritoryIds.has(event.territoryId))
      .map((event) => ({
        id: event.id,
        title: event.title,
        contentType: String(event.metadata.contentType ?? event.activityType),
        relevanceReasons: preferenceReasons(event.metadata, interestSet)
      }))
      .filter((event) => event.relevanceReasons.length > 0)
  };
}

export async function updatePreferenceProfile(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  profile: AudiencePreferenceProfile
) {
  requireMarketingPermission(context, permissions, "audienceManage");
  const contact = requireContact(data, profile.contactId);
  const visibleTerritoryIds = visibleTerritories(context, data);
  if (!contactVisibleInTerritories(contact.id, visibleTerritoryIds, data)) {
    throw new Error("Audience contact is outside the permitted scope.");
  }
  validatePreferenceProfile(data, profile, visibleTerritoryIds);

  const existing = data.preferenceProfiles.find((candidate) => candidate.id === profile.id || candidate.contactId === profile.contactId);
  if (existing) {
    Object.assign(existing, { ...profile });
  } else {
    data.preferenceProfiles.push(profile);
  }

  await audit.record(marketingAuditEvent(context, auditActions.audiencePreferenceUpdate, "audience_preference_profile", profile.id, {
    contactId: profile.contactId,
    personalisationEnabled: profile.personalisationEnabled,
    interests: profile.interests,
    childAgeBands: profile.childAgeBands,
    newsletterFrequency: profile.newsletterFrequency
  }, profile.homeTerritoryId));

  return getPreferenceCentre(context, permissions, data, profile.contactId);
}

export function listEmailCampaigns(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData
): EmailCampaignOverview {
  requireMarketingPermission(context, permissions, "emailView");
  const visibleTerritoryIds = visibleTerritories(context, data);
  const campaigns = data.emailCampaigns
    .filter((campaign) => !campaign.deletedAt)
    .filter((campaign) => visibleTerritoryIds == null || !campaign.territoryId || visibleTerritoryIds.has(campaign.territoryId))
    .map((campaign) => {
      const latestVersion = data.emailCampaignVersions
        .filter((version) => version.campaignId === campaign.id && !version.deletedAt)
        .sort((left, right) => right.versionNumber - left.versionNumber)[0];
      return {
      campaign,
      latestVersion,
      latestSnapshot: data.emailRecipientSnapshots
        .filter((snapshot) => snapshot.campaignId === campaign.id)
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0],
      deliveryCount: data.emailDeliveryRecords.filter((delivery) => delivery.campaignId === campaign.id && !delivery.deletedAt).length,
      activeJob: data.emailSendJobs.find(
        (job) => job.campaignId === campaign.id && (job.status === "queued" || job.status === "processing")
      ),
      sendJobs: latestVersion
        ? data.emailSendJobs
            .filter((job) => job.campaignVersionId === latestVersion.id)
            .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt))
            .map((job) => ({
              job,
              snapshot: data.emailRecipientSnapshots.find((snapshot) => snapshot.id === job.recipientSnapshotId)
            }))
        : [],
      variants: data.emailCampaignVersions
        .filter((version) => version.campaignId === campaign.id && !version.deletedAt && (version.variantKey === "a" || version.variantKey === "b"))
        .sort((left, right) => left.versionNumber - right.versionNumber)
        .map((version) => ({
          version,
          snapshot: data.emailRecipientSnapshots
            .filter((snapshot) => snapshot.campaignVersionId === version.id)
            .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0],
          job: data.emailSendJobs
            .filter((job) => job.campaignVersionId === version.id)
            .sort((left, right) => right.nextAttemptAt.localeCompare(left.nextAttemptAt))[0]
        })),
      remainderSnapshot: data.emailRecipientSnapshots
        .filter((snapshot) => snapshot.campaignId === campaign.id && snapshot.variantKey === "remainder")
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0]
      };
    });

  return {
    campaigns,
    totals: {
      campaigns: campaigns.length,
      draft: campaigns.filter((view) => view.campaign.status === "draft").length,
      scheduled: campaigns.filter((view) => view.campaign.status === "scheduled").length,
      sent: campaigns.filter((view) => view.campaign.status === "sent").length
    }
  };
}

export function nextEmailSendChunk(job: EmailSendJob, snapshot: EmailRecipientSnapshot) {
  const recipients = snapshot.recipients.slice(job.cursor, job.cursor + job.batchSize);

  return {
    recipients,
    isFinalChunk: job.cursor + recipients.length >= snapshot.recipients.length
  };
}

export function listMarketingAnalytics(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData
): MarketingAnalyticsOverview {
  requireMarketingPermission(context, permissions, "analyticsView");
  const visibleTerritoryIds = visibleTerritories(context, data);
  const territoryAllowed = (territoryId?: string | null) => visibleTerritoryIds == null || !territoryId || visibleTerritoryIds.has(territoryId);
  const subscriptions = data.subscriptions.filter((subscription) => !subscription.deletedAt && territoryAllowed(subscription.territoryId));
  const contacts = data.contacts.filter((contact) => !contact.deletedAt && contactVisibleInTerritories(contact.id, visibleTerritoryIds, data));
  const suppressions = data.suppressions.filter((suppression) => suppression.active && territoryAllowed(suppression.territoryId));
  const deliveries = data.emailDeliveryRecords.filter((delivery) => !delivery.deletedAt && territoryAllowed(deliveryTerritory(data, delivery.campaignId)));
  const journeyEntries = data.journeyAudienceEntries.filter((entry) => territoryAllowed(entry.territoryId));
  const journeyExecutions = data.journeyExecutions.filter((execution) => {
    const entry = data.journeyAudienceEntries.find((candidate) => candidate.id === execution.entryId);
    return territoryAllowed(entry?.territoryId);
  });
  const social = data.socialPublications.filter((publication) => !publication.deletedAt && territoryAllowed(publication.territoryId));

  const sentCampaigns = data.emailCampaigns.filter(
    (campaign) =>
      !campaign.deletedAt &&
      (campaign.status === "sent" || campaign.status === "sending") &&
      territoryAllowed(campaign.territoryId)
  );
  const campaignAnalytics = sentCampaigns.map((campaign) => {
    const campaignDeliveries = deliveries.filter((delivery) => delivery.campaignId === campaign.id);
    const trackingAvailable = campaign.sendProvider !== "microsoft";

    return {
      campaignId: campaign.id,
      title: campaign.title,
      sendProvider: campaign.sendProvider,
      sentAt: campaign.sentAt,
      delivered: campaignDeliveries.filter((delivery) => delivery.status === "delivered").length,
      failed: campaignDeliveries.filter((delivery) => delivery.status === "failed" || delivery.status === "bounced").length,
      opens: trackingAvailable ? providerMetricSum(campaignDeliveries.map((delivery) => delivery.metadata), "opens") : undefined,
      clicks: trackingAvailable ? providerMetricSum(campaignDeliveries.map((delivery) => delivery.metadata), "clicks") : undefined,
      trackingAvailable
    };
  });

  const growthByTerritory = Array.from(new Set(subscriptions.map((subscription) => subscription.territoryId))).map((territoryId) => ({
    territoryId,
    subscribers: subscriptions.filter((subscription) => subscription.territoryId === territoryId && subscription.status === "subscribed").length
  }));

  return {
    audience: {
      totalContacts: contacts.length,
      activeSubscribers: subscriptions.filter((subscription) => subscription.status === "subscribed").length,
      suppressions: suppressions.length,
      unsubscribes: subscriptions.filter((subscription) => subscription.status === "unsubscribed").length,
      growthByTerritory
    },
    email: {
      sends: deliveries.length,
      delivered: deliveries.filter((delivery) => delivery.status === "delivered").length,
      failed: deliveries.filter((delivery) => delivery.status === "failed" || delivery.status === "bounced").length,
      opens: providerMetricSum(deliveries.map((delivery) => delivery.metadata), "opens"),
      clicks: providerMetricSum(deliveries.map((delivery) => delivery.metadata), "clicks"),
      campaigns: campaignAnalytics
    },
    journeys: {
      entries: journeyEntries.length,
      completed: journeyEntries.filter((entry) => entry.status === "completed").length,
      failed: journeyExecutions.filter((execution) => execution.status === "failed").length,
      dropOff: journeyEntries.filter((entry) => entry.status === "exited" && entry.exitReason !== "completed").length
    },
    social: {
      scheduled: social.filter((publication) => publication.publishState === "scheduled").length,
      published: social.filter((publication) => publication.publishState === "published").length,
      failed: social.filter((publication) => publication.publishState === "failed").length
    },
    attribution: [
      ...growthByTerritory.map((territory) => ({
        source: "platform" as const,
        channel: "audience",
        territoryId: territory.territoryId,
        metric: "active_subscribers",
        value: territory.subscribers
      })),
      {
        source: "platform",
        channel: "journey",
        metric: "entries",
        value: journeyEntries.length
      },
      {
        source: "platform",
        channel: "social",
        metric: "published",
        value: social.filter((publication) => publication.publishState === "published").length
      }
    ]
  };
}

export function listMarketingCommandCentre(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData
): MarketingCommandCentre {
  const analytics = listMarketingAnalytics(context, permissions, data);
  const visibleTerritoryIds = visibleTerritories(context, data);
  const territoryAllowed = (territoryId?: string | null) => visibleTerritoryIds == null || !territoryId || visibleTerritoryIds.has(territoryId);
  const territories = data.territories.filter((territory) => territoryAllowed(territory.id));
  const actionItems: MarketingCommandCentre["actionItems"] = [];

  for (const execution of data.journeyExecutions.filter((candidate) => candidate.status === "failed")) {
    const entry = data.journeyAudienceEntries.find((candidate) => candidate.id === execution.entryId);
    if (territoryAllowed(entry?.territoryId)) {
      actionItems.push({
        id: `journey-${execution.id}`,
        severity: "critical",
        territoryId: entry?.territoryId,
        title: `Journey step failed: ${execution.failureReason ?? execution.currentStepKey ?? execution.id}`,
        source: "journey"
      });
    }
  }

  for (const publication of data.socialPublications.filter((candidate) => candidate.publishState === "failed" && territoryAllowed(candidate.territoryId))) {
    actionItems.push({
      id: `social-${publication.id}`,
      severity: "warning",
      territoryId: publication.territoryId,
      title: `Social publication failed on ${publication.channel}`,
      source: "social"
    });
  }

  for (const territory of territories) {
    const subscribers = data.subscriptions.filter((subscription) => subscription.territoryId === territory.id && subscription.status === "subscribed" && !subscription.deletedAt).length;
    const upcomingNewsletterSends = data.emailCampaigns.filter((campaign) => campaign.territoryId === territory.id && campaign.status === "scheduled" && !campaign.deletedAt).length;
    const activeJourneys = data.journeys.filter((journey) => journey.status === "active" && (!journey.territoryId || journey.territoryId === territory.id) && !journey.deletedAt).length;
    const scheduledSocial = data.socialPublications.filter((publication) => publication.territoryId === territory.id && publication.publishState === "scheduled" && !publication.deletedAt).length;

    if (subscribers === 0) {
      actionItems.push({
        id: `audience-${territory.id}`,
        severity: "warning",
        territoryId: territory.id,
        title: "Territory has no active subscribers",
        source: "audience"
      });
    }

    if (upcomingNewsletterSends === 0) {
      actionItems.push({
        id: `newsletter-${territory.id}`,
        severity: "info",
        territoryId: territory.id,
        title: "No upcoming newsletter send scheduled",
        source: "newsletter"
      });
    }
  }

  return {
    analytics,
    actionItems,
    territoryHealth: territories.map((territory) => ({
      territoryId: territory.id,
      subscribers: data.subscriptions.filter((subscription) => subscription.territoryId === territory.id && subscription.status === "subscribed" && !subscription.deletedAt).length,
      upcomingNewsletterSends: data.emailCampaigns.filter((campaign) => campaign.territoryId === territory.id && campaign.status === "scheduled" && !campaign.deletedAt).length,
      activeJourneys: data.journeys.filter((journey) => journey.status === "active" && (!journey.territoryId || journey.territoryId === territory.id) && !journey.deletedAt).length,
      failedJourneyRuns: data.journeyExecutions.filter((execution) => {
        const entry = data.journeyAudienceEntries.find((candidate) => candidate.id === execution.entryId);
        return execution.status === "failed" && entry?.territoryId === territory.id;
      }).length,
      scheduledSocial: data.socialPublications.filter((publication) => publication.territoryId === territory.id && publication.publishState === "scheduled" && !publication.deletedAt).length
    }))
  };
}

export function listNewsletterFactory(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData
): NewsletterFactoryOverview {
  requireMarketingPermission(context, permissions, "newsletterFactoryView");
  const visibleTerritoryIds = visibleTerritories(context, data);
  const editions = data.territoryNewsletterEditions
    .filter((edition) => !edition.deletedAt)
    .filter((edition) => visibleTerritoryIds == null || visibleTerritoryIds.has(edition.territoryId));
  const masterIds = new Set(editions.map((edition) => edition.masterId));
  const masters = data.networkNewsletterMasters
    .filter((master) => !master.deletedAt)
    .filter((master) => visibleTerritoryIds == null || masterIds.has(master.id));
  const runs = data.newsletterFactoryRuns
    .filter((run) => masters.some((master) => master.id === run.masterId))
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));

  return {
    masters,
    editions,
    runs,
    totals: {
      masters: masters.length,
      editions: editions.length,
      ready: editions.filter((edition) => edition.status === "ready").length,
      needsReview: editions.filter((edition) => edition.status === "needs_review").length,
      blocked: editions.filter((edition) => edition.status === "blocked").length
    }
  };
}

export function listJourneys(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData
): MarketingJourneyOverview {
  requireMarketingPermission(context, permissions, "journeyView");
  const visibleTerritoryIds = visibleTerritories(context, data);
  const journeys = data.journeys
    .filter((journey) => !journey.deletedAt)
    .filter((journey) => visibleTerritoryIds == null || !journey.territoryId || visibleTerritoryIds.has(journey.territoryId))
    .map((journey) => {
      const activeVersion = data.journeyVersions
        .filter((version) => version.journeyId === journey.id && version.status === "approved" && !version.deletedAt)
        .sort((left, right) => right.versionNumber - left.versionNumber)[0];
      const entries = data.journeyAudienceEntries.filter((entry) => entry.journeyId === journey.id).length;
      const activeExecutions = data.journeyExecutions.filter((execution) => execution.journeyId === journey.id && execution.status === "queued").length;
      const failedExecutions = data.journeyExecutions.filter((execution) => execution.journeyId === journey.id && execution.status === "failed").length;
      return { journey, activeVersion, entries, activeExecutions, failedExecutions };
    });
  return {
    journeys,
    totals: {
      journeys: journeys.length,
      active: journeys.filter((view) => view.journey.status === "active").length,
      paused: journeys.filter((view) => view.journey.status === "paused").length,
      failedExecutions: journeys.reduce((total, view) => total + view.failedExecutions, 0)
    }
  };
}

export function getJourneyDetail(context: MarketingActorContext, permissions: PermissionData, data: MarketingData, journeyId: string) {
  requireMarketingPermission(context, permissions, "journeyView");
  const journey = requireJourney(data, journeyId);
  if (journey.territoryId) ensureContextCanAccessTerritory(context, journey.territoryId);
  const latestVersion = data.journeyVersions
    .filter((version) => version.journeyId === journey.id && !version.deletedAt)
    .sort((left, right) => right.versionNumber - left.versionNumber)[0];
  const entries = data.journeyAudienceEntries.filter((entry) => entry.journeyId === journey.id).length;
  const activeExecutions = data.journeyExecutions.filter((execution) => execution.journeyId === journey.id && execution.status === "queued").length;
  const failedExecutions = data.journeyExecutions.filter((execution) => execution.journeyId === journey.id && execution.status === "failed").length;
  return { journey, latestVersion, entries, activeExecutions, failedExecutions };
}

export async function upsertAudienceContact(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  contact: AudienceContact
) {
  requireMarketingPermission(context, permissions, "audienceManage");
  const emailNormalised = normaliseEmail(contact.email);
  const existing = data.contacts.find((candidate) => candidate.emailNormalised === emailNormalised && !candidate.deletedAt);
  if (existing) {
    Object.assign(existing, {
      firstName: contact.firstName ?? existing.firstName,
      lastName: contact.lastName ?? existing.lastName,
      tags: [...new Set([...existing.tags, ...contact.tags])],
      metadata: { ...existing.metadata, ...contact.metadata }
    });
    await audit.record(auditEvent(context, auditActions.marketingAudienceContactUpdate, existing, {
      deduped: true
    }));
    return existing;
  }
  const created = {
    ...contact,
    emailNormalised
  };
  data.contacts.push(created);
  await audit.record(auditEvent(context, auditActions.marketingAudienceContactCreate, created, {
    source: created.metadata.source ?? "unknown"
  }));
  return created;
}

export async function subscribeContactToTerritory(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  subscription: AudienceTerritorySubscription
) {
  requireMarketingPermission(context, permissions, "audienceManage");
  ensureContextCanAccessTerritory(context, subscription.territoryId);
  requireContact(data, subscription.contactId);
  const existing = data.subscriptions.find((candidate) => candidate.contactId === subscription.contactId && candidate.territoryId === subscription.territoryId && !candidate.deletedAt);
  if (existing) {
    Object.assign(existing, {
      status: subscription.status,
      preferences: subscription.preferences,
      unsubscribedAt: subscription.unsubscribedAt
    });
    return existing;
  }
  data.subscriptions.push(subscription);
  await audit.record(auditEvent(context, auditActions.marketingAudienceSubscribe, requireContact(data, subscription.contactId), {
    territoryId: subscription.territoryId,
    status: subscription.status
  }, subscription.territoryId));
  return subscription;
}

export async function recordConsentEvent(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  consent: AudienceConsentEvent
) {
  requireMarketingPermission(context, permissions, "consentManage");
  if (consent.territoryId) {
    ensureContextCanAccessTerritory(context, consent.territoryId);
  }
  const contact = requireContact(data, consent.contactId);
  data.consentEvents.push(consent);
  await audit.record(auditEvent(context, auditActions.marketingConsentRecord, contact, {
    consentType: consent.consentType,
    action: consent.action,
    source: consent.source
  }, consent.territoryId));
  return consent;
}

export async function suppressContact(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  suppression: AudienceSuppression
) {
  requireMarketingPermission(context, permissions, "consentManage");
  if (suppression.territoryId) {
    ensureContextCanAccessTerritory(context, suppression.territoryId);
  }
  const contact = requireContact(data, suppression.contactId);
  data.suppressions.push(suppression);
  contact.emailStatus = "suppressed";
  await audit.record(auditEvent(context, auditActions.marketingAudienceSuppress, contact, {
    reason: suppression.reason,
    territoryId: suppression.territoryId ?? null
  }, suppression.territoryId));
  return suppression;
}

export function generateUnsubscribeToken(secret: string, contactId: string, campaignId: string) {
  return createHmac("sha256", secret).update(`${contactId}:${campaignId}`).digest("hex");
}

export function verifyUnsubscribeToken(secret: string, contactId: string, campaignId: string, token: string) {
  const expected = Buffer.from(generateUnsubscribeToken(secret, contactId, campaignId), "hex");
  const supplied = Buffer.from(token, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function unsubscribeContactPublicly(
  data: { contacts: AudienceContact[]; suppressions: AudienceSuppression[] },
  input: { contactId: string; campaignId: string }
) {
  const contact = data.contacts.find((candidate) => candidate.id === input.contactId && !candidate.deletedAt);

  if (!contact) {
    return undefined;
  }

  const existing = data.suppressions.find(
    (candidate) => candidate.contactId === contact.id && candidate.active && candidate.reason === "recipient_unsubscribe"
  );

  if (existing) {
    return { contact, suppression: existing };
  }

  const suppression: AudienceSuppression = {
    id: randomUUID(),
    contactId: contact.id,
    emailNormalised: contact.emailNormalised,
    territoryId: null,
    reason: "recipient_unsubscribe",
    source: "public_unsubscribe_link",
    active: true,
    suppressedAt: new Date().toISOString(),
    metadata: { campaignId: input.campaignId }
  };
  data.suppressions.push(suppression);
  contact.emailStatus = "suppressed";
  return { contact, suppression };
}

export function listSegments(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData
): AudienceSegment[] {
  requireMarketingPermission(context, permissions, "segmentView");
  const visibleTerritoryIds = visibleTerritories(context, data);
  return data.segments
    .filter((segment) => !segment.deletedAt)
    .filter((segment) => visibleTerritoryIds == null || !segment.territoryId || visibleTerritoryIds.has(segment.territoryId));
}

export function previewSegment(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData,
  segmentId: string
): AudienceContactView[] {
  requireMarketingPermission(context, permissions, "segmentView");
  const segment = requireSegment(data, segmentId);
  if (segment.territoryId) {
    ensureContextCanAccessTerritory(context, segment.territoryId);
  }
  const audience = listAudienceContacts(context, permissions, data).contacts;
  return audience.filter((view) => contactMatchesSegment(view, segment));
}

/**
 * Live preview for the segment-builder UI: evaluates an in-progress rule
 * definition that may not be persisted yet, so — unlike previewSegment —
 * it doesn't require an existing segment row.
 */
export function previewSegmentDefinition(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData,
  input: { territoryId?: string | null; definition: Record<string, unknown> }
): AudienceContactView[] {
  requireMarketingPermission(context, permissions, "segmentView");
  if (input.territoryId) {
    ensureContextCanAccessTerritory(context, input.territoryId);
  }
  const audience = listAudienceContacts(context, permissions, data).contacts;
  const root = normalizeSegmentDefinition(input.definition, input.territoryId);
  return audience.filter((view) => !view.suppressions.some((suppression) => suppression.active) && evaluateSegmentRules(view, root));
}

export async function createSegment(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  input: { id: string; key: string; name: string; territoryId?: string | null; definition: unknown }
): Promise<AudienceSegment> {
  requireMarketingPermission(context, permissions, "segmentManage");
  if (input.territoryId) {
    ensureContextCanAccessTerritory(context, input.territoryId);
  }
  if (data.segments.some((segment) => segment.key === input.key && !segment.deletedAt)) {
    throw new Error("A segment with this key already exists.");
  }
  const root = validateSegmentDefinition(input.definition);
  const segment: AudienceSegment = {
    id: input.id,
    territoryId: input.territoryId ?? null,
    key: input.key,
    name: input.name,
    segmentType: "dynamic",
    definition: { version: 1, root },
    status: "active"
  };
  data.segments.push(segment);
  await audit.record(marketingAuditEvent(
    context,
    auditActions.marketingSegmentCreate,
    "audience_segment",
    segment.id,
    { key: segment.key, territoryId: segment.territoryId },
    segment.territoryId
  ));
  return segment;
}

export async function updateSegment(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  segmentId: string,
  input: { name?: string; definition?: unknown }
): Promise<AudienceSegment> {
  requireMarketingPermission(context, permissions, "segmentManage");
  const segment = requireSegment(data, segmentId);
  if (segment.territoryId) {
    ensureContextCanAccessTerritory(context, segment.territoryId);
  }
  if (segment.segmentType !== "dynamic") {
    throw new Error("Only dynamic segments can be edited here.");
  }
  if (input.name) {
    segment.name = input.name;
  }
  if (input.definition !== undefined) {
    const root = validateSegmentDefinition(input.definition);
    segment.definition = { version: 1, root };
  }
  await audit.record(marketingAuditEvent(
    context,
    auditActions.marketingSegmentUpdate,
    "audience_segment",
    segment.id,
    { key: segment.key },
    segment.territoryId
  ));
  return segment;
}

export async function createEmailTemplate(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  template: EmailTemplate
) {
  requireMarketingPermission(context, permissions, "emailCreate");
  data.emailTemplates.push(template);
  await audit.record(marketingAuditEvent(context, auditActions.marketingEmailTemplateCreate, "email_template", template.id, {
    key: template.key,
    templateType: template.templateType
  }, null));
  return template;
}

export async function createEmailCampaign(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  campaign: EmailCampaign,
  version: EmailCampaignVersion
) {
  requireMarketingPermission(context, permissions, "emailCreate");
  ensureCampaignAccess(context, campaign);
  if (campaign.templateId && !data.emailTemplates.some((template) => template.id === campaign.templateId && !template.deletedAt)) {
    throw new Error("Email template was not found.");
  }
  if (campaign.sendProvider === "microsoft" && !campaign.sendConnectionId) {
    throw new Error("A connected Outlook mailbox is required to send via Outlook.");
  }
  if (version.campaignId !== campaign.id || version.versionNumber !== 1) {
    throw new Error("Initial campaign version must belong to the campaign and start at version 1.");
  }
  data.emailCampaigns.push(campaign);
  data.emailCampaignVersions.push(version);
  await audit.record(marketingAuditEvent(context, auditActions.marketingEmailCampaignCreate, "email_campaign", campaign.id, {
    campaignType: campaign.campaignType,
    territoryId: campaign.territoryId ?? null
  }, campaign.territoryId));
  return campaign;
}

export async function createEmailCampaignVersion(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  campaignId: string,
  version: EmailCampaignVersion
) {
  requireMarketingPermission(context, permissions, "emailCreate");
  const campaign = requireCampaign(data, campaignId);
  ensureCampaignAccess(context, campaign);
  if (campaign.status !== "draft") {
    throw new Error("Additional variants can only be added to a draft campaign.");
  }
  if (version.campaignId !== campaign.id) {
    throw new Error("Campaign version does not belong to campaign.");
  }
  if (version.variantKey !== "a" && version.variantKey !== "b") {
    throw new Error("A new campaign version must declare variant \"a\" or \"b\".");
  }
  const siblings = data.emailCampaignVersions.filter((candidate) => candidate.campaignId === campaign.id && !candidate.deletedAt);
  if (siblings.some((sibling) => sibling.variantKey === version.variantKey)) {
    throw new Error(`Campaign already has a variant "${version.variantKey}".`);
  }
  const maxVersionNumber = siblings.reduce((max, sibling) => Math.max(max, sibling.versionNumber), 0);
  if (version.versionNumber !== maxVersionNumber + 1) {
    throw new Error("Campaign version number must follow the existing versions.");
  }
  data.emailCampaignVersions.push(version);
  await audit.record(marketingAuditEvent(context, auditActions.marketingEmailCampaignVersionCreate, "email_campaign", campaign.id, {
    versionId: version.id,
    variantKey: version.variantKey
  }, campaign.territoryId));
  return version;
}

export async function approveEmailCampaignVersion(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  campaignId: string,
  versionId: string,
  approvedAt: string
) {
  requireMarketingPermission(context, permissions, "emailApprove");
  const campaign = requireCampaign(data, campaignId);
  ensureCampaignAccess(context, campaign);
  const version = requireCampaignVersion(data, versionId);
  if (version.campaignId !== campaign.id) {
    throw new Error("Campaign version does not belong to campaign.");
  }
  version.status = "approved";
  version.approvedByUserId = context.userId;
  version.approvedAt = approvedAt;
  campaign.status = "approved";
  campaign.approvedAt = approvedAt;
  await audit.record(marketingAuditEvent(context, auditActions.marketingEmailCampaignApprove, "email_campaign", campaign.id, {
    versionId
  }, campaign.territoryId));
  return version;
}

export async function createRecipientSnapshot(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  snapshot: Omit<EmailRecipientSnapshot, "recipientCount" | "excludedCount" | "recipients" | "exclusions"> & {
    restrictToContactIds?: string[];
    heldOutExclusionReason?: string;
  }
) {
  requireMarketingPermission(context, permissions, "emailSchedule");
  const existing = data.emailRecipientSnapshots.find((candidate) => candidate.idempotencyKey === snapshot.idempotencyKey);
  if (existing) {
    return existing;
  }
  const campaign = requireCampaign(data, snapshot.campaignId);
  ensureCampaignAccess(context, campaign);
  const version = requireCampaignVersion(data, snapshot.campaignVersionId);
  if (version.status !== "approved" && version.status !== "testing") {
    throw new Error("Only approved or in-test campaign versions can create recipient snapshots.");
  }
  const { restrictToContactIds, heldOutExclusionReason, ...snapshotInput } = snapshot;
  const segmentId = snapshot.segmentId ?? campaign.segmentId ?? null;
  if (!segmentId && !restrictToContactIds) {
    throw new Error("Campaign requires an audience segment before scheduling.");
  }
  // A journey step has no segment of its own to snapshot against - when the
  // caller already knows exactly who should receive this (restrictToContactIds)
  // and no segment is available, resolve those contacts directly instead of
  // requiring a persisted segment. contactMatchesSegment's only non-rule-tree
  // behaviour is excluding active suppressions, so replicate that here too.
  const segmentContacts = segmentId
    ? previewSegment(context, permissions, data, segmentId)
    : listAudienceContacts(context, permissions, data).contacts.filter((view) => !view.suppressions.some((suppression) => suppression.active));
  const allowlist = restrictToContactIds ? new Set(restrictToContactIds) : null;
  const eligibleContacts = allowlist ? segmentContacts.filter((view) => allowlist.has(view.contact.id)) : segmentContacts;
  const hiddenBlockIdsByContactId = resolveHiddenBlockIdsByContact(context, data, campaign, version, eligibleContacts);
  const recipients = eligibleContacts.map((view) => ({
    contactId: view.contact.id,
    emailNormalised: view.contact.emailNormalised,
    firstName: view.contact.firstName ?? null,
    lastName: view.contact.lastName ?? null,
    territoryIds: view.subscriptions.map((subscription) => subscription.territoryId),
    // Per-segment dynamic content blocks: which of this version's gated block
    // ids this specific recipient should not see, baked in at snapshot time
    // (see resolveHiddenBlockIdsByContact). Omitted entirely when the version
    // has no gated blocks, so this is a byte-for-byte no-op for every
    // pre-existing campaign.
    ...(hiddenBlockIdsByContactId ? { hiddenBlockIds: hiddenBlockIdsByContactId.get(view.contact.id) ?? [] } : {})
  }));
  const allContactIds = new Set(data.contacts.map((contact) => contact.id));
  const recipientIds = new Set(recipients.map((recipient) => recipient.contactId));
  const heldOutIds = allowlist
    ? new Set(segmentContacts.filter((view) => !allowlist.has(view.contact.id)).map((view) => view.contact.id))
    : new Set<string>();
  const exclusions = [...allContactIds]
    .filter((contactId) => !recipientIds.has(contactId))
    .map((contactId) => ({
      contactId,
      reason: heldOutIds.has(contactId) ? (heldOutExclusionReason ?? "held_out_for_ab_test") : "not_eligible_or_suppressed"
    }));
  const created: EmailRecipientSnapshot = {
    ...snapshotInput,
    segmentId,
    recipientCount: recipients.length,
    excludedCount: exclusions.length,
    recipients,
    exclusions
  };
  data.emailRecipientSnapshots.push(created);
  await audit.record(marketingAuditEvent(context, auditActions.marketingEmailRecipientSnapshotCreate, "email_recipient_snapshot", created.id, {
    campaignId: campaign.id,
    recipientCount: created.recipientCount,
    excludedCount: created.excludedCount
  }, campaign.territoryId));
  return created;
}

export async function scheduleEmailCampaign(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  campaignId: string,
  scheduledAt: string
) {
  requireMarketingPermission(context, permissions, "emailSchedule");
  const campaign = requireCampaign(data, campaignId);
  ensureCampaignAccess(context, campaign);
  if (campaign.status !== "approved") {
    throw new Error("Only approved email campaigns can be scheduled.");
  }
  campaign.status = "scheduled";
  campaign.scheduledAt = scheduledAt;
  await audit.record(marketingAuditEvent(context, auditActions.marketingEmailCampaignSchedule, "email_campaign", campaign.id, {
    scheduledAt
  }, campaign.territoryId));
  return campaign;
}

export const MICROSOFT_SEND_RECIPIENT_CAP = 200;

export function enqueueEmailSend(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData,
  input: {
    id: string;
    campaignId: string;
    batchSize?: number;
    campaignVersionId?: string;
    recipientSnapshotId?: string;
    nextAttemptAt?: string;
  }
): EmailSendJob {
  requireMarketingPermission(context, permissions, "emailSchedule");
  const campaign = requireCampaign(data, input.campaignId);
  ensureCampaignAccess(context, campaign);

  if (campaign.sendProvider === "microsoft" && !campaign.sendConnectionId) {
    throw new Error("Campaign is set to send via Outlook but has no connected mailbox.");
  }

  const explicitTarget = Boolean(input.campaignVersionId);

  if (!explicitTarget && campaign.status !== "scheduled") {
    throw new Error("Only scheduled campaigns can be queued for sending.");
  }

  const version = input.campaignVersionId
    ? requireCampaignVersion(data, input.campaignVersionId)
    : data.emailCampaignVersions
        .filter((candidate) => candidate.campaignId === campaign.id && candidate.status === "approved" && !candidate.deletedAt)
        .sort((left, right) => right.versionNumber - left.versionNumber)[0];

  if (!version) {
    throw new Error("Campaign has no approved version to send.");
  }
  if (version.campaignId !== campaign.id) {
    throw new Error("Campaign version does not belong to campaign.");
  }

  const existingJob = data.emailSendJobs.find(
    (job) =>
      job.campaignId === campaign.id &&
      job.campaignVersionId === version.id &&
      (input.recipientSnapshotId ? job.recipientSnapshotId === input.recipientSnapshotId : true) &&
      (job.status === "queued" || job.status === "processing")
  );

  if (existingJob) {
    return existingJob;
  }

  const snapshot = input.recipientSnapshotId
    ? requireRecipientSnapshot(data, input.recipientSnapshotId)
    : data.emailRecipientSnapshots
        .filter((candidate) => candidate.campaignId === campaign.id && candidate.campaignVersionId === version.id)
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];

  if (!snapshot) {
    throw new Error("Campaign has no recipient snapshot to send.");
  }
  if (snapshot.campaignId !== campaign.id || snapshot.campaignVersionId !== version.id) {
    throw new Error("Recipient snapshot does not belong to this campaign version.");
  }

  if (campaign.sendProvider === "microsoft" && snapshot.recipientCount > MICROSOFT_SEND_RECIPIENT_CAP) {
    throw new Error(
      `Outlook sending is limited to ${MICROSOFT_SEND_RECIPIENT_CAP} recipients or fewer (this campaign has ${snapshot.recipientCount}). Use the network email provider for larger sends.`
    );
  }

  const job: EmailSendJob = {
    id: input.id,
    campaignId: campaign.id,
    campaignVersionId: version.id,
    recipientSnapshotId: snapshot.id,
    sendProvider: campaign.sendProvider,
    sendConnectionId: campaign.sendConnectionId ?? null,
    status: "queued",
    cursor: 0,
    batchSize: input.batchSize ?? (campaign.sendProvider === "microsoft" ? 10 : 100),
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: input.nextAttemptAt ?? campaign.scheduledAt ?? new Date().toISOString()
  };
  data.emailSendJobs.push(job);
  return job;
}

const DEFAULT_AB_TEST_SAMPLE_FRACTION = 0.2;

/** Deterministic [0,1) hash of a string, so the same key always lands in the same bucket. */
function stableUnitInterval(key: string): number {
  const digest = createHash("sha256").update(key).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export function splitSegmentForAbTest(
  segmentContacts: AudienceContactView[],
  input: { sampleFraction?: number } = {}
): { variantAContactIds: string[]; variantBContactIds: string[]; remainderContactIds: string[] } {
  const sampleFraction = input.sampleFraction ?? DEFAULT_AB_TEST_SAMPLE_FRACTION;
  const sampled = segmentContacts.filter((view) => stableUnitInterval(view.contact.id) < sampleFraction);
  const variantAContactIds: string[] = [];
  const variantBContactIds: string[] = [];
  for (const view of sampled) {
    (stableUnitInterval(`${view.contact.id}:ab`) < 0.5 ? variantAContactIds : variantBContactIds).push(view.contact.id);
  }
  const sampledIds = new Set([...variantAContactIds, ...variantBContactIds]);
  const remainderContactIds = segmentContacts
    .filter((view) => !sampledIds.has(view.contact.id))
    .map((view) => view.contact.id);
  return { variantAContactIds, variantBContactIds, remainderContactIds };
}

const DEFAULT_SEND_TIME_OPTIMIZATION_HOUR = 9;

/**
 * For each contact, the UTC hour-of-day (0-23) they most often open/click a
 * campaign email, based on data.emailDeliveryRecords. Contacts with no
 * opened/clicked history get input.defaultHour. Ties are broken toward the
 * lowest hour for determinism.
 *
 * No timezone data exists anywhere in this app (not on AudienceContact, not
 * on territories) - this is a raw UTC hour, not a local-time hour. It's the
 * best signal available, not a per-contact-timezone-corrected one.
 */
export function computeContactEngagementHours(
  data: MarketingData,
  contactIds: string[],
  input: { defaultHour?: number } = {}
): Record<string, number> {
  const defaultHour = input.defaultHour ?? DEFAULT_SEND_TIME_OPTIMIZATION_HOUR;
  const contactIdSet = new Set(contactIds);
  const hourCountsByContact = new Map<string, number[]>();

  for (const delivery of data.emailDeliveryRecords) {
    if (delivery.deletedAt) continue;
    if (delivery.eventType !== "opened" && delivery.eventType !== "clicked") continue;
    if (!delivery.contactId || !contactIdSet.has(delivery.contactId) || !delivery.eventAt) continue;
    const hour = new Date(delivery.eventAt).getUTCHours();
    const counts = hourCountsByContact.get(delivery.contactId) ?? new Array(24).fill(0);
    counts[hour] += 1;
    hourCountsByContact.set(delivery.contactId, counts);
  }

  const result: Record<string, number> = {};
  for (const contactId of contactIds) {
    const counts = hourCountsByContact.get(contactId);
    if (!counts) {
      result[contactId] = defaultHour;
      continue;
    }
    let bestHour = 0;
    let bestCount = -1;
    for (let hour = 0; hour < 24; hour += 1) {
      if (counts[hour]! > bestCount) {
        bestCount = counts[hour]!;
        bestHour = hour;
      }
    }
    result[contactId] = bestHour;
  }
  return result;
}

/**
 * The next UTC instant at or after `anchor` whose hour-of-day equals `hour`
 * (minutes/seconds/ms zeroed). Never returns an instant before `anchor` -
 * this is what lets a campaign's scheduledAt act as a hard floor: no bucket
 * fires earlier than the campaign's chosen launch time, even if that
 * bucket's best hour is earlier in the clock than anchor's minute-of-hour.
 */
export function nextOccurrenceOfHour(anchor: Date, hour: number): Date {
  const candidate = new Date(anchor);
  candidate.setUTCHours(hour, 0, 0, 0);
  if (candidate.getTime() < anchor.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

function requireVariantPair(data: MarketingData, campaignId: string) {
  const variants = data.emailCampaignVersions.filter(
    (candidate) => candidate.campaignId === campaignId && !candidate.deletedAt && (candidate.variantKey === "a" || candidate.variantKey === "b")
  );
  const variantA = variants.find((candidate) => candidate.variantKey === "a");
  const variantB = variants.find((candidate) => candidate.variantKey === "b");
  if (!variantA || !variantB) {
    throw new Error("Campaign does not have both an \"a\" and a \"b\" subject-line variant.");
  }
  return { variantA, variantB };
}

export async function startSubjectLineTest(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  input: { campaignId: string; sampleFraction?: number; startedAt: string; snapshotIdA: string; snapshotIdB: string; jobIdA: string; jobIdB: string }
) {
  requireMarketingPermission(context, permissions, "emailApprove");
  const campaign = requireCampaign(data, input.campaignId);
  ensureCampaignAccess(context, campaign);
  if (campaign.status !== "draft") {
    throw new Error("Only draft campaigns can start a subject-line test.");
  }
  if (!campaign.segmentId) {
    throw new Error("Campaign requires an audience segment before starting a test.");
  }
  const { variantA, variantB } = requireVariantPair(data, campaign.id);
  if (variantA.status !== "draft" || variantB.status !== "draft") {
    throw new Error("Both subject-line variants must be in draft status to start a test.");
  }

  const segmentContacts = previewSegment(context, permissions, data, campaign.segmentId);
  const split = splitSegmentForAbTest(segmentContacts, { sampleFraction: input.sampleFraction });

  variantA.status = "testing";
  variantA.approvedByUserId = context.userId;
  variantA.approvedAt = input.startedAt;
  variantB.status = "testing";
  variantB.approvedByUserId = context.userId;
  variantB.approvedAt = input.startedAt;
  campaign.status = "testing";
  campaign.metadata = {
    ...campaign.metadata,
    abTest: {
      sampleFraction: input.sampleFraction ?? DEFAULT_AB_TEST_SAMPLE_FRACTION,
      variantAContactIds: split.variantAContactIds,
      variantBContactIds: split.variantBContactIds,
      startedAt: input.startedAt,
      startedByUserId: context.userId
    } satisfies EmailCampaignAbTestMetadata
  };

  const snapshotA = await createRecipientSnapshot(context, permissions, audit, data, {
    id: input.snapshotIdA,
    campaignId: campaign.id,
    campaignVersionId: variantA.id,
    segmentId: campaign.segmentId,
    status: "created",
    generatedAt: input.startedAt,
    idempotencyKey: `${campaign.id}:${variantA.id}:sample`,
    variantKey: "a",
    restrictToContactIds: split.variantAContactIds
  });
  const snapshotB = await createRecipientSnapshot(context, permissions, audit, data, {
    id: input.snapshotIdB,
    campaignId: campaign.id,
    campaignVersionId: variantB.id,
    segmentId: campaign.segmentId,
    status: "created",
    generatedAt: input.startedAt,
    idempotencyKey: `${campaign.id}:${variantB.id}:sample`,
    variantKey: "b",
    restrictToContactIds: split.variantBContactIds
  });

  const jobA = enqueueEmailSend(context, permissions, data, {
    id: input.jobIdA,
    campaignId: campaign.id,
    campaignVersionId: variantA.id,
    recipientSnapshotId: snapshotA.id
  });
  const jobB = enqueueEmailSend(context, permissions, data, {
    id: input.jobIdB,
    campaignId: campaign.id,
    campaignVersionId: variantB.id,
    recipientSnapshotId: snapshotB.id
  });

  await audit.record(marketingAuditEvent(context, auditActions.marketingSubjectLineTestStart, "email_campaign", campaign.id, {
    variantAVersionId: variantA.id,
    variantBVersionId: variantB.id,
    sampleFraction: input.sampleFraction ?? DEFAULT_AB_TEST_SAMPLE_FRACTION
  }, campaign.territoryId));

  return { campaign, variantA, variantB, snapshotA, snapshotB, jobA, jobB };
}

export function compareSubjectLineVariants(
  context: MarketingActorContext,
  permissions: PermissionData,
  data: MarketingData,
  campaignId: string
) {
  requireMarketingPermission(context, permissions, "emailView");
  const campaign = requireCampaign(data, campaignId);
  ensureCampaignAccess(context, campaign);
  const { variantA, variantB } = requireVariantPair(data, campaign.id);

  const variantSummary = (version: EmailCampaignVersion) => {
    const deliveries = data.emailDeliveryRecords.filter((delivery) => delivery.campaignVersionId === version.id && !delivery.deletedAt);
    const delivered = new Set(
      deliveries.filter((delivery) => delivery.eventType === "delivered").map((delivery) => delivery.contactId ?? delivery.emailNormalised)
    ).size;
    const opened = new Set(
      deliveries.filter((delivery) => delivery.eventType === "opened").map((delivery) => delivery.contactId ?? delivery.emailNormalised)
    ).size;
    const snapshot = data.emailRecipientSnapshots
      .filter((candidate) => candidate.campaignVersionId === version.id)
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
    return {
      version,
      snapshot,
      sent: new Set(deliveries.map((delivery) => delivery.contactId ?? delivery.emailNormalised)).size,
      delivered,
      opened,
      openRate: delivered > 0 ? opened / delivered : null
    };
  };

  const variants = [variantSummary(variantA), variantSummary(variantB)];
  const canDeclareWinner = variants.every((variant) => variant.delivered > 0) && variantA.status === "testing" && variantB.status === "testing";

  return { campaign, variants, canDeclareWinner };
}

export async function declareSubjectLineWinner(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  input: { campaignId: string; winningVersionId: string; decidedAt: string }
) {
  requireMarketingPermission(context, permissions, "emailApprove");
  const campaign = requireCampaign(data, input.campaignId);
  ensureCampaignAccess(context, campaign);
  if (campaign.status !== "testing") {
    throw new Error("Only campaigns with a running subject-line test can declare a winner.");
  }
  const { variantA, variantB } = requireVariantPair(data, campaign.id);
  const winner = [variantA, variantB].find((candidate) => candidate.id === input.winningVersionId);
  if (!winner) {
    throw new Error("Winning version does not belong to this campaign's subject-line test.");
  }
  const loser = winner.id === variantA.id ? variantB : variantA;

  winner.status = "approved";
  winner.approvedByUserId = context.userId;
  winner.approvedAt = input.decidedAt;
  loser.status = "rejected";

  campaign.status = "approved";
  campaign.approvedAt = input.decidedAt;
  const abTest = (campaign.metadata.abTest ?? {}) as EmailCampaignAbTestMetadata;
  campaign.metadata = {
    ...campaign.metadata,
    abTest: {
      ...abTest,
      winnerVersionId: winner.id,
      decidedAt: input.decidedAt,
      decidedByUserId: context.userId
    } satisfies EmailCampaignAbTestMetadata
  };

  await audit.record(marketingAuditEvent(context, auditActions.marketingSubjectLineTestDeclareWinner, "email_campaign", campaign.id, {
    winnerVersionId: winner.id,
    loserVersionId: loser.id
  }, campaign.territoryId));

  return { campaign, winner, loser };
}

export async function createWinnerRemainderSnapshot(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  input: { campaignId: string; id: string; generatedAt: string }
) {
  const campaign = requireCampaign(data, input.campaignId);
  ensureCampaignAccess(context, campaign);
  if (campaign.status !== "approved") {
    throw new Error("The subject-line test must have a declared winner before sending to the remainder.");
  }
  const abTest = campaign.metadata.abTest as EmailCampaignAbTestMetadata | undefined;
  if (!abTest || !abTest.winnerVersionId) {
    throw new Error("This campaign has no subject-line test to send a remainder for.");
  }
  if (!campaign.segmentId) {
    throw new Error("Campaign requires an audience segment before scheduling.");
  }

  const winner = requireCampaignVersion(data, abTest.winnerVersionId);
  const segmentContacts = previewSegment(context, permissions, data, campaign.segmentId);
  const testedIds = new Set([...abTest.variantAContactIds, ...abTest.variantBContactIds]);
  const remainderContactIds = segmentContacts
    .filter((view) => !testedIds.has(view.contact.id))
    .map((view) => view.contact.id);

  return createRecipientSnapshot(context, permissions, audit, data, {
    id: input.id,
    campaignId: campaign.id,
    campaignVersionId: winner.id,
    segmentId: campaign.segmentId,
    status: "created",
    generatedAt: input.generatedAt,
    idempotencyKey: `${campaign.id}:${winner.id}:remainder`,
    variantKey: "remainder",
    restrictToContactIds: remainderContactIds,
    heldOutExclusionReason: "already_sent_ab_test_sample"
  });
}

export async function enqueueSendTimeOptimizedSend(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  input: { campaignId: string; scheduledAt: string; defaultHour?: number }
): Promise<{
  campaign: EmailCampaign;
  version: EmailCampaignVersion;
  snapshots: EmailRecipientSnapshot[];
  jobs: EmailSendJob[];
}> {
  requireMarketingPermission(context, permissions, "emailSchedule");
  const campaign = requireCampaign(data, input.campaignId);
  ensureCampaignAccess(context, campaign);
  if (campaign.status !== "scheduled") {
    throw new Error("Only scheduled campaigns can be queued for send-time-optimized sending.");
  }
  if (!campaign.segmentId) {
    throw new Error("Campaign requires an audience segment before scheduling.");
  }
  const version = data.emailCampaignVersions
    .filter((candidate) => candidate.campaignId === campaign.id && candidate.status === "approved" && !candidate.deletedAt)
    .sort((left, right) => right.versionNumber - left.versionNumber)[0];
  if (!version) {
    throw new Error("Campaign has no approved version to send.");
  }

  const segmentContacts = previewSegment(context, permissions, data, campaign.segmentId);
  const contactIds = segmentContacts.map((view) => view.contact.id);
  if (contactIds.length === 0) {
    throw new Error("Campaign audience segment has no eligible recipients to schedule.");
  }
  const bestHours = computeContactEngagementHours(data, contactIds, { defaultHour: input.defaultHour });

  const buckets = new Map<number, string[]>();
  for (const contactId of contactIds) {
    const hour = bestHours[contactId]!;
    const bucket = buckets.get(hour);
    if (bucket) {
      bucket.push(contactId);
    } else {
      buckets.set(hour, [contactId]);
    }
  }

  const anchor = new Date(input.scheduledAt);
  const bucketHours = [...buckets.keys()].sort((left, right) => left - right);
  const snapshots: EmailRecipientSnapshot[] = [];
  const jobs: EmailSendJob[] = [];

  for (const hour of bucketHours) {
    const bucketContactIds = buckets.get(hour)!;
    const snapshot = await createRecipientSnapshot(context, permissions, audit, data, {
      id: randomUUID(),
      campaignId: campaign.id,
      campaignVersionId: version.id,
      segmentId: campaign.segmentId,
      status: "created",
      generatedAt: input.scheduledAt,
      idempotencyKey: `${campaign.id}:${version.id}:sto:${hour}`,
      variantKey: "sto",
      restrictToContactIds: bucketContactIds,
      heldOutExclusionReason: "scheduled_in_different_send_time_bucket"
    });
    snapshots.push(snapshot);

    const job = enqueueEmailSend(context, permissions, data, {
      id: randomUUID(),
      campaignId: campaign.id,
      campaignVersionId: version.id,
      recipientSnapshotId: snapshot.id,
      nextAttemptAt: nextOccurrenceOfHour(anchor, hour).toISOString()
    });
    jobs.push(job);
  }

  campaign.metadata = {
    ...campaign.metadata,
    sto: {
      enabled: true,
      defaultHour: input.defaultHour ?? DEFAULT_SEND_TIME_OPTIMIZATION_HOUR,
      bucketHours,
      startedAt: input.scheduledAt,
      startedByUserId: context.userId
    } satisfies EmailCampaignSendTimeOptimizationMetadata
  };

  await audit.record(marketingAuditEvent(context, auditActions.marketingSendTimeOptimizationSchedule, "email_campaign", campaign.id, {
    versionId: version.id,
    bucketCount: bucketHours.length,
    recipientCount: contactIds.length
  }, campaign.territoryId));

  return { campaign, version, snapshots, jobs };
}

export async function markEmailCampaignSent(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  campaignId: string,
  sentAt: string
) {
  requireMarketingPermission(context, permissions, "emailSend");
  const campaign = requireCampaign(data, campaignId);
  ensureCampaignAccess(context, campaign);
  if (campaign.status !== "scheduled" && campaign.status !== "sending") {
    throw new Error("Only scheduled or sending campaigns can be marked sent.");
  }
  campaign.status = "sent";
  campaign.sentAt = sentAt;
  await audit.record(marketingAuditEvent(context, auditActions.marketingEmailCampaignSend, "email_campaign", campaign.id, {
    sentAt
  }, campaign.territoryId));
  return campaign;
}

export async function recordEmailDeliveryEvent(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  delivery: EmailDeliveryRecord
) {
  requireMarketingPermission(context, permissions, "emailRecordDelivery");
  const existing = data.emailDeliveryRecords.find((candidate) =>
    candidate.providerKey === delivery.providerKey &&
    candidate.providerMessageId === delivery.providerMessageId &&
    candidate.eventType === delivery.eventType
  );
  if (existing) {
    return existing;
  }
  applyEmailDeliveryEvent(data, delivery);
  await audit.record(marketingAuditEvent(context, auditActions.marketingEmailDeliveryRecord, "email_delivery_record", delivery.id, {
    eventType: delivery.eventType ?? delivery.status,
    providerKey: delivery.providerKey ?? null
  }, null));
  return delivery;
}

export async function createNetworkNewsletterMaster(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  master: NetworkNewsletterMaster
) {
  requireMarketingPermission(context, permissions, "newsletterFactoryManage");
  const template = data.emailTemplates.find((candidate) => candidate.id === master.templateId && !candidate.deletedAt);
  if (!template || template.status !== "approved") {
    throw new Error("Newsletter master requires an approved email template.");
  }
  data.networkNewsletterMasters.push(master);
  await audit.record(marketingAuditEvent(context, auditActions.marketingNewsletterMasterCreate, "network_newsletter_master", master.id, {
    templateId: master.templateId,
    seasonKey: master.seasonKey ?? null
  }, null));
  return master;
}

export async function approveNetworkNewsletterMaster(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  masterId: string,
  approvedAt: string
) {
  requireMarketingPermission(context, permissions, "newsletterFactoryApprove");
  const master = requireNewsletterMaster(data, masterId);
  master.status = "approved";
  master.approvedByUserId = context.userId;
  master.approvedAt = approvedAt;
  await audit.record(marketingAuditEvent(context, auditActions.marketingNewsletterMasterApprove, "network_newsletter_master", master.id, {
    approvedAt
  }, null));
  return master;
}

export async function generateTerritoryNewsletterEditions(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  input: {
    id: string;
    masterId: string;
    territoryIds: string[];
    generatedAt: string;
    idempotencyKey: string;
  }
) {
  requireMarketingPermission(context, permissions, "newsletterFactoryManage");
  const existingRun = data.newsletterFactoryRuns.find((run) => run.idempotencyKey === input.idempotencyKey);
  if (existingRun) {
    return existingRun;
  }
  const master = requireNewsletterMaster(data, input.masterId);
  if (master.status !== "approved" && master.status !== "generated") {
    throw new Error("Only approved newsletter masters can generate territory editions.");
  }
  const uniqueTerritoryIds = [...new Set(input.territoryIds)];
  let readyCount = 0;
  let reviewCount = 0;
  let blockedCount = 0;

  for (const territoryId of uniqueTerritoryIds) {
    ensureKnownTerritory(data, territoryId);
    const existingEdition = data.territoryNewsletterEditions.find((edition) => edition.masterId === master.id && edition.territoryId === territoryId && !edition.deletedAt);
    const warnings = newsletterWarnings(master, territoryId, existingEdition?.localOverrides ?? {});
    const status = newsletterStatusFromWarnings(warnings);
    if (status === "ready") readyCount += 1;
    if (status === "needs_review") reviewCount += 1;
    if (status === "blocked") blockedCount += 1;
    if (existingEdition) {
      existingEdition.inheritedBlocks = [...master.lockedBlocks, ...master.optionalBlocks];
      existingEdition.warnings = warnings;
      existingEdition.generatedAt = input.generatedAt;
      if (existingEdition.status !== "approved" && existingEdition.status !== "scheduled") {
        existingEdition.status = status;
      }
    } else {
      data.territoryNewsletterEditions.push({
        id: randomUUID(),
        masterId: master.id,
        territoryId,
        emailCampaignId: null,
        status,
        inheritedBlocks: [...master.lockedBlocks, ...master.optionalBlocks],
        localOverrides: {},
        warnings,
        generatedAt: input.generatedAt,
        approvedAt: null
      });
    }
  }

  master.status = "generated";
  const run: NewsletterFactoryRun = {
    id: input.id,
    masterId: master.id,
    status: "completed",
    totalTerritories: uniqueTerritoryIds.length,
    readyCount,
    reviewCount,
    blockedCount,
    generatedAt: input.generatedAt,
    idempotencyKey: input.idempotencyKey,
    metadata: {}
  };
  data.newsletterFactoryRuns.push(run);
  await audit.record(marketingAuditEvent(context, auditActions.marketingNewsletterFactoryGenerate, "newsletter_factory_run", run.id, {
    masterId: master.id,
    totalTerritories: run.totalTerritories,
    readyCount,
    reviewCount,
    blockedCount
  }, null));
  return run;
}

export async function recordTerritoryNewsletterOverride(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  editionId: string,
  overrides: Record<string, unknown>
) {
  requireMarketingPermission(context, permissions, "newsletterFactoryContribute");
  const edition = requireNewsletterEdition(data, editionId);
  ensureContextCanAccessTerritory(context, edition.territoryId);
  if (edition.status === "scheduled") {
    throw new Error("Scheduled newsletter editions cannot be locally edited.");
  }
  const master = requireNewsletterMaster(data, edition.masterId);
  edition.localOverrides = { ...edition.localOverrides, ...overrides };
  const warnings = newsletterWarnings(master, edition.territoryId, edition.localOverrides);
  edition.warnings = warnings;
  if (edition.status !== "approved") {
    edition.status = newsletterStatusFromWarnings(warnings);
  }
  await audit.record(marketingAuditEvent(context, auditActions.marketingNewsletterLocalOverride, "territory_newsletter_edition", edition.id, {
    masterId: edition.masterId,
    territoryId: edition.territoryId,
    overrideKeys: Object.keys(overrides)
  }, edition.territoryId));
  return edition;
}

export async function createNewsletterEditionCampaign(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  input: {
    editionId: string;
    campaignId: string;
    versionId: string;
    segmentId: string;
    subject: string;
    preheader?: string | null;
  }
) {
  requireMarketingPermission(context, permissions, "emailCreate");
  const edition = requireNewsletterEdition(data, input.editionId);
  ensureContextCanAccessTerritory(context, edition.territoryId);

  if (edition.emailCampaignId) {
    throw new Error("This territory edition is already linked to a campaign.");
  }

  if (edition.status === "blocked") {
    throw new Error("Blocked territory editions cannot be sent until required local content is added.");
  }

  const master = requireNewsletterMaster(data, edition.masterId);
  const segment = requireSegment(data, input.segmentId);

  if (segment.territoryId && segment.territoryId !== edition.territoryId) {
    throw new Error("Segment territory does not match the newsletter edition's territory.");
  }

  const campaign: EmailCampaign = {
    id: input.campaignId,
    territoryId: edition.territoryId,
    templateId: master.templateId,
    segmentId: segment.id,
    campaignType: "newsletter",
    status: "draft",
    title: master.title,
    subject: input.subject,
    preheader: input.preheader ?? null,
    sendProvider: "postmark",
    sendConnectionId: null,
    scheduledAt: null,
    approvedAt: null,
    sentAt: null,
    metadata: { territoryNewsletterEditionId: edition.id, masterId: master.id }
  };
  const version: EmailCampaignVersion = {
    id: input.versionId,
    campaignId: campaign.id,
    versionNumber: 1,
    status: "draft",
    subject: input.subject,
    preheader: input.preheader ?? null,
    contentSnapshot: {
      inheritedBlocks: edition.inheritedBlocks,
      localOverrides: edition.localOverrides
    },
    createdByUserId: context.userId
  };

  data.emailCampaigns.push(campaign);
  data.emailCampaignVersions.push(version);
  edition.emailCampaignId = campaign.id;

  await audit.record(marketingAuditEvent(context, auditActions.marketingEmailCampaignCreate, "email_campaign", campaign.id, {
    campaignType: campaign.campaignType,
    territoryId: campaign.territoryId,
    territoryNewsletterEditionId: edition.id
  }, campaign.territoryId));

  return { campaign, version, edition };
}

export async function createJourney(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  journey: MarketingJourney,
  version: MarketingJourneyVersion
) {
  requireMarketingPermission(context, permissions, "journeyCreate");
  ensureJourneyAccess(context, journey);
  if (version.journeyId !== journey.id || version.versionNumber !== 1) {
    throw new Error("Initial journey version must belong to the journey and start at version 1.");
  }
  data.journeys.push(journey);
  data.journeyVersions.push(version);
  await audit.record(marketingAuditEvent(context, auditActions.marketingJourneyCreate, "marketing_journey", journey.id, {
    trigger: version.trigger,
    stepCount: version.steps.length
  }, journey.territoryId));
  return journey;
}

export async function approveJourneyVersion(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  journeyId: string,
  versionId: string,
  approvedAt: string
) {
  requireMarketingPermission(context, permissions, "journeyApprove");
  const journey = requireJourney(data, journeyId);
  ensureJourneyAccess(context, journey);
  const version = requireJourneyVersion(data, versionId);
  if (version.journeyId !== journey.id) throw new Error("Journey version does not belong to journey.");
  version.status = "approved";
  version.approvedByUserId = context.userId;
  version.approvedAt = approvedAt;
  journey.status = "approved";
  journey.approvedByUserId = context.userId;
  journey.approvedAt = approvedAt;
  await audit.record(marketingAuditEvent(context, auditActions.marketingJourneyApprove, "marketing_journey", journey.id, {
    versionNumber: version.versionNumber
  }, journey.territoryId));
  return version;
}

export async function activateJourney(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  journeyId: string,
  activatedAt: string
) {
  requireMarketingPermission(context, permissions, "journeyActivate");
  const journey = requireJourney(data, journeyId);
  ensureJourneyAccess(context, journey);
  if (!data.journeyVersions.some((version) => version.journeyId === journey.id && version.status === "approved" && !version.deletedAt)) {
    throw new Error("Journey requires an approved version before activation.");
  }
  journey.status = "active";
  journey.activatedAt = activatedAt;
  journey.pausedAt = null;
  await audit.record(marketingAuditEvent(context, auditActions.marketingJourneyActivate, "marketing_journey", journey.id, {}, journey.territoryId));
  return journey;
}

export async function pauseJourney(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  journeyId: string,
  pausedAt: string
) {
  requireMarketingPermission(context, permissions, "journeyPause");
  const journey = requireJourney(data, journeyId);
  ensureJourneyAccess(context, journey);
  journey.status = "paused";
  journey.pausedAt = pausedAt;
  await audit.record(marketingAuditEvent(context, auditActions.marketingJourneyPause, "marketing_journey", journey.id, {}, journey.territoryId));
  return journey;
}

/**
 * Editing is only ever allowed before a journey's first approval - once a
 * version is approved, audience entries may already reference it by id, and
 * mutating trigger/conditions/steps out from under a running instance would
 * be unsafe. Revising an already-active journey is out of scope for v1.
 */
export async function updateJourneyDraft(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
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
  requireMarketingPermission(context, permissions, "journeyEdit");
  const journey = requireJourney(data, journeyId);
  ensureJourneyAccess(context, journey);
  if (journey.status !== "draft") {
    throw new Error("Only a draft journey can be edited.");
  }
  const version = data.journeyVersions
    .filter((candidate) => candidate.journeyId === journey.id && !candidate.deletedAt)
    .sort((left, right) => right.versionNumber - left.versionNumber)[0];
  if (!version || version.status !== "draft") {
    throw new Error("Draft journey has no editable draft version.");
  }
  if (patch.steps !== undefined && patch.steps.length === 0) {
    throw new Error("A journey needs at least one step.");
  }
  if (patch.name !== undefined) journey.name = patch.name;
  if (patch.description !== undefined) journey.description = patch.description;
  if (patch.purpose !== undefined) journey.purpose = patch.purpose;
  if (patch.trigger !== undefined) version.trigger = patch.trigger;
  if (patch.conditions !== undefined) version.conditions = patch.conditions;
  if (patch.steps !== undefined) version.steps = patch.steps;
  await audit.record(marketingAuditEvent(context, auditActions.marketingJourneyEdit, "marketing_journey", journey.id, {
    stepCount: version.steps.length
  }, journey.territoryId));
  return { journey, version };
}

export async function enterJourneyFromEvent(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  input: {
    journeyId: string;
    contactId: string;
    territoryId?: string | null;
    sourceEventType: string;
    sourceEventId?: string | null;
    enteredAt: string;
    idempotencyKey: string;
  }
) {
  requireMarketingPermission(context, permissions, "journeyExecute");
  const existing = data.journeyAudienceEntries.find((entry) => entry.idempotencyKey === input.idempotencyKey);
  if (existing) return existing;
  const journey = requireJourney(data, input.journeyId);
  if (journey.status !== "active") throw new Error("Only active journeys can receive audience entries.");
  if (input.territoryId) ensureContextCanAccessTerritory(context, input.territoryId);
  const contact = requireContact(data, input.contactId);
  if (contact.emailStatus === "suppressed" || data.suppressions.some((suppression) => suppression.contactId === contact.id && suppression.active)) {
    throw new Error("Suppressed contacts cannot enter marketing journeys.");
  }
  if (input.territoryId && !data.subscriptions.some((subscription) => subscription.contactId === contact.id && subscription.territoryId === input.territoryId && subscription.status === "subscribed" && !subscription.deletedAt)) {
    throw new Error("Contact is not subscribed in the target territory.");
  }
  const version = data.journeyVersions
    .filter((candidate) => candidate.journeyId === journey.id && candidate.status === "approved" && !candidate.deletedAt)
    .sort((left, right) => right.versionNumber - left.versionNumber)[0];
  if (!version) throw new Error("Active journey has no approved version.");
  const entry: MarketingJourneyAudienceEntry = {
    id: crypto.randomUUID(),
    journeyId: journey.id,
    journeyVersionId: version.id,
    contactId: contact.id,
    territoryId: input.territoryId ?? journey.territoryId ?? null,
    sourceEventType: input.sourceEventType,
    sourceEventId: input.sourceEventId ?? null,
    status: "active",
    enteredAt: input.enteredAt,
    exitedAt: null,
    exitReason: null,
    idempotencyKey: input.idempotencyKey,
    metadata: {}
  };
  const execution: MarketingJourneyExecution = {
    id: crypto.randomUUID(),
    entryId: entry.id,
    journeyId: journey.id,
    status: "queued",
    currentStepKey: typeof version.steps[0]?.key === "string" ? version.steps[0].key : null,
    runAfter: input.enteredAt,
    attempts: 0,
    maxAttempts: 3,
    failureReason: null,
    completedAt: null,
    idempotencyKey: `journey:execution:${entry.id}`
  };
  data.journeyAudienceEntries.push(entry);
  data.journeyExecutions.push(execution);
  await audit.record(marketingAuditEvent(context, auditActions.marketingJourneyEnter, "marketing_journey_audience_entry", entry.id, {
    journeyId: journey.id,
    sourceEventType: input.sourceEventType
  }, entry.territoryId));
  return entry;
}

export async function executeJourneyStep(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  executionId: string,
  stepKey: string,
  completedAt: string
) {
  requireMarketingPermission(context, permissions, "journeyExecute");
  const execution = data.journeyExecutions.find((candidate) => candidate.id === executionId);
  if (!execution) throw new Error("Journey execution was not found.");
  const entry = data.journeyAudienceEntries.find((candidate) => candidate.id === execution.entryId);
  if (!entry) throw new Error("Journey audience entry was not found.");
  if (entry.territoryId) ensureContextCanAccessTerritory(context, entry.territoryId);
  const version = requireJourneyVersion(data, entry.journeyVersionId);
  const stepIndex = version.steps.findIndex((candidate) => candidate.key === stepKey);
  if (stepIndex === -1) throw new Error("Journey step was not found.");
  const step = version.steps[stepIndex]!;

  // Idempotency: a re-attempted execution replays the same stepKey. Short-circuit
  // before doing anything else so retries after a partial persistence failure are safe.
  const stepIdempotencyKey = `journey:step:${execution.id}:${stepKey}`;
  if (data.journeyStepExecutions.some((candidate) => candidate.idempotencyKey === stepIdempotencyKey)) {
    return execution;
  }
  if (execution.currentStepKey !== stepKey) {
    throw new Error("Journey step does not match the execution's current step.");
  }

  // JourneyStep is a single-member union today (send_email) - extend this
  // guard when a second actionType is introduced.
  if (step.actionType === "send_email") {
    const contact = requireContact(data, entry.contactId);
    if (contact.emailStatus === "suppressed" || data.suppressions.some((suppression) => suppression.contactId === contact.id && suppression.active)) {
      execution.status = "failed";
      execution.failureReason = "suppressed_contact";
      await audit.record(marketingAuditEvent(context, auditActions.marketingJourneyFail, "marketing_journey_execution", execution.id, {
        reason: "suppressed_contact"
      }, entry.territoryId));
      throw new Error("Suppressed contacts cannot receive outbound journey actions.");
    }
  }

  const output = await sendJourneyStepEmail(context, permissions, audit, data, entry, version, step);

  data.journeyStepExecutions.push({
    id: crypto.randomUUID(),
    executionId: execution.id,
    stepKey,
    actionType: step.actionType,
    status: "completed",
    scheduledFor: null,
    completedAt,
    failureReason: null,
    output,
    idempotencyKey: stepIdempotencyKey
  });

  const nextStep = version.steps[stepIndex + 1];
  if (nextStep) {
    execution.status = "queued";
    execution.currentStepKey = nextStep.key;
    execution.runAfter = new Date(new Date(completedAt).getTime() + nextStep.delayMinutes * 60_000).toISOString();
  } else {
    execution.status = "completed";
    execution.currentStepKey = null;
    execution.completedAt = completedAt;
    entry.status = "completed";
    entry.exitedAt = completedAt;
    entry.exitReason = "completed";
  }

  await audit.record(marketingAuditEvent(context, auditActions.marketingJourneyStepExecute, "marketing_journey_execution", execution.id, {
    stepKey,
    actionType: step.actionType,
    hasNextStep: Boolean(nextStep)
  }, entry.territoryId));

  return execution;
}

/**
 * Journeys have no segment reference of their own, so a "send email" step
 * reuses the existing campaign/snapshot/send-job pipeline for exactly one
 * contact via createRecipientSnapshot's segment-optional path. One ad hoc
 * campaign+version is shared per (journeyVersionId, stepKey) - keyed by a
 * deterministic id - so a popular journey doesn't flood the campaign list
 * with a near-duplicate row per contact; the per-entry snapshot and send job
 * are unique per contact.
 */
async function sendJourneyStepEmail(
  context: MarketingActorContext,
  permissions: PermissionData,
  audit: MarketingAuditRecorder,
  data: MarketingData,
  entry: MarketingJourneyAudienceEntry,
  version: MarketingJourneyVersion,
  step: JourneyStepSendEmail
): Promise<Record<string, unknown>> {
  const campaignId = deterministicJourneyId("journey-step-campaign", version.id, step.key);
  const campaignVersionId = deterministicJourneyId("journey-step-campaign-version", version.id, step.key);

  let campaign = data.emailCampaigns.find((candidate) => candidate.id === campaignId);
  if (!campaign) {
    campaign = {
      id: campaignId,
      territoryId: entry.territoryId ?? null,
      templateId: null,
      segmentId: null,
      campaignType: "journey",
      status: "draft",
      title: `Journey step: ${step.key}`,
      subject: step.email.subject,
      preheader: null,
      sendProvider: "postmark",
      sendConnectionId: null,
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: { journeyVersionId: version.id, journeyStepKey: step.key }
    };
    const campaignVersion: EmailCampaignVersion = {
      id: campaignVersionId,
      campaignId,
      versionNumber: 1,
      status: "draft",
      subject: step.email.subject,
      preheader: null,
      contentSnapshot: { version: 1, blocks: step.email.blocks },
      variantKey: null,
      // Not context.userId: the journey worker's actor id is a synthetic
      // system identity, never a real row in the users table, and this
      // column is a real FK to it.
      createdByUserId: null
    };
    await createEmailCampaign(context, permissions, audit, data, campaign, campaignVersion);
    await approveEmailCampaignVersion(context, permissions, audit, data, campaignId, campaignVersionId, new Date().toISOString());
    campaignVersion.approvedByUserId = null;
  }

  const snapshot = await createRecipientSnapshot(context, permissions, audit, data, {
    id: randomUUID(),
    campaignId,
    campaignVersionId,
    status: "created",
    generatedAt: new Date().toISOString(),
    idempotencyKey: `journey:step:${entry.id}:${step.key}:snapshot`,
    restrictToContactIds: [entry.contactId],
    heldOutExclusionReason: "not_targeted_by_journey_step"
  });

  const job = enqueueEmailSend(context, permissions, data, {
    id: deterministicJourneyId("journey-step-send-job", entry.id, step.key),
    campaignId,
    campaignVersionId,
    recipientSnapshotId: snapshot.id,
    batchSize: 1,
    nextAttemptAt: new Date().toISOString()
  });

  return { campaignId, campaignVersionId, snapshotId: snapshot.id, jobId: job.id };
}

/** A deterministic, UUID-shaped id derived from its parts, for artifacts that
 * must converge across concurrent or retried journey-step executions. */
function deterministicJourneyId(...parts: string[]): string {
  const hex = createHash("sha256").update(parts.join(":")).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function findActiveJourneysForTrigger(data: MarketingData, trigger: JourneyTrigger) {
  return data.journeys
    .filter((journey) => journey.status === "active" && !journey.deletedAt)
    .map((journey) => {
      const version = data.journeyVersions
        .filter((candidate) => candidate.journeyId === journey.id && candidate.status === "approved" && !candidate.deletedAt)
        .sort((left, right) => right.versionNumber - left.versionNumber)[0];
      return version ? { journey, version } : null;
    })
    .filter((candidate): candidate is { journey: MarketingJourney; version: MarketingJourneyVersion } => candidate !== null)
    .filter((candidate) => candidate.version.trigger.type === trigger.type);
}

function contactMatchesSegment(view: AudienceContactView, segment: AudienceSegment) {
  if (view.suppressions.some((suppression) => suppression.active)) {
    return false;
  }
  if (segment.segmentType === "static") {
    return view.contact.metadata.segmentIds instanceof Array && view.contact.metadata.segmentIds.includes(segment.id);
  }
  return evaluateSegmentRules(view, normalizeSegmentDefinition(segment.definition, segment.territoryId));
}

/**
 * Per-segment dynamic content blocks: a block whose `visibleSegmentId` is set
 * is only shown to recipients who match that segment. Computed once here, not
 * at send time - this is the cheapest point with full AudienceContactViews
 * already assembled; the send-worker never reloads full audience views, so
 * re-deriving membership at send time would mean rebuilding contact views
 * from scratch inside the cron worker. Returns null when the version has no
 * gated blocks so the vast majority of campaigns skip this entirely.
 */
function resolveHiddenBlockIdsByContact(
  context: MarketingActorContext,
  data: MarketingData,
  campaign: EmailCampaign,
  version: EmailCampaignVersion,
  eligibleContacts: AudienceContactView[]
): Map<string, string[]> | null {
  const snapshotContent = normalizeContentSnapshot(version.contentSnapshot, campaign.title);
  const gatedBlocks = (snapshotContent.blocks as Block[])
    .filter((block) => Boolean(block.visibleSegmentId))
    .map((block) => ({ id: block.id, segmentId: block.visibleSegmentId as string }));

  if (gatedBlocks.length === 0) {
    return null;
  }

  const resolvedSegments = new Map<string, AudienceSegment>();
  for (const { segmentId } of gatedBlocks) {
    if (resolvedSegments.has(segmentId)) continue;
    const segment = requireSegment(data, segmentId);
    if (segment.territoryId) {
      ensureContextCanAccessTerritory(context, segment.territoryId);
    }
    resolvedSegments.set(segmentId, segment);
  }

  const result = new Map<string, string[]>();
  for (const view of eligibleContacts) {
    const hidden = gatedBlocks
      .filter((gated) => !contactMatchesSegment(view, resolvedSegments.get(gated.segmentId)!))
      .map((gated) => gated.id);
    result.set(view.contact.id, hidden);
  }
  return result;
}

function assembleContactView(data: MarketingData, contact: AudienceContact, visibleTerritoryIds: Set<string> | null): AudienceContactView {
  const territoryFilter = (territoryId?: string | null) => visibleTerritoryIds == null || !territoryId || visibleTerritoryIds.has(territoryId);
  return {
    contact,
    subscriptions: data.subscriptions.filter((subscription) => subscription.contactId === contact.id && !subscription.deletedAt && territoryFilter(subscription.territoryId)),
    consentEvents: data.consentEvents.filter((event) => event.contactId === contact.id && territoryFilter(event.territoryId)),
    suppressions: data.suppressions.filter((suppression) => suppression.contactId === contact.id && suppression.active && territoryFilter(suppression.territoryId)),
    activity: data.activityEvents.filter((event) => event.contactId === contact.id && !event.deletedAt && territoryFilter(event.territoryId)),
    profile: data.preferenceProfiles.find((profile) => profile.contactId === contact.id && !profile.deletedAt)
  };
}

function contactVisibleInTerritories(contactId: string, visibleTerritoryIds: Set<string> | null, data: MarketingData) {
  if (visibleTerritoryIds == null) {
    return true;
  }
  return data.subscriptions.some((subscription) => subscription.contactId === contactId && visibleTerritoryIds.has(subscription.territoryId) && !subscription.deletedAt);
}

function validatePreferenceProfile(
  data: MarketingData,
  profile: AudiencePreferenceProfile,
  visibleTerritoryIds: Set<string> | null
) {
  const knownTerritories = new Set(data.territories.map((territory) => territory.id));
  const selectedTerritories = [
    profile.homeTerritoryId,
    ...profile.followedTerritoryIds
  ].filter((territoryId): territoryId is string => Boolean(territoryId));

  for (const territoryId of selectedTerritories) {
    if (!knownTerritories.has(territoryId)) {
      throw new Error("Preference profile references an unknown territory.");
    }
    if (visibleTerritoryIds != null && !visibleTerritoryIds.has(territoryId)) {
      throw new Error("Preference profile references a territory outside the permitted scope.");
    }
  }

  const allowedAgeBands = new Set(["pregnancy", "baby-toddler", "preschool", "primary", "secondary", "teen"]);
  if (!profile.childAgeBands.every((band) => allowedAgeBands.has(band))) {
    throw new Error("Preference profile uses unsupported broad age bands.");
  }

  const allowedFrequencies = new Set(["weekly", "fortnightly", "monthly", "school_holidays_only"]);
  if (!allowedFrequencies.has(profile.newsletterFrequency)) {
    throw new Error("Preference profile uses an unsupported newsletter frequency.");
  }
}

function segmentMatchesPreferences(segment: AudienceSegment, profile?: AudiencePreferenceProfile) {
  if (!profile || !profile.personalisationEnabled) {
    return false;
  }
  const interests = Array.isArray(segment.definition.interests)
    ? segment.definition.interests.filter((interest): interest is string => typeof interest === "string")
    : [];
  const categories = Array.isArray(segment.definition.eventCategories)
    ? segment.definition.eventCategories.filter((category): category is string => typeof category === "string")
    : [];
  return interests.some((interest) => profile.interests.includes(interest))
    || categories.some((category) => profile.eventCategories.includes(category));
}

function preferenceReasons(metadata: Record<string, unknown>, interests: Set<string>) {
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  return tags.filter((tag) => interests.has(tag)).map((tag) => `Matches interest: ${tag}`);
}

function providerMetricSum(rows: Array<Record<string, unknown>>, key: string) {
  const values = rows
    .map((row) => row[key])
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) {
    return undefined;
  }
  return values.reduce((total, value) => total + value, 0);
}

function deliveryTerritory(data: MarketingData, campaignId: string) {
  return data.emailCampaigns.find((campaign) => campaign.id === campaignId)?.territoryId;
}

function visibleTerritories(context: MarketingActorContext, data: MarketingData) {
  if (!context.territoryId) {
    return null;
  }
  return new Set(data.territories.filter((territory) => territory.id === context.territoryId).map((territory) => territory.id));
}

function requireMarketingPermission(
  context: MarketingActorContext,
  permissions: PermissionData,
  capability: MarketingCapability
) {
  const required = marketingCapabilities[capability];
  return requirePermission({
    userId: context.userId,
    module: required.module,
    action: required.action,
    context: {
      organisationId: context.organisationId ?? undefined,
      territoryId: context.territoryId ?? undefined
    }
  }, permissions);
}

function ensureContextCanAccessTerritory(context: MarketingActorContext, territoryId: string) {
  if (context.territoryId && context.territoryId !== territoryId) {
    throw new Error("Audience record is outside the active territory.");
  }
}

function ensureJourneyAccess(context: MarketingActorContext, journey: { territoryId?: string | null }) {
  if (journey.territoryId) {
    ensureContextCanAccessTerritory(context, journey.territoryId);
  } else if (context.territoryId) {
    throw new Error("A territory-scoped actor cannot act on a network-wide journey.");
  }
}

export function applyEmailDeliveryEvent(
  data: { contacts: AudienceContact[]; suppressions: AudienceSuppression[]; emailDeliveryRecords: EmailDeliveryRecord[] },
  delivery: EmailDeliveryRecord
) {
  data.emailDeliveryRecords.push(delivery);
  const suppressionReason = suppressionReasonForEventType(delivery.eventType, delivery.metadata);

  if (!suppressionReason) {
    return;
  }

  const contact = (delivery.contactId && data.contacts.find((candidate) => candidate.id === delivery.contactId && !candidate.deletedAt)) ||
    data.contacts.find((candidate) => candidate.emailNormalised === delivery.emailNormalised && !candidate.deletedAt);

  if (!contact) {
    return;
  }

  data.suppressions.push({
    id: `${delivery.id}_suppression`,
    contactId: contact.id,
    emailNormalised: contact.emailNormalised,
    territoryId: null,
    reason: suppressionReason,
    source: delivery.providerKey ?? "provider",
    active: true,
    suppressedAt: delivery.eventAt ?? new Date().toISOString(),
    metadata: { deliveryId: delivery.id }
  });
  contact.emailStatus = "suppressed";
}

const hardBounceTypes = new Set(["hardbounce", "blocked", "bademailaddress", "manuallydeactivated", "spamnotification"]);

function suppressionReasonForEventType(
  eventType: EmailDeliveryRecord["eventType"],
  metadata: Record<string, unknown>
) {
  if (eventType === "unsubscribed") return "provider_unsubscribe";
  if (eventType === "complained") return "provider_spam_complaint";
  if (eventType === "bounced") {
    const bounceType = typeof metadata.type === "string" ? metadata.type.toLowerCase() : "";
    return hardBounceTypes.has(bounceType) ? "provider_hard_bounce" : null;
  }
  return null;
}

function ensureCampaignAccess(context: MarketingActorContext, campaign: { territoryId?: string | null }) {
  if (campaign.territoryId) {
    ensureContextCanAccessTerritory(context, campaign.territoryId);
  } else if (context.territoryId) {
    throw new Error("A territory-scoped actor cannot act on a network-wide campaign.");
  }
}

function requireContact(data: MarketingData, contactId: string) {
  const contact = data.contacts.find((candidate) => candidate.id === contactId && !candidate.deletedAt);
  if (!contact) {
    throw new Error("Audience contact was not found.");
  }
  return contact;
}

function requireSegment(data: MarketingData, segmentId: string) {
  const segment = data.segments.find((candidate) => candidate.id === segmentId && !candidate.deletedAt);
  if (!segment) {
    throw new Error("Audience segment was not found.");
  }
  return segment;
}

function requireCampaign(data: MarketingData, campaignId: string) {
  const campaign = data.emailCampaigns.find((candidate) => candidate.id === campaignId && !candidate.deletedAt);
  if (!campaign) {
    throw new Error("Email campaign was not found.");
  }
  return campaign;
}

function requireCampaignVersion(data: MarketingData, versionId: string) {
  const version = data.emailCampaignVersions.find((candidate) => candidate.id === versionId && !candidate.deletedAt);
  if (!version) {
    throw new Error("Email campaign version was not found.");
  }
  return version;
}

function requireRecipientSnapshot(data: MarketingData, snapshotId: string) {
  const snapshot = data.emailRecipientSnapshots.find((candidate) => candidate.id === snapshotId);
  if (!snapshot) {
    throw new Error("Email recipient snapshot was not found.");
  }
  return snapshot;
}

function requireJourney(data: MarketingData, journeyId: string) {
  const journey = data.journeys.find((candidate) => candidate.id === journeyId && !candidate.deletedAt);
  if (!journey) {
    throw new Error("Marketing journey was not found.");
  }
  return journey;
}

function requireJourneyVersion(data: MarketingData, versionId: string) {
  const version = data.journeyVersions.find((candidate) => candidate.id === versionId && !candidate.deletedAt);
  if (!version) {
    throw new Error("Marketing journey version was not found.");
  }
  return version;
}

function requireNewsletterMaster(data: MarketingData, masterId: string) {
  const master = data.networkNewsletterMasters.find((candidate) => candidate.id === masterId && !candidate.deletedAt);
  if (!master) {
    throw new Error("Newsletter master was not found.");
  }
  return master;
}

function requireNewsletterEdition(data: MarketingData, editionId: string) {
  const edition = data.territoryNewsletterEditions.find((candidate) => candidate.id === editionId && !candidate.deletedAt);
  if (!edition) {
    throw new Error("Territory newsletter edition was not found.");
  }
  return edition;
}

function ensureKnownTerritory(data: MarketingData, territoryId: string) {
  if (!data.territories.some((territory) => territory.id === territoryId)) {
    throw new Error("Newsletter generation references an unknown territory.");
  }
}

function newsletterWarnings(
  master: NetworkNewsletterMaster,
  territoryId: string,
  localOverrides: Record<string, unknown> = {}
) {
  const requiredLocalBlocks = Array.isArray(master.contentRules.requiredLocalBlocks)
    ? master.contentRules.requiredLocalBlocks
    : [];
  return requiredLocalBlocks
    .filter((block) => !(typeof block === "string" && block in localOverrides))
    .map((block) => ({
      code: "required_local_content",
      severity: "blocking",
      territoryId,
      block
    }));
}

function newsletterStatusFromWarnings(warnings: Array<{ severity: string }>) {
  if (warnings.some((warning) => warning.severity === "blocking")) {
    return "blocked";
  }

  return warnings.length > 0 ? "needs_review" : "ready";
}

function auditEvent(
  context: MarketingActorContext,
  action: string,
  contact: AudienceContact,
  payload: Record<string, unknown>,
  territoryId?: string | null
) {
  return {
    action,
    actorUserId: context.userId,
    entityType: "audience_contact",
    entityId: contact.id,
    organisationId: context.organisationId,
    territoryId: territoryId ?? context.territoryId,
    payload
  };
}

function marketingAuditEvent(
  context: MarketingActorContext,
  action: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
  territoryId?: string | null
) {
  return {
    action,
    actorUserId: context.userId,
    entityType,
    entityId,
    organisationId: context.organisationId,
    territoryId: territoryId ?? context.territoryId,
    payload
  };
}
