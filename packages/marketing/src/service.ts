import { auditActions } from "@raring2go/audit";
import { requirePermission, type PermissionData } from "@raring2go/permissions";
import { marketingCapabilities, type MarketingCapability } from "./permissions";
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
  EmailCampaignVersion,
  EmailCampaignOverview,
  EmailDeliveryRecord,
  EmailRecipientSnapshot,
  EmailTemplate,
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
    .map((campaign) => ({
      campaign,
      latestVersion: data.emailCampaignVersions
        .filter((version) => version.campaignId === campaign.id && !version.deletedAt)
        .sort((left, right) => right.versionNumber - left.versionNumber)[0],
      latestSnapshot: data.emailRecipientSnapshots
        .filter((snapshot) => snapshot.campaignId === campaign.id)
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0],
      deliveryCount: data.emailDeliveryRecords.filter((delivery) => delivery.campaignId === campaign.id && !delivery.deletedAt).length
    }));

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
      clicks: providerMetricSum(deliveries.map((delivery) => delivery.metadata), "clicks")
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
  const visibleTerritoryIds = visibleTerritories(context, data);
  const audience = listAudienceContacts(context, permissions, data).contacts;
  return audience.filter((view) => contactMatchesSegment(view, segment, visibleTerritoryIds));
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
  if (campaign.territoryId) {
    ensureContextCanAccessTerritory(context, campaign.territoryId);
  }
  if (campaign.templateId && !data.emailTemplates.some((template) => template.id === campaign.templateId && !template.deletedAt)) {
    throw new Error("Email template was not found.");
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
  if (campaign.territoryId) {
    ensureContextCanAccessTerritory(context, campaign.territoryId);
  }
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
  snapshot: Omit<EmailRecipientSnapshot, "recipientCount" | "excludedCount" | "recipients" | "exclusions">
) {
  requireMarketingPermission(context, permissions, "emailSchedule");
  const existing = data.emailRecipientSnapshots.find((candidate) => candidate.idempotencyKey === snapshot.idempotencyKey);
  if (existing) {
    return existing;
  }
  const campaign = requireCampaign(data, snapshot.campaignId);
  if (campaign.territoryId) {
    ensureContextCanAccessTerritory(context, campaign.territoryId);
  }
  const version = requireCampaignVersion(data, snapshot.campaignVersionId);
  if (version.status !== "approved") {
    throw new Error("Only approved campaign versions can create recipient snapshots.");
  }
  const segmentId = snapshot.segmentId ?? campaign.segmentId;
  if (!segmentId) {
    throw new Error("Campaign requires an audience segment before scheduling.");
  }
  const segmentContacts = previewSegment(context, permissions, data, segmentId);
  const recipients = segmentContacts.map((view) => ({
    contactId: view.contact.id,
    emailNormalised: view.contact.emailNormalised,
    territoryIds: view.subscriptions.map((subscription) => subscription.territoryId)
  }));
  const allContactIds = new Set(data.contacts.map((contact) => contact.id));
  const recipientIds = new Set(recipients.map((recipient) => recipient.contactId));
  const exclusions = [...allContactIds]
    .filter((contactId) => !recipientIds.has(contactId))
    .map((contactId) => ({ contactId, reason: "not_eligible_or_suppressed" }));
  const created: EmailRecipientSnapshot = {
    ...snapshot,
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
  data.emailDeliveryRecords.push(delivery);
  if (delivery.eventType === "unsubscribe" && delivery.contactId) {
    const contact = requireContact(data, delivery.contactId);
    data.suppressions.push({
      id: `${delivery.id}_suppression`,
      contactId: contact.id,
      emailNormalised: contact.emailNormalised,
      territoryId: null,
      reason: "provider_unsubscribe",
      source: delivery.providerKey ?? "provider",
      active: true,
      suppressedAt: delivery.eventAt ?? new Date().toISOString(),
      metadata: { deliveryId: delivery.id }
    });
    contact.emailStatus = "suppressed";
  }
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
    const warnings = newsletterWarnings(master, territoryId);
    const status = warnings.some((warning) => warning.severity === "blocking") ? "blocked" : warnings.length > 0 ? "needs_review" : "ready";
    if (status === "ready") readyCount += 1;
    if (status === "needs_review") reviewCount += 1;
    if (status === "blocked") blockedCount += 1;
    const existingEdition = data.territoryNewsletterEditions.find((edition) => edition.masterId === master.id && edition.territoryId === territoryId && !edition.deletedAt);
    if (existingEdition) {
      existingEdition.inheritedBlocks = [...master.lockedBlocks, ...master.optionalBlocks];
      existingEdition.warnings = warnings;
      existingEdition.generatedAt = input.generatedAt;
      if (existingEdition.status !== "approved" && existingEdition.status !== "scheduled") {
        existingEdition.status = existingEdition.localOverrides && Object.keys(existingEdition.localOverrides).length > 0 && status === "blocked" ? "needs_review" : status;
      }
    } else {
      data.territoryNewsletterEditions.push({
        id: `${input.id}:${territoryId}`,
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
  edition.localOverrides = { ...edition.localOverrides, ...overrides };
  if (edition.status === "blocked") {
    edition.status = "needs_review";
  }
  await audit.record(marketingAuditEvent(context, auditActions.marketingNewsletterLocalOverride, "territory_newsletter_edition", edition.id, {
    masterId: edition.masterId,
    territoryId: edition.territoryId,
    overrideKeys: Object.keys(overrides)
  }, edition.territoryId));
  return edition;
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
  if (journey.territoryId) ensureContextCanAccessTerritory(context, journey.territoryId);
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
  if (journey.territoryId) ensureContextCanAccessTerritory(context, journey.territoryId);
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
  journey.status = "paused";
  journey.pausedAt = pausedAt;
  await audit.record(marketingAuditEvent(context, auditActions.marketingJourneyPause, "marketing_journey", journey.id, {}, journey.territoryId));
  return journey;
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
  const step = version.steps.find((candidate) => candidate.key === stepKey);
  if (!step) throw new Error("Journey step was not found.");
  const actionType = typeof step.actionType === "string" ? step.actionType : "unknown";
  if (["send_email", "add_to_email_campaign", "create_social_queue_suggestion"].includes(actionType)) {
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
  data.journeyStepExecutions.push({
    id: crypto.randomUUID(),
    executionId: execution.id,
    stepKey,
    actionType,
    status: "completed",
    scheduledFor: null,
    completedAt,
    failureReason: null,
    output: { providerNeutral: true },
    idempotencyKey: `journey:step:${execution.id}:${stepKey}`
  });
  execution.currentStepKey = null;
  execution.status = "completed";
  execution.completedAt = completedAt;
  entry.status = "completed";
  entry.exitedAt = completedAt;
  entry.exitReason = "completed";
  await audit.record(marketingAuditEvent(context, auditActions.marketingJourneyStepExecute, "marketing_journey_execution", execution.id, {
    stepKey,
    actionType
  }, entry.territoryId));
  return execution;
}

function contactMatchesSegment(
  view: AudienceContactView,
  segment: AudienceSegment,
  visibleTerritoryIds: Set<string> | null
) {
  if (view.suppressions.some((suppression) => suppression.active)) {
    return false;
  }
  if (segment.segmentType === "static") {
    return view.contact.metadata.segmentIds instanceof Array && view.contact.metadata.segmentIds.includes(segment.id);
  }
  const territoryId = typeof segment.definition.territoryId === "string" ? segment.definition.territoryId : segment.territoryId;
  if (territoryId && (visibleTerritoryIds == null || visibleTerritoryIds.has(territoryId))) {
    return view.subscriptions.some((subscription) => subscription.territoryId === territoryId && subscription.status === "subscribed");
  }
  return view.subscriptions.some((subscription) => subscription.status === "subscribed");
}

function assembleContactView(data: MarketingData, contact: AudienceContact, visibleTerritoryIds: Set<string> | null): AudienceContactView {
  const territoryFilter = (territoryId?: string | null) => visibleTerritoryIds == null || !territoryId || visibleTerritoryIds.has(territoryId);
  return {
    contact,
    subscriptions: data.subscriptions.filter((subscription) => subscription.contactId === contact.id && !subscription.deletedAt && territoryFilter(subscription.territoryId)),
    consentEvents: data.consentEvents.filter((event) => event.contactId === contact.id && territoryFilter(event.territoryId)),
    suppressions: data.suppressions.filter((suppression) => suppression.contactId === contact.id && suppression.active && territoryFilter(suppression.territoryId)),
    activity: data.activityEvents.filter((event) => event.contactId === contact.id && !event.deletedAt && territoryFilter(event.territoryId))
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

function newsletterWarnings(master: NetworkNewsletterMaster, territoryId: string) {
  const requiredLocalBlocks = Array.isArray(master.contentRules.requiredLocalBlocks)
    ? master.contentRules.requiredLocalBlocks
    : [];
  return requiredLocalBlocks.map((block) => ({
    code: "required_local_content",
    severity: "blocking",
    territoryId,
    block
  }));
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
