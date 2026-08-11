import { auditActions } from "@raring2go/audit";
import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it } from "vitest";
import {
  listAudienceContacts,
  approveEmailCampaignVersion,
  activateJourney,
  approveJourneyVersion,
  approveNetworkNewsletterMaster,
  createEmailCampaign,
  createJourney,
  createNetworkNewsletterMaster,
  createRecipientSnapshot,
  enterJourneyFromEvent,
  executeJourneyStep,
  generateTerritoryNewsletterEditions,
  getPreferenceCentre,
  listJourneys,
  listMarketingAnalytics,
  listMarketingCommandCentre,
  listNewsletterFactory,
  pauseJourney,
  previewSegment,
  recordConsentEvent,
  recordEmailDeliveryEvent,
  recordTerritoryNewsletterOverride,
  scheduleEmailCampaign,
  subscribeContactToTerritory,
  suppressContact,
  updatePreferenceProfile,
  upsertAudienceContact
} from "./service";
import type { MarketingData } from "./types";

const ids = {
  users: { hq: "user_hq", local: "user_local" },
  organisations: { hq: "org_hq", franchise: "org_franchise" },
  territories: { own: "territory_own", other: "territory_other" },
  roles: { hq: "role_hq", local: "role_local" },
  contact: "contact_parent",
  segment: "segment_newsletter"
};

const permissions: PermissionData = {
  roleAssignments: [
    { id: "assignment_hq", userId: ids.users.hq, roleId: ids.roles.hq, organisationId: ids.organisations.hq },
    { id: "assignment_local", userId: ids.users.local, roleId: ids.roles.local, organisationId: ids.organisations.franchise, territoryId: ids.territories.own }
  ],
  rolePermissions: [
    grant(ids.roles.hq, "marketing.audience", "view", "network"),
    grant(ids.roles.hq, "marketing.audience", "manage", "network"),
    grant(ids.roles.hq, "marketing.consent", "manage", "network"),
    grant(ids.roles.hq, "marketing.segment", "view", "network"),
    grant(ids.roles.hq, "marketing.segment", "manage", "network"),
    grant(ids.roles.hq, "marketing.email", "view", "network"),
    grant(ids.roles.hq, "marketing.email", "create", "network"),
    grant(ids.roles.hq, "marketing.email", "approve", "network"),
    grant(ids.roles.hq, "marketing.email", "schedule", "network"),
    grant(ids.roles.hq, "marketing.email", "send", "network"),
    grant(ids.roles.hq, "marketing.email", "record_delivery", "network"),
    grant(ids.roles.hq, "marketing.newsletter_factory", "view", "network"),
    grant(ids.roles.hq, "marketing.newsletter_factory", "manage", "network"),
    grant(ids.roles.hq, "marketing.newsletter_factory", "approve", "network"),
    grant(ids.roles.hq, "marketing.newsletter_factory", "contribute", "network"),
    grant(ids.roles.hq, "marketing.journey", "view", "network"),
    grant(ids.roles.hq, "marketing.journey", "create", "network"),
    grant(ids.roles.hq, "marketing.journey", "edit", "network"),
    grant(ids.roles.hq, "marketing.journey", "approve", "network"),
    grant(ids.roles.hq, "marketing.journey", "activate", "network"),
    grant(ids.roles.hq, "marketing.journey", "pause", "network"),
    grant(ids.roles.hq, "marketing.journey", "execute", "network"),
    grant(ids.roles.hq, "marketing.analytics", "view", "network"),
    grant(ids.roles.local, "marketing.audience", "view", "own_territory"),
    grant(ids.roles.local, "marketing.audience", "manage", "own_territory"),
    grant(ids.roles.local, "marketing.consent", "manage", "own_territory"),
    grant(ids.roles.local, "marketing.segment", "view", "own_territory"),
    grant(ids.roles.local, "marketing.segment", "manage", "own_territory"),
    grant(ids.roles.local, "marketing.email", "view", "own_territory"),
    grant(ids.roles.local, "marketing.email", "create", "own_territory"),
    grant(ids.roles.local, "marketing.email", "approve", "own_territory"),
    grant(ids.roles.local, "marketing.email", "schedule", "own_territory"),
    grant(ids.roles.local, "marketing.email", "send", "own_territory"),
    grant(ids.roles.local, "marketing.email", "record_delivery", "own_territory"),
    grant(ids.roles.local, "marketing.newsletter_factory", "view", "own_territory"),
    grant(ids.roles.local, "marketing.newsletter_factory", "contribute", "own_territory"),
    grant(ids.roles.local, "marketing.journey", "view", "own_territory"),
    grant(ids.roles.local, "marketing.journey", "execute", "own_territory"),
    grant(ids.roles.local, "marketing.analytics", "view", "own_territory")
  ],
  territories: [
    { id: ids.territories.own, franchiseOrganisationId: ids.organisations.franchise },
    { id: ids.territories.other, franchiseOrganisationId: "org_other" }
  ]
};

describe("marketing audience foundation", () => {
  it("deduplicates contacts by normalised email across multiple territories", async () => {
    const data = emptyData();
    const recorder = audit();

    const created = await upsertAudienceContact(hqContext(), permissions, recorder, data, contact("Parent@Example.Test"));
    const deduped = await upsertAudienceContact(hqContext(), permissions, recorder, data, {
      ...contact(" parent@example.test "),
      id: "duplicate",
      tags: ["offers"]
    });
    await subscribeContactToTerritory(hqContext(), permissions, recorder, data, subscription("sub_own", created.id, ids.territories.own));
    await subscribeContactToTerritory(hqContext(), permissions, recorder, data, subscription("sub_other", created.id, ids.territories.other));

    expect(deduped.id).toBe(created.id);
    expect(data.contacts).toHaveLength(1);
    expect(data.contacts[0]?.tags).toEqual(["days-out", "offers"]);
    expect(listAudienceContacts(hqContext(), permissions, data).totals).toMatchObject({
      contacts: 1,
      subscribed: 1,
      territories: 2
    });
  });

  it("records append-only consent history and suppressions exclude segment eligibility", async () => {
    const data = seededData();
    const recorder = audit();

    await recordConsentEvent(localContext(), permissions, recorder, data, {
      id: "consent_2",
      contactId: ids.contact,
      territoryId: ids.territories.own,
      consentType: "newsletter",
      action: "withdrawn",
      source: "preference_centre",
      occurredAt: "2026-08-12T00:00:00.000Z",
      actorUserId: null,
      evidence: { ip: "127.0.0.1" }
    });
    await suppressContact(localContext(), permissions, recorder, data, {
      id: "suppression_1",
      contactId: ids.contact,
      emailNormalised: "parent@example.test",
      territoryId: ids.territories.own,
      reason: "unsubscribe",
      source: "preference_centre",
      active: true,
      suppressedAt: "2026-08-12T00:00:00.000Z",
      metadata: {}
    });

    expect(data.consentEvents.map((event) => event.action)).toEqual(["granted", "withdrawn"]);
    expect(previewSegment(localContext(), permissions, data, ids.segment)).toEqual([]);
    expect(listAudienceContacts(localContext(), permissions, data).totals.suppressed).toBe(1);
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.marketingConsentRecord,
      auditActions.marketingAudienceSuppress
    ]);
  });

  it("fails closed for cross-territory audience changes", async () => {
    await expect(subscribeContactToTerritory(localContext(), permissions, audit(), seededData(), subscription("sub_cross", ids.contact, ids.territories.other))).rejects.toThrow("outside the active territory");
  });

  it("uses parent preferences for relevance while failing gracefully without profile data", async () => {
    const data = seededData();

    expect(getPreferenceCentre(localContext(), permissions, data, ids.contact)).toMatchObject({
      profile: undefined,
      recommendedContent: []
    });

    const updated = await updatePreferenceProfile(localContext(), permissions, audit(), data, {
      id: "profile_1",
      contactId: ids.contact,
      homeTerritoryId: ids.territories.own,
      followedTerritoryIds: [ids.territories.own],
      childAgeBands: ["primary"],
      interests: ["days-out"],
      eventCategories: ["family-activity"],
      offerPreferences: ["family-days-out"],
      competitionPreferences: ["local-prizes"],
      newsletterFrequency: "weekly",
      communicationPreferences: { newsletter: true },
      personalisationEnabled: true,
      privacyMetadata: { dataMinimisation: "broad_age_bands_only" }
    });

    expect(updated.profile?.childAgeBands).toEqual(["primary"]);
    expect(updated.recommendedSegments.map((segment) => segment.id)).toContain(ids.segment);
  });

  it("rejects precise or cross-scope preference data", async () => {
    const data = seededData();
    const profile = {
      id: "profile_1",
      contactId: ids.contact,
      homeTerritoryId: ids.territories.other,
      followedTerritoryIds: [ids.territories.other],
      childAgeBands: ["2018-05-12"],
      interests: ["days-out"],
      eventCategories: [],
      offerPreferences: [],
      competitionPreferences: [],
      newsletterFrequency: "daily",
      communicationPreferences: {},
      personalisationEnabled: true,
      privacyMetadata: {}
    };

    await expect(updatePreferenceProfile(localContext(), permissions, audit(), data, profile)).rejects.toThrow("outside the permitted scope");
  });

  it("derives marketing analytics from real records without inventing provider metrics", () => {
    const data = seededData();
    data.emailDeliveryRecords.push({
      id: "delivery_1",
      campaignId: "campaign_1",
      campaignVersionId: "campaign_version_1",
      recipientSnapshotId: null,
      contactId: ids.contact,
      emailNormalised: "parent@example.test",
      providerKey: "development",
      providerMessageId: "message_1",
      status: "delivered",
      eventType: "delivered",
      eventAt: "2026-08-12T10:00:00.000Z",
      metadata: {}
    });
    data.journeyAudienceEntries.push({
      id: "journey_entry_1",
      journeyId: "journey_1",
      journeyVersionId: "journey_version_1",
      contactId: ids.contact,
      territoryId: ids.territories.own,
      sourceEventType: "audience.subscribed",
      sourceEventId: "consent_1",
      status: "completed",
      enteredAt: "2026-08-12T10:00:00.000Z",
      exitedAt: "2026-08-12T10:01:00.000Z",
      exitReason: "completed",
      idempotencyKey: "journey:entry:1",
      metadata: {}
    });
    data.socialPublications.push({
      id: "social_1",
      territoryId: ids.territories.own,
      channel: "facebook",
      publishState: "published",
      approvalState: "approved",
      scheduledAt: "2026-08-12T09:00:00.000Z",
      publishedAt: "2026-08-12T09:00:10.000Z",
      providerMetrics: null
    });

    const analytics = listMarketingAnalytics(localContext(), permissions, data);

    expect(analytics.audience.activeSubscribers).toBe(1);
    expect(analytics.email.delivered).toBe(1);
    expect(analytics.email.opens).toBeUndefined();
    expect(analytics.journeys.completed).toBe(1);
    expect(analytics.social.published).toBe(1);
    expect(analytics.attribution.every((item) => item.source === "platform")).toBe(true);
  });

  it("surfaces command centre action items from scoped channel health", () => {
    const data = seededData();
    data.journeyAudienceEntries.push({
      id: "journey_entry_1",
      journeyId: "journey_1",
      journeyVersionId: "journey_version_1",
      contactId: ids.contact,
      territoryId: ids.territories.own,
      sourceEventType: "audience.subscribed",
      sourceEventId: "consent_1",
      status: "active",
      enteredAt: "2026-08-12T10:00:00.000Z",
      exitedAt: null,
      exitReason: null,
      idempotencyKey: "journey:entry:1",
      metadata: {}
    });
    data.journeyExecutions.push({
      id: "journey_execution_1",
      entryId: "journey_entry_1",
      journeyId: "journey_1",
      status: "failed",
      currentStepKey: "welcome-email",
      runAfter: "2026-08-12T10:00:00.000Z",
      attempts: 3,
      maxAttempts: 3,
      failureReason: "provider unavailable",
      completedAt: null,
      idempotencyKey: "journey:execution:1"
    });
    data.socialPublications.push({
      id: "social_1",
      territoryId: ids.territories.own,
      channel: "facebook",
      publishState: "failed",
      approvalState: "approved",
      scheduledAt: "2026-08-12T09:00:00.000Z",
      publishedAt: null,
      providerMetrics: null
    });

    const command = listMarketingCommandCentre(localContext(), permissions, data);

    expect(command.actionItems.map((item) => item.source)).toEqual(
      expect.arrayContaining(["journey", "social"])
    );
    expect(command.territoryHealth).toHaveLength(1);
    expect(command.territoryHealth[0]?.failedJourneyRuns).toBe(1);
  });

  it("creates native email campaigns, snapshots eligible recipients and records delivery idempotently", async () => {
    const data = seededData();
    const recorder = audit();

    await createEmailCampaign(localContext(), permissions, recorder, data, {
      id: "campaign_1",
      territoryId: ids.territories.own,
      templateId: "template_1",
      segmentId: ids.segment,
      campaignType: "newsletter",
      status: "draft",
      title: "Weekend ideas",
      subject: "Weekend ideas",
      preheader: "Things to do near you",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "campaign_version_1",
      campaignId: "campaign_1",
      versionNumber: 1,
      status: "draft",
      subject: "Weekend ideas",
      preheader: "Things to do near you",
      contentSnapshot: { blocks: [{ type: "article" }] },
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveEmailCampaignVersion(localContext(), permissions, recorder, data, "campaign_1", "campaign_version_1", "2026-08-11T10:00:00.000Z");
    const snapshot = await createRecipientSnapshot(localContext(), permissions, recorder, data, {
      id: "snapshot_1",
      campaignId: "campaign_1",
      campaignVersionId: "campaign_version_1",
      segmentId: ids.segment,
      status: "created",
      generatedAt: "2026-08-11T10:05:00.000Z",
      idempotencyKey: "snapshot:campaign_1:v1"
    });
    await scheduleEmailCampaign(localContext(), permissions, recorder, data, "campaign_1", "2026-08-12T09:00:00.000Z");
    const delivery = await recordEmailDeliveryEvent(localContext(), permissions, recorder, data, {
      id: "delivery_1",
      campaignId: "campaign_1",
      campaignVersionId: "campaign_version_1",
      recipientSnapshotId: snapshot.id,
      contactId: ids.contact,
      emailNormalised: "parent@example.test",
      providerKey: "test-provider",
      providerMessageId: "message_1",
      status: "delivered",
      eventType: "delivered",
      eventAt: "2026-08-12T09:01:00.000Z",
      metadata: {}
    });
    const duplicate = await recordEmailDeliveryEvent(localContext(), permissions, recorder, data, {
      ...delivery,
      id: "delivery_duplicate"
    });

    expect(snapshot).toMatchObject({
      recipientCount: 1,
      excludedCount: 0
    });
    expect(duplicate.id).toBe("delivery_1");
    expect(data.emailCampaigns[0]?.status).toBe("scheduled");
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.marketingEmailCampaignCreate,
      auditActions.marketingEmailCampaignApprove,
      auditActions.marketingEmailRecipientSnapshotCreate,
      auditActions.marketingEmailCampaignSchedule,
      auditActions.marketingEmailDeliveryRecord
    ]);
  });

  it("generates territory newsletter editions idempotently and preserves local overrides", async () => {
    const data = seededData();
    const recorder = audit();

    await createNetworkNewsletterMaster(hqContext(), permissions, recorder, data, {
      id: "master_1",
      templateId: "template_1",
      title: "Autumn ideas",
      status: "draft",
      seasonKey: "autumn",
      lockedBlocks: [{ key: "brand-header" }],
      optionalBlocks: [{ key: "days-out" }],
      localEditableBlocks: [{ key: "local-picks" }],
      contentRules: { requiredLocalBlocks: ["local-picks"] },
      createdByUserId: ids.users.hq,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveNetworkNewsletterMaster(hqContext(), permissions, recorder, data, "master_1", "2026-08-11T09:00:00.000Z");
    const run = await generateTerritoryNewsletterEditions(hqContext(), permissions, recorder, data, {
      id: "run_1",
      masterId: "master_1",
      territoryIds: [ids.territories.own, ids.territories.other],
      generatedAt: "2026-08-11T09:05:00.000Z",
      idempotencyKey: "master_1:initial"
    });
    const duplicate = await generateTerritoryNewsletterEditions(hqContext(), permissions, recorder, data, {
      ...run,
      territoryIds: [ids.territories.own, ids.territories.other]
    });
    const ownEdition = data.territoryNewsletterEditions.find((edition) => edition.territoryId === ids.territories.own);
    if (!ownEdition) throw new Error("Expected own territory edition.");

    await recordTerritoryNewsletterOverride(localContext(), permissions, recorder, data, ownEdition.id, {
      "local-picks": [{ title: "Sutton Park picnic trail" }]
    });
    await generateTerritoryNewsletterEditions(hqContext(), permissions, recorder, data, {
      id: "run_2",
      masterId: "master_1",
      territoryIds: [ids.territories.own],
      generatedAt: "2026-08-11T10:00:00.000Z",
      idempotencyKey: "master_1:refresh"
    });

    expect(run).toMatchObject({ totalTerritories: 2, blockedCount: 2 });
    expect(duplicate.id).toBe("run_1");
    expect(data.territoryNewsletterEditions).toHaveLength(2);
    expect(ownEdition.localOverrides).toMatchObject({
      "local-picks": [{ title: "Sutton Park picnic trail" }]
    });
    expect(listNewsletterFactory(localContext(), permissions, data).editions.map((edition) => edition.territoryId)).toEqual([ids.territories.own]);
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.marketingNewsletterMasterCreate,
      auditActions.marketingNewsletterMasterApprove,
      auditActions.marketingNewsletterFactoryGenerate,
      auditActions.marketingNewsletterLocalOverride,
      auditActions.marketingNewsletterFactoryGenerate
    ]);
  });

  it("fails closed for draft masters and cross-territory local newsletter overrides", async () => {
    const data = seededData();
    const recorder = audit();
    data.networkNewsletterMasters.push({
      id: "draft_master",
      templateId: "template_1",
      title: "Draft",
      status: "draft",
      seasonKey: null,
      lockedBlocks: [],
      optionalBlocks: [],
      localEditableBlocks: [],
      contentRules: {},
      createdByUserId: ids.users.hq,
      approvedByUserId: null,
      approvedAt: null
    });
    data.territoryNewsletterEditions.push({
      id: "other_edition",
      masterId: "draft_master",
      territoryId: ids.territories.other,
      emailCampaignId: null,
      status: "ready",
      inheritedBlocks: [],
      localOverrides: {},
      warnings: [],
      generatedAt: "2026-08-11T09:00:00.000Z",
      approvedAt: null
    });

    await expect(generateTerritoryNewsletterEditions(hqContext(), permissions, recorder, data, {
      id: "run_draft",
      masterId: "draft_master",
      territoryIds: [ids.territories.own],
      generatedAt: "2026-08-11T09:00:00.000Z",
      idempotencyKey: "draft"
    })).rejects.toThrow("Only approved newsletter masters");
    await expect(recordTerritoryNewsletterOverride(localContext(), permissions, recorder, data, "other_edition", {
      local: true
    })).rejects.toThrow("outside the active territory");
  });

  it("creates, activates and executes event-driven journeys with consent and idempotency", async () => {
    const data = seededData();
    const recorder = audit();

    await createJourney(hqContext(), permissions, recorder, data, journey(), journeyVersion());
    await approveJourneyVersion(hqContext(), permissions, recorder, data, "journey_welcome", "journey_welcome_v1", "2026-08-11T09:00:00.000Z");
    await activateJourney(hqContext(), permissions, recorder, data, "journey_welcome", "2026-08-11T09:05:00.000Z");
    const entry = await enterJourneyFromEvent(localContext(), permissions, recorder, data, {
      journeyId: "journey_welcome",
      contactId: ids.contact,
      territoryId: ids.territories.own,
      sourceEventType: "audience.subscribed",
      sourceEventId: "event_1",
      enteredAt: "2026-08-11T09:10:00.000Z",
      idempotencyKey: "audience.subscribed:event_1"
    });
    const duplicate = await enterJourneyFromEvent(localContext(), permissions, recorder, data, {
      journeyId: "journey_welcome",
      contactId: ids.contact,
      territoryId: ids.territories.own,
      sourceEventType: "audience.subscribed",
      sourceEventId: "event_1",
      enteredAt: "2026-08-11T09:10:00.000Z",
      idempotencyKey: "audience.subscribed:event_1"
    });
    const execution = await executeJourneyStep(localContext(), permissions, recorder, data, data.journeyExecutions[0]!.id, "welcome-email", "2026-08-11T09:11:00.000Z");

    expect(duplicate.id).toBe(entry.id);
    expect(execution.status).toBe("completed");
    expect(listJourneys(hqContext(), permissions, data).totals).toMatchObject({
      journeys: 1,
      active: 1,
      failedExecutions: 0
    });
    expect(recorder.events.map((event) => event.action)).toContain(auditActions.marketingJourneyStepExecute);
  });

  it("prevents journeys from sending to suppressed contacts and can pause automation", async () => {
    const data = seededData();
    const recorder = audit();
    data.journeys.push({ ...journey(), status: "active" });
    data.journeyVersions.push({ ...journeyVersion(), status: "approved" });
    await suppressContact(localContext(), permissions, recorder, data, {
      id: "suppression_journey",
      contactId: ids.contact,
      emailNormalised: "parent@example.test",
      territoryId: ids.territories.own,
      reason: "unsubscribe",
      source: "test",
      active: true,
      suppressedAt: "2026-08-11T09:00:00.000Z",
      metadata: {}
    });

    await expect(enterJourneyFromEvent(localContext(), permissions, recorder, data, {
      journeyId: "journey_welcome",
      contactId: ids.contact,
      territoryId: ids.territories.own,
      sourceEventType: "audience.subscribed",
      enteredAt: "2026-08-11T09:10:00.000Z",
      idempotencyKey: "blocked"
    })).rejects.toThrow("Suppressed contacts");
    await pauseJourney(hqContext(), permissions, recorder, data, "journey_welcome", "2026-08-11T10:00:00.000Z");
    expect(data.journeys[0]!.status).toBe("paused");
  });
});

function seededData(): MarketingData {
  const data = emptyData();
  data.contacts.push(contact("parent@example.test"));
  data.subscriptions.push(subscription("sub_own", ids.contact, ids.territories.own));
  data.consentEvents.push({
    id: "consent_1",
    contactId: ids.contact,
    territoryId: ids.territories.own,
    consentType: "newsletter",
    action: "granted",
    source: "signup",
    occurredAt: "2026-08-11T00:00:00.000Z",
    actorUserId: null,
    evidence: {}
  });
  data.segments.push({
    id: ids.segment,
    territoryId: ids.territories.own,
    key: "own-newsletter",
    name: "Own newsletter",
    segmentType: "dynamic",
    definition: { territoryId: ids.territories.own, interests: ["days-out"], eventCategories: ["family-activity"] },
    status: "active"
  });
  data.emailTemplates.push({
    id: "template_1",
    key: "standard-newsletter",
    name: "Standard newsletter",
    templateType: "newsletter",
    status: "approved",
    blocks: [],
    requiredBlocks: ["unsubscribe"],
    metadata: {}
  });
  return data;
}

function emptyData(): MarketingData {
  return {
    contacts: [],
    subscriptions: [],
    consentEvents: [],
    suppressions: [],
    segments: [],
    segmentMembers: [],
    imports: [],
    activityEvents: [],
    preferenceProfiles: [],
    savedContent: [],
    emailTemplates: [],
    emailCampaigns: [],
    emailCampaignVersions: [],
    emailRecipientSnapshots: [],
    emailDeliveryRecords: [],
    networkNewsletterMasters: [],
    territoryNewsletterEditions: [],
    newsletterFactoryRuns: [],
    journeys: [],
    journeyVersions: [],
    journeyAudienceEntries: [],
    journeyExecutions: [],
    journeyStepExecutions: [],
    socialPublications: [],
    territories: [
      { id: ids.territories.own, franchiseOrganisationId: ids.organisations.franchise, name: "Own" },
      { id: ids.territories.other, franchiseOrganisationId: "org_other", name: "Other" }
    ]
  };
}

function contact(email: string) {
  return {
    id: ids.contact,
    email,
    emailNormalised: email.trim().toLowerCase(),
    firstName: "Pat",
    lastName: "Parent",
    emailStatus: "subscribed",
    tags: ["days-out"],
    metadata: {}
  };
}

function subscription(id: string, contactId: string, territoryId: string) {
  return {
    id,
    contactId,
    territoryId,
    status: "subscribed" as const,
    source: "test",
    preferences: { newsletter: true },
    subscribedAt: "2026-08-11T00:00:00.000Z",
    unsubscribedAt: null
  };
}

function journey() {
  return {
    id: "journey_welcome",
    key: "welcome",
    name: "Welcome journey",
    territoryId: null,
    status: "draft" as const,
    purpose: "marketing",
    description: "Welcomes new subscribers.",
    frequencyCap: { maxPerContactPerDays: 1 },
    metadata: {},
    createdByUserId: ids.users.hq,
    approvedByUserId: null,
    approvedAt: null,
    activatedAt: null,
    pausedAt: null
  };
}

function journeyVersion() {
  return {
    id: "journey_welcome_v1",
    journeyId: "journey_welcome",
    versionNumber: 1,
    status: "draft",
    trigger: { eventType: "audience.subscribed" },
    conditions: [{ type: "subscribed", purpose: "newsletter" }],
    steps: [{ key: "welcome-email", actionType: "send_email", templateKey: "welcome" }],
    aiSuggestions: { subjectLines: ["Welcome to Raring2go"] },
    approvedByUserId: null,
    approvedAt: null
  };
}

function hqContext() {
  return { userId: ids.users.hq, organisationId: ids.organisations.hq };
}

function localContext() {
  return { userId: ids.users.local, organisationId: ids.organisations.franchise, territoryId: ids.territories.own };
}

function grant(roleId: string, module: string, action: string, scope: string) {
  return {
    roleId,
    permission: { id: `${module}:${action}`, module, action },
    scope
  };
}

function audit() {
  return {
    events: [] as Array<{ action: string }>,
    async record(event: { action: string }) {
      this.events.push(event);
    }
  };
}
