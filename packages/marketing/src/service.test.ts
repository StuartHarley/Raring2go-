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
  createNewsletterEditionCampaign,
  createRecipientSnapshot,
  enqueueEmailSend,
  generateUnsubscribeToken,
  enterJourneyFromEvent,
  executeJourneyStep,
  generateTerritoryNewsletterEditions,
  getPreferenceCentre,
  listEmailCampaigns,
  listJourneys,
  listMarketingAnalytics,
  listMarketingCommandCentre,
  listNewsletterFactory,
  MICROSOFT_SEND_RECIPIENT_CAP,
  nextEmailSendChunk,
  pauseJourney,
  createSegment,
  previewSegment,
  previewSegmentDefinition,
  updateSegment,
  recordConsentEvent,
  recordEmailDeliveryEvent,
  recordTerritoryNewsletterOverride,
  scheduleEmailCampaign,
  subscribeContactToTerritory,
  suppressContact,
  unsubscribeContactPublicly,
  updatePreferenceProfile,
  upsertAudienceContact,
  verifyUnsubscribeToken
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

  it("creates a segment with a nested rule tree and previews/matches it correctly", async () => {
    const data = seededData();
    const recorder = audit();
    await subscribeContactToTerritory(localContext(), permissions, recorder, data, subscription("sub_own_2", ids.contact, ids.territories.own));

    const segment = await createSegment(localContext(), permissions, recorder, data, {
      id: "segment_vip",
      key: "vip-sutton",
      name: "VIP Sutton subscribers",
      territoryId: ids.territories.own,
      definition: {
        kind: "group",
        match: "all",
        children: [
          { kind: "condition", field: "territoryId", operator: "equals", value: ids.territories.own },
          { kind: "condition", field: "tag", operator: "equals", value: "days-out" }
        ]
      }
    });

    expect(segment.segmentType).toBe("dynamic");
    expect(previewSegment(localContext(), permissions, data, "segment_vip")).toHaveLength(1);
    expect(recorder.events.map((event) => event.action)).toContain(auditActions.marketingSegmentCreate);

    await expect(
      createSegment(localContext(), permissions, recorder, data, {
        id: "segment_duplicate",
        key: "vip-sutton",
        name: "Duplicate key",
        territoryId: ids.territories.own,
        definition: { kind: "group", match: "all", children: [] }
      })
    ).rejects.toThrow("already exists");
  });

  it("rejects creating a segment scoped to a territory the actor cannot access", async () => {
    const data = seededData();
    await expect(
      createSegment(localContext(), permissions, audit(), data, {
        id: "segment_other",
        key: "other-territory",
        name: "Other territory",
        territoryId: ids.territories.other,
        definition: { kind: "group", match: "all", children: [] }
      })
    ).rejects.toThrow("outside the active territory");
  });

  it("updates a segment's rule definition and re-evaluates membership", async () => {
    const data = seededData();
    const recorder = audit();
    await createSegment(hqContext(), permissions, recorder, data, {
      id: "segment_updatable",
      key: "updatable",
      name: "Updatable",
      territoryId: ids.territories.own,
      definition: { kind: "group", match: "all", children: [{ kind: "condition", field: "tag", operator: "equals", value: "nonexistent-tag" }] }
    });

    expect(previewSegment(localContext(), permissions, data, "segment_updatable")).toHaveLength(0);

    await updateSegment(hqContext(), permissions, recorder, data, "segment_updatable", {
      definition: { kind: "group", match: "all", children: [{ kind: "condition", field: "subscriptionStatus", operator: "equals", value: "subscribed" }] }
    });

    expect(previewSegment(localContext(), permissions, data, "segment_updatable")).toHaveLength(1);
    expect(recorder.events.map((event) => event.action)).toContain(auditActions.marketingSegmentUpdate);
  });

  it("previews an in-progress, unsaved segment definition without requiring a saved segment", () => {
    const data = seededData();
    const preview = previewSegmentDefinition(localContext(), permissions, data, {
      territoryId: ids.territories.own,
      definition: { kind: "group", match: "all", children: [{ kind: "condition", field: "territoryId", operator: "equals", value: ids.territories.own }] }
    });
    expect(preview).toHaveLength(1);
    expect(preview[0]?.contact.id).toBe(ids.contact);
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

  it("surfaces per-campaign analytics and flags Outlook-sent campaigns as untracked", () => {
    const data = seededData();
    data.emailCampaigns.push(
      {
        id: "campaign_postmark",
        territoryId: ids.territories.own,
        templateId: "template_1",
        segmentId: ids.segment,
        campaignType: "newsletter",
        status: "sent",
        title: "Weekend ideas",
        subject: "Weekend ideas",
        preheader: null,
        sendProvider: "postmark",
        sendConnectionId: null,
        scheduledAt: "2026-08-12T09:00:00.000Z",
        approvedAt: "2026-08-11T10:00:00.000Z",
        sentAt: "2026-08-12T09:05:00.000Z",
        metadata: {}
      },
      {
        id: "campaign_outlook",
        territoryId: ids.territories.own,
        templateId: "template_1",
        segmentId: ids.segment,
        campaignType: "newsletter",
        status: "sent",
        title: "Local update",
        subject: "Local update",
        preheader: null,
        sendProvider: "microsoft",
        sendConnectionId: "connection_1",
        scheduledAt: "2026-08-12T09:00:00.000Z",
        approvedAt: "2026-08-11T10:00:00.000Z",
        sentAt: "2026-08-12T09:05:00.000Z",
        metadata: {}
      }
    );
    data.emailDeliveryRecords.push({
      id: "delivery_postmark",
      campaignId: "campaign_postmark",
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

    const analytics = listMarketingAnalytics(localContext(), permissions, data);
    const campaigns = analytics.email.campaigns;
    const postmark = campaigns.find((campaign) => campaign.campaignId === "campaign_postmark");
    const outlook = campaigns.find((campaign) => campaign.campaignId === "campaign_outlook");

    expect(postmark?.trackingAvailable).toBe(true);
    expect(postmark?.delivered).toBe(1);
    expect(outlook?.trackingAvailable).toBe(false);
    expect(outlook?.delivered).toBe(0);
    expect(outlook?.opens).toBeUndefined();
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
      sendProvider: "postmark",
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

  it("enqueues a scheduled campaign for sending exactly once and surfaces the active job", async () => {
    const data = seededData();
    const recorder = audit();

    await createEmailCampaign(localContext(), permissions, recorder, data, {
      id: "campaign_2",
      territoryId: ids.territories.own,
      templateId: "template_1",
      segmentId: ids.segment,
      campaignType: "newsletter",
      status: "draft",
      title: "Half term",
      subject: "Half term",
      preheader: null,
      sendProvider: "postmark",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "campaign_2_v1",
      campaignId: "campaign_2",
      versionNumber: 1,
      status: "draft",
      subject: "Half term",
      preheader: null,
      contentSnapshot: {},
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveEmailCampaignVersion(localContext(), permissions, recorder, data, "campaign_2", "campaign_2_v1", "2026-08-11T10:00:00.000Z");

    expect(() =>
      enqueueEmailSend(localContext(), permissions, data, { id: "job_early", campaignId: "campaign_2" })
    ).toThrow("Only scheduled campaigns");

    await createRecipientSnapshot(localContext(), permissions, recorder, data, {
      id: "snapshot_2",
      campaignId: "campaign_2",
      campaignVersionId: "campaign_2_v1",
      segmentId: ids.segment,
      status: "created",
      generatedAt: "2026-08-11T10:05:00.000Z",
      idempotencyKey: "snapshot:campaign_2:v1"
    });
    await scheduleEmailCampaign(localContext(), permissions, recorder, data, "campaign_2", "2026-08-12T09:00:00.000Z");

    const job = enqueueEmailSend(localContext(), permissions, data, { id: "job_1", campaignId: "campaign_2" });
    const duplicate = enqueueEmailSend(localContext(), permissions, data, { id: "job_2", campaignId: "campaign_2" });

    expect(job).toMatchObject({
      id: "job_1",
      campaignId: "campaign_2",
      recipientSnapshotId: "snapshot_2",
      status: "queued",
      cursor: 0,
      nextAttemptAt: "2026-08-12T09:00:00.000Z"
    });
    expect(duplicate.id).toBe("job_1");
    expect(data.emailSendJobs).toHaveLength(1);

    const overview = listEmailCampaigns(localContext(), permissions, data);
    const view = overview.campaigns.find((candidate) => candidate.campaign.id === "campaign_2");
    expect(view?.activeJob?.id).toBe("job_1");
  });

  it("rejects creating a campaign set to send via Outlook without a connected mailbox", async () => {
    const data = seededData();
    const recorder = audit();

    await expect(
      createEmailCampaign(localContext(), permissions, recorder, data, {
        id: "campaign_outlook_missing_connection",
        territoryId: ids.territories.own,
        templateId: "template_1",
        segmentId: ids.segment,
        campaignType: "newsletter",
        status: "draft",
        title: "Outlook draft",
        subject: "Outlook draft",
        preheader: null,
        sendProvider: "microsoft",
        sendConnectionId: null,
        scheduledAt: null,
        approvedAt: null,
        sentAt: null,
        metadata: {}
      }, {
        id: "campaign_outlook_missing_connection_v1",
        campaignId: "campaign_outlook_missing_connection",
        versionNumber: 1,
        status: "draft",
        subject: "Outlook draft",
        preheader: null,
        contentSnapshot: {},
        createdByUserId: ids.users.local,
        approvedByUserId: null,
        approvedAt: null
      })
    ).rejects.toThrow("A connected Outlook mailbox is required");
  });

  it("enforces the Outlook recipient cap and otherwise queues a Microsoft-provider send job", async () => {
    const data = seededData();
    const recorder = audit();

    await createEmailCampaign(localContext(), permissions, recorder, data, {
      id: "campaign_outlook",
      territoryId: ids.territories.own,
      templateId: "template_1",
      segmentId: ids.segment,
      campaignType: "newsletter",
      status: "draft",
      title: "Outlook local send",
      subject: "Outlook local send",
      preheader: null,
      sendProvider: "microsoft",
      sendConnectionId: "connection_1",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "campaign_outlook_v1",
      campaignId: "campaign_outlook",
      versionNumber: 1,
      status: "draft",
      subject: "Outlook local send",
      preheader: null,
      contentSnapshot: {},
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveEmailCampaignVersion(localContext(), permissions, recorder, data, "campaign_outlook", "campaign_outlook_v1", "2026-08-11T10:00:00.000Z");
    await scheduleEmailCampaign(localContext(), permissions, recorder, data, "campaign_outlook", "2026-08-12T09:00:00.000Z");
    data.emailRecipientSnapshots.push({
      id: "snapshot_outlook",
      campaignId: "campaign_outlook",
      campaignVersionId: "campaign_outlook_v1",
      segmentId: ids.segment,
      status: "created",
      generatedAt: "2026-08-11T10:05:00.000Z",
      recipientCount: MICROSOFT_SEND_RECIPIENT_CAP + 1,
      excludedCount: 0,
      recipients: [],
      exclusions: [],
      idempotencyKey: "snapshot:campaign_outlook:v1"
    });

    expect(() =>
      enqueueEmailSend(localContext(), permissions, data, { id: "job_outlook_over_cap", campaignId: "campaign_outlook" })
    ).toThrow(`Outlook sending is limited to ${MICROSOFT_SEND_RECIPIENT_CAP} recipients`);

    data.emailRecipientSnapshots[data.emailRecipientSnapshots.length - 1]!.recipientCount = 5;

    const job = enqueueEmailSend(localContext(), permissions, data, { id: "job_outlook", campaignId: "campaign_outlook" });

    expect(job).toMatchObject({
      sendProvider: "microsoft",
      sendConnectionId: "connection_1",
      batchSize: 10
    });
  });

  it("computes the next send chunk and detects the final chunk", () => {
    const snapshot = {
      id: "snapshot_1",
      campaignId: "campaign_1",
      campaignVersionId: "campaign_version_1",
      segmentId: null,
      status: "created",
      generatedAt: "2026-08-11T10:05:00.000Z",
      recipientCount: 5,
      excludedCount: 0,
      recipients: [0, 1, 2, 3, 4].map((index) => ({ contactId: `contact_${index}`, emailNormalised: `p${index}@example.test`, territoryIds: [] })),
      exclusions: [],
      idempotencyKey: "snapshot:campaign_1:v1"
    };
    const job = {
      id: "job_1",
      campaignId: "campaign_1",
      campaignVersionId: "campaign_version_1",
      recipientSnapshotId: "snapshot_1",
      sendProvider: "postmark" as const,
      status: "processing" as const,
      cursor: 0,
      batchSize: 2,
      attempts: 1,
      maxAttempts: 5,
      nextAttemptAt: "2026-08-12T09:00:00.000Z"
    };

    const first = nextEmailSendChunk(job, snapshot);
    expect(first.recipients).toHaveLength(2);
    expect(first.isFinalChunk).toBe(false);

    const last = nextEmailSendChunk({ ...job, cursor: 4 }, snapshot);
    expect(last.recipients).toHaveLength(1);
    expect(last.isFinalChunk).toBe(true);

    const empty = nextEmailSendChunk({ ...job, cursor: 5 }, snapshot);
    expect(empty.recipients).toHaveLength(0);
    expect(empty.isFinalChunk).toBe(true);
  });

  it("auto-suppresses contacts on unsubscribe and hard bounce, but not soft bounce", async () => {
    const data = seededData();
    const recorder = audit();

    const unsubscribed = await recordEmailDeliveryEvent(hqContext(), permissions, recorder, data, {
      id: "delivery_unsub",
      campaignId: "campaign_1",
      campaignVersionId: "campaign_version_1",
      recipientSnapshotId: "snapshot_1",
      contactId: ids.contact,
      emailNormalised: "parent@example.test",
      providerKey: "postmark",
      providerMessageId: "message_unsub",
      status: "failed",
      eventType: "unsubscribed",
      eventAt: "2026-08-12T09:01:00.000Z",
      metadata: {}
    });

    expect(unsubscribed).toBeDefined();
    expect(data.contacts.find((contact) => contact.id === ids.contact)?.emailStatus).toBe("suppressed");
    expect(data.suppressions).toHaveLength(1);
    expect(data.suppressions[0]).toMatchObject({ contactId: ids.contact, reason: "provider_unsubscribe" });
  });

  it("auto-suppresses on a hard bounce but not on a soft bounce", async () => {
    const soft = seededData();
    const softRecorder = audit();

    await recordEmailDeliveryEvent(hqContext(), permissions, softRecorder, soft, {
      id: "delivery_soft",
      campaignId: "campaign_1",
      campaignVersionId: "campaign_version_1",
      recipientSnapshotId: "snapshot_1",
      contactId: ids.contact,
      emailNormalised: "parent@example.test",
      providerKey: "postmark",
      providerMessageId: "message_soft",
      status: "failed",
      eventType: "bounced",
      eventAt: "2026-08-12T09:01:00.000Z",
      metadata: { type: "SoftBounce" }
    });

    expect(soft.suppressions).toHaveLength(0);
    expect(soft.contacts.find((contact) => contact.id === ids.contact)?.emailStatus).toBe("subscribed");

    const hard = seededData();
    const hardRecorder = audit();

    await recordEmailDeliveryEvent(hqContext(), permissions, hardRecorder, hard, {
      id: "delivery_hard",
      campaignId: "campaign_1",
      campaignVersionId: "campaign_version_1",
      recipientSnapshotId: "snapshot_1",
      contactId: ids.contact,
      emailNormalised: "parent@example.test",
      providerKey: "postmark",
      providerMessageId: "message_hard",
      status: "failed",
      eventType: "bounced",
      eventAt: "2026-08-12T09:01:00.000Z",
      metadata: { type: "HardBounce" }
    });

    expect(hard.suppressions).toHaveLength(1);
    expect(hard.suppressions[0]).toMatchObject({ reason: "provider_hard_bounce" });
    expect(hard.contacts.find((contact) => contact.id === ids.contact)?.emailStatus).toBe("suppressed");
  });

  it("resolves the contact by normalised email when a delivery event has no contactId", async () => {
    const data = seededData();
    const recorder = audit();

    await recordEmailDeliveryEvent(hqContext(), permissions, recorder, data, {
      id: "delivery_no_contact_id",
      campaignId: "campaign_1",
      campaignVersionId: "campaign_version_1",
      recipientSnapshotId: "snapshot_1",
      contactId: null,
      emailNormalised: "parent@example.test",
      providerKey: "postmark",
      providerMessageId: "message_no_id",
      status: "failed",
      eventType: "complained",
      eventAt: "2026-08-12T09:01:00.000Z",
      metadata: {}
    });

    expect(data.suppressions).toHaveLength(1);
    expect(data.suppressions[0]).toMatchObject({ contactId: ids.contact, reason: "provider_spam_complaint" });
  });

  it("verifies unsubscribe tokens and applies a public unsubscribe exactly once", () => {
    const secret = "unsubscribe-secret";
    const token = generateUnsubscribeToken(secret, ids.contact, "campaign_1");

    expect(verifyUnsubscribeToken(secret, ids.contact, "campaign_1", token)).toBe(true);
    expect(verifyUnsubscribeToken(secret, ids.contact, "campaign_1", "wrong-token")).toBe(false);
    expect(verifyUnsubscribeToken(secret, ids.contact, "campaign_other", token)).toBe(false);

    const data = seededData();
    const first = unsubscribeContactPublicly(data, { contactId: ids.contact, campaignId: "campaign_1" });
    const second = unsubscribeContactPublicly(data, { contactId: ids.contact, campaignId: "campaign_1" });

    expect(first?.suppression.reason).toBe("recipient_unsubscribe");
    expect(data.contacts.find((contact) => contact.id === ids.contact)?.emailStatus).toBe("suppressed");
    expect(data.suppressions).toHaveLength(1);
    expect(second?.suppression.id).toBe(first?.suppression.id);
    expect(unsubscribeContactPublicly(data, { contactId: "unknown_contact", campaignId: "campaign_1" })).toBeUndefined();
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

  it("clears a required-block warning once the franchisee supplies the local content", async () => {
    const data = seededData();
    const recorder = audit();

    await createNetworkNewsletterMaster(hqContext(), permissions, recorder, data, {
      id: "master_2",
      templateId: "template_1",
      title: "Half term guide",
      status: "draft",
      seasonKey: "half-term",
      lockedBlocks: [{ key: "brand-header" }],
      optionalBlocks: [],
      localEditableBlocks: [{ key: "local-picks" }],
      contentRules: { requiredLocalBlocks: ["local-picks"] },
      createdByUserId: ids.users.hq,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveNetworkNewsletterMaster(hqContext(), permissions, recorder, data, "master_2", "2026-08-11T09:00:00.000Z");
    await generateTerritoryNewsletterEditions(hqContext(), permissions, recorder, data, {
      id: "run_own",
      masterId: "master_2",
      territoryIds: [ids.territories.own],
      generatedAt: "2026-08-11T09:05:00.000Z",
      idempotencyKey: "master_2:initial"
    });
    const edition = data.territoryNewsletterEditions.find((candidate) => candidate.masterId === "master_2");
    if (!edition) throw new Error("Expected a generated edition.");
    expect(edition.status).toBe("blocked");

    await recordTerritoryNewsletterOverride(localContext(), permissions, recorder, data, edition.id, {
      "local-picks": [{ title: "Half term craft fair" }]
    });

    expect(edition.status).toBe("ready");
    expect(edition.warnings).toEqual([]);
  });

  it("creates a draft campaign from a ready territory edition and blocks a blocked one", async () => {
    const data = seededData();
    const recorder = audit();

    await createNetworkNewsletterMaster(hqContext(), permissions, recorder, data, {
      id: "master_3",
      templateId: "template_1",
      title: "Spring guide",
      status: "draft",
      seasonKey: "spring",
      lockedBlocks: [{ key: "brand-header" }],
      optionalBlocks: [],
      localEditableBlocks: [],
      contentRules: {},
      createdByUserId: ids.users.hq,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveNetworkNewsletterMaster(hqContext(), permissions, recorder, data, "master_3", "2026-08-11T09:00:00.000Z");
    await generateTerritoryNewsletterEditions(hqContext(), permissions, recorder, data, {
      id: "run_spring",
      masterId: "master_3",
      territoryIds: [ids.territories.own],
      generatedAt: "2026-08-11T09:05:00.000Z",
      idempotencyKey: "master_3:initial"
    });
    const edition = data.territoryNewsletterEditions.find((candidate) => candidate.masterId === "master_3");
    if (!edition) throw new Error("Expected a generated edition.");
    expect(edition.status).toBe("ready");

    const result = await createNewsletterEditionCampaign(localContext(), permissions, recorder, data, {
      editionId: edition.id,
      campaignId: "campaign_from_edition",
      versionId: "campaign_from_edition_v1",
      segmentId: ids.segment,
      subject: "Your local spring guide"
    });

    expect(result.campaign).toMatchObject({
      territoryId: ids.territories.own,
      status: "draft",
      subject: "Your local spring guide"
    });
    expect(edition.emailCampaignId).toBe("campaign_from_edition");
    expect(data.emailCampaigns).toHaveLength(1);

    await expect(
      createNewsletterEditionCampaign(localContext(), permissions, recorder, data, {
        editionId: edition.id,
        campaignId: "campaign_from_edition_2",
        versionId: "campaign_from_edition_2_v1",
        segmentId: ids.segment,
        subject: "Duplicate attempt"
      })
    ).rejects.toThrow("already linked");

    data.territoryNewsletterEditions.push({
      id: "blocked_edition",
      masterId: "master_3",
      territoryId: ids.territories.own,
      emailCampaignId: null,
      status: "blocked",
      inheritedBlocks: [],
      localOverrides: {},
      warnings: [{ code: "required_local_content", severity: "blocking", territoryId: ids.territories.own, block: "local-picks" }],
      generatedAt: "2026-08-11T09:05:00.000Z",
      approvedAt: null
    });

    await expect(
      createNewsletterEditionCampaign(localContext(), permissions, recorder, data, {
        editionId: "blocked_edition",
        campaignId: "campaign_blocked",
        versionId: "campaign_blocked_v1",
        segmentId: ids.segment,
        subject: "Should not send"
      })
    ).rejects.toThrow("Blocked territory editions");
  });

  it("keeps national newsletters HQ-only and blocks franchisees from acting on network-wide campaigns", async () => {
    const data = seededData();
    data.segments.push({
      id: "segment_network",
      territoryId: null,
      key: "network",
      name: "All subscribers",
      segmentType: "dynamic",
      definition: {},
      status: "active"
    });
    const recorder = audit();

    await expect(
      createEmailCampaign(localContext(), permissions, recorder, data, {
        id: "national_campaign",
        territoryId: null,
        templateId: "template_1",
        segmentId: "segment_network",
        campaignType: "newsletter",
        status: "draft",
        title: "National guide",
        subject: "National guide",
        preheader: null,
        sendProvider: "postmark",
        scheduledAt: null,
        approvedAt: null,
        sentAt: null,
        metadata: {}
      }, {
        id: "national_campaign_v1",
        campaignId: "national_campaign",
        versionNumber: 1,
        status: "draft",
        subject: "National guide",
        preheader: null,
        contentSnapshot: {},
        createdByUserId: ids.users.local,
        approvedByUserId: null,
        approvedAt: null
      })
    ).rejects.toThrow("network-wide campaign");

    await createEmailCampaign(hqContext(), permissions, recorder, data, {
      id: "national_campaign",
      territoryId: null,
      templateId: "template_1",
      segmentId: "segment_network",
      campaignType: "newsletter",
      status: "draft",
      title: "National guide",
      subject: "National guide",
      preheader: null,
      sendProvider: "postmark",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "national_campaign_v1",
      campaignId: "national_campaign",
      versionNumber: 1,
      status: "draft",
      subject: "National guide",
      preheader: null,
      contentSnapshot: {},
      createdByUserId: ids.users.hq,
      approvedByUserId: null,
      approvedAt: null
    });

    await expect(
      approveEmailCampaignVersion(localContext(), permissions, recorder, data, "national_campaign", "national_campaign_v1", "2026-08-11T09:00:00.000Z")
    ).rejects.toThrow("network-wide campaign");

    await approveEmailCampaignVersion(hqContext(), permissions, recorder, data, "national_campaign", "national_campaign_v1", "2026-08-11T09:00:00.000Z");

    await expect(
      scheduleEmailCampaign(localContext(), permissions, recorder, data, "national_campaign", "2026-08-12T09:00:00.000Z")
    ).rejects.toThrow("network-wide campaign");
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
    emailSendJobs: [],
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
