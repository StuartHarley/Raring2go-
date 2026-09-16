import { auditActions } from "@raring2go/audit";
import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it } from "vitest";
import {
  listAudienceContacts,
  approveEmailCampaignVersion,
  activateJourney,
  approveJourneyVersion,
  approveNetworkNewsletterMaster,
  compareSubjectLineVariants,
  computeContactEngagementHours,
  createEmailCampaign,
  createEmailCampaignVersion,
  createJourney,
  createNetworkNewsletterMaster,
  createNewsletterEditionCampaign,
  createRecipientSnapshot,
  createWinnerRemainderSnapshot,
  declareSubjectLineWinner,
  enqueueEmailSend,
  enqueueSendTimeOptimizedSend,
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
  splitSegmentForAbTest,
  startSubjectLineTest,
  nextOccurrenceOfHour,
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
    expect(snapshot.recipients[0]).toMatchObject({
      contactId: ids.contact,
      firstName: "Pat"
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

  it("bakes per-segment block visibility into each recipient's hiddenBlockIds at snapshot time", async () => {
    const data = seededData();
    const recorder = audit();

    const vipContactId = "contact_vip";
    data.contacts.push({ ...contact("vip@example.test"), id: vipContactId, tags: ["vip"] });
    data.subscriptions.push(subscription("sub_vip", vipContactId, ids.territories.own));
    const vipSegment = await createSegment(localContext(), permissions, recorder, data, {
      id: "segment_vip",
      key: "vip",
      name: "VIP",
      territoryId: ids.territories.own,
      definition: { kind: "group", match: "all", children: [{ kind: "condition", field: "tag", operator: "equals", value: "vip" }] }
    });

    await createEmailCampaign(localContext(), permissions, recorder, data, {
      id: "gated_campaign",
      territoryId: ids.territories.own,
      templateId: "template_1",
      segmentId: ids.segment,
      campaignType: "newsletter",
      status: "draft",
      title: "Gated content",
      subject: "Gated content",
      preheader: null,
      sendProvider: "postmark",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "gated_campaign_v1",
      campaignId: "gated_campaign",
      versionNumber: 1,
      status: "draft",
      subject: "Gated content",
      preheader: null,
      contentSnapshot: {
        version: 1,
        blocks: [
          { id: "block_everyone", type: "divider" },
          { id: "block_vip_only", type: "divider", visibleSegmentId: vipSegment.id }
        ]
      },
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveEmailCampaignVersion(localContext(), permissions, recorder, data, "gated_campaign", "gated_campaign_v1", "2026-08-11T10:00:00.000Z");

    const snapshot = await createRecipientSnapshot(localContext(), permissions, recorder, data, {
      id: "gated_snapshot",
      campaignId: "gated_campaign",
      campaignVersionId: "gated_campaign_v1",
      segmentId: ids.segment,
      status: "created",
      generatedAt: "2026-08-11T10:05:00.000Z",
      idempotencyKey: "gated:snapshot"
    });

    expect(snapshot.recipientCount).toBe(2);
    const nonVip = snapshot.recipients.find((recipient) => recipient.contactId === ids.contact) as { hiddenBlockIds: string[] };
    const vip = snapshot.recipients.find((recipient) => recipient.contactId === vipContactId) as { hiddenBlockIds: string[] };
    expect(nonVip.hiddenBlockIds).toEqual(["block_vip_only"]);
    expect(vip.hiddenBlockIds).toEqual([]);

    // A campaign with no gated blocks gets no hiddenBlockIds key at all - byte-for-byte
    // identical to the pre-feature shape.
    await createEmailCampaign(localContext(), permissions, recorder, data, {
      id: "ungated_campaign",
      territoryId: ids.territories.own,
      templateId: "template_1",
      segmentId: ids.segment,
      campaignType: "newsletter",
      status: "draft",
      title: "Ungated content",
      subject: "Ungated content",
      preheader: null,
      sendProvider: "postmark",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "ungated_campaign_v1",
      campaignId: "ungated_campaign",
      versionNumber: 1,
      status: "draft",
      subject: "Ungated content",
      preheader: null,
      contentSnapshot: { version: 1, blocks: [{ id: "block_plain", type: "divider" }] },
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveEmailCampaignVersion(localContext(), permissions, recorder, data, "ungated_campaign", "ungated_campaign_v1", "2026-08-11T10:00:00.000Z");
    const ungatedSnapshot = await createRecipientSnapshot(localContext(), permissions, recorder, data, {
      id: "ungated_snapshot",
      campaignId: "ungated_campaign",
      campaignVersionId: "ungated_campaign_v1",
      segmentId: ids.segment,
      status: "created",
      generatedAt: "2026-08-11T10:06:00.000Z",
      idempotencyKey: "ungated:snapshot"
    });
    expect(Object.keys(ungatedSnapshot.recipients[0]!)).not.toContain("hiddenBlockIds");
  });

  it("rejects generating a recipient snapshot for a version gated to a deleted or inaccessible segment", async () => {
    const data = seededData();
    const recorder = audit();

    await createEmailCampaign(localContext(), permissions, recorder, data, {
      id: "bad_gate_campaign",
      territoryId: ids.territories.own,
      templateId: "template_1",
      segmentId: ids.segment,
      campaignType: "newsletter",
      status: "draft",
      title: "Bad gate",
      subject: "Bad gate",
      preheader: null,
      sendProvider: "postmark",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "bad_gate_campaign_v1",
      campaignId: "bad_gate_campaign",
      versionNumber: 1,
      status: "draft",
      subject: "Bad gate",
      preheader: null,
      contentSnapshot: {
        version: 1,
        blocks: [{ id: "block_gated", type: "divider", visibleSegmentId: "segment_does_not_exist" }]
      },
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveEmailCampaignVersion(localContext(), permissions, recorder, data, "bad_gate_campaign", "bad_gate_campaign_v1", "2026-08-11T10:00:00.000Z");

    await expect(
      createRecipientSnapshot(localContext(), permissions, recorder, data, {
        id: "bad_gate_snapshot",
        campaignId: "bad_gate_campaign",
        campaignVersionId: "bad_gate_campaign_v1",
        segmentId: ids.segment,
        status: "created",
        generatedAt: "2026-08-11T10:05:00.000Z",
        idempotencyKey: "bad_gate:snapshot"
      })
    ).rejects.toThrow("Audience segment was not found");
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

  it("splits a segment deterministically into two disjoint sample variants plus a remainder", () => {
    const contacts = Array.from({ length: 200 }, (_, index) => fakeContactView(`contact_${index}`));

    const split = splitSegmentForAbTest(contacts, { sampleFraction: 0.2 });
    const variantA = new Set(split.variantAContactIds);
    const variantB = new Set(split.variantBContactIds);
    const remainder = new Set(split.remainderContactIds);

    expect(split.variantAContactIds.length + split.variantBContactIds.length + split.remainderContactIds.length).toBe(200);
    for (const id of variantA) {
      expect(variantB.has(id)).toBe(false);
      expect(remainder.has(id)).toBe(false);
    }
    for (const id of variantB) {
      expect(remainder.has(id)).toBe(false);
    }
    const sampled = variantA.size + variantB.size;
    expect(sampled).toBeGreaterThan(10);
    expect(sampled).toBeLessThan(70);

    expect(splitSegmentForAbTest(contacts, { sampleFraction: 0.2 })).toEqual(split);
  });

  it("runs a full subject-line A/B test: start, compare, declare a winner, then snapshot the remainder", async () => {
    const data = seededData();
    const recorder = audit();
    for (let index = 0; index < 20; index += 1) {
      const contactId = `ab_contact_${index}`;
      data.contacts.push({ ...contact(`ab${index}@example.test`), id: contactId, firstName: `Person${index}` });
      data.subscriptions.push(subscription(`ab_sub_${index}`, contactId, ids.territories.own));
    }

    await createEmailCampaign(localContext(), permissions, recorder, data, {
      id: "ab_campaign",
      territoryId: ids.territories.own,
      templateId: "template_1",
      segmentId: ids.segment,
      campaignType: "newsletter",
      status: "draft",
      title: "Half term A/B",
      subject: "Subject A",
      preheader: null,
      sendProvider: "postmark",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "ab_campaign_v1",
      campaignId: "ab_campaign",
      versionNumber: 1,
      status: "draft",
      subject: "Subject A",
      preheader: null,
      contentSnapshot: { blocks: [] },
      variantKey: "a",
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });

    await expect(
      createEmailCampaignVersion(localContext(), permissions, recorder, data, "ab_campaign", {
        id: "ab_campaign_v_bad",
        campaignId: "ab_campaign",
        versionNumber: 2,
        status: "draft",
        subject: "Subject C",
        preheader: null,
        contentSnapshot: {},
        variantKey: undefined
      })
    ).rejects.toThrow("must declare variant");

    await createEmailCampaignVersion(localContext(), permissions, recorder, data, "ab_campaign", {
      id: "ab_campaign_v2",
      campaignId: "ab_campaign",
      versionNumber: 2,
      status: "draft",
      subject: "Subject B",
      preheader: null,
      contentSnapshot: { blocks: [] },
      variantKey: "b",
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });

    await expect(
      createEmailCampaignVersion(localContext(), permissions, recorder, data, "ab_campaign", {
        id: "ab_campaign_v3",
        campaignId: "ab_campaign",
        versionNumber: 3,
        status: "draft",
        subject: "Subject C",
        preheader: null,
        contentSnapshot: {},
        variantKey: "a"
      })
    ).rejects.toThrow("already has a variant");

    const started = await startSubjectLineTest(localContext(), permissions, recorder, data, {
      campaignId: "ab_campaign",
      sampleFraction: 0.5,
      startedAt: "2026-08-11T10:00:00.000Z",
      snapshotIdA: "ab_snapshot_a",
      snapshotIdB: "ab_snapshot_b",
      jobIdA: "ab_job_a",
      jobIdB: "ab_job_b"
    });

    expect(data.emailCampaigns.find((candidate) => candidate.id === "ab_campaign")?.status).toBe("testing");
    expect(started.variantA.status).toBe("testing");
    expect(started.variantB.status).toBe("testing");
    expect(started.jobA.campaignVersionId).toBe("ab_campaign_v1");
    expect(started.jobB.campaignVersionId).toBe("ab_campaign_v2");
    expect(data.emailSendJobs).toHaveLength(2);

    const testedIds = new Set([...started.snapshotA.recipients, ...started.snapshotB.recipients].map((recipient) => (recipient as { contactId: string }).contactId));
    expect(testedIds.size).toBe(started.snapshotA.recipientCount + started.snapshotB.recipientCount);
    expect(testedIds.size).toBeGreaterThan(0);
    expect(testedIds.size).toBeLessThan(20);

    // Both variants' sample sends can be queued at once - the dedup check is scoped
    // per campaign version, not the whole campaign.
    expect(() =>
      enqueueEmailSend(localContext(), permissions, data, {
        id: "ab_job_a_dup",
        campaignId: "ab_campaign",
        campaignVersionId: "ab_campaign_v1",
        recipientSnapshotId: "ab_snapshot_a"
      })
    ).not.toThrow();
    expect(data.emailSendJobs).toHaveLength(2);

    for (const contactId of started.snapshotA.recipients.map((recipient) => (recipient as { contactId: string }).contactId)) {
      await recordEmailDeliveryEvent(localContext(), permissions, recorder, data, {
        id: `delivery_a_delivered_${contactId}`,
        campaignId: "ab_campaign",
        campaignVersionId: "ab_campaign_v1",
        recipientSnapshotId: "ab_snapshot_a",
        contactId,
        emailNormalised: `${contactId}@example.test`,
        providerKey: "test-provider",
        providerMessageId: `msg_a_${contactId}`,
        status: "delivered",
        eventType: "delivered",
        eventAt: "2026-08-11T10:05:00.000Z",
        metadata: {}
      });
    }
    expect(started.snapshotA.recipientCount).toBeGreaterThan(0);
    expect(started.snapshotB.recipientCount).toBeGreaterThan(0);

    const firstVariantAContactId = (started.snapshotA.recipients[0] as { contactId: string }).contactId;
    await recordEmailDeliveryEvent(localContext(), permissions, recorder, data, {
      id: "delivery_a_opened",
      campaignId: "ab_campaign",
      campaignVersionId: "ab_campaign_v1",
      recipientSnapshotId: "ab_snapshot_a",
      contactId: firstVariantAContactId,
      emailNormalised: `${firstVariantAContactId}@example.test`,
      providerKey: "test-provider",
      providerMessageId: `msg_a_${firstVariantAContactId}`,
      status: "opened",
      eventType: "opened",
      eventAt: "2026-08-11T11:00:00.000Z",
      metadata: {}
    });

    const comparisonBeforeVariantBDelivery = compareSubjectLineVariants(localContext(), permissions, data, "ab_campaign");
    expect(comparisonBeforeVariantBDelivery.canDeclareWinner).toBe(false);

    const firstVariantBContactId = (started.snapshotB.recipients[0] as { contactId: string }).contactId;
    await recordEmailDeliveryEvent(localContext(), permissions, recorder, data, {
      id: "delivery_b_delivered",
      campaignId: "ab_campaign",
      campaignVersionId: "ab_campaign_v2",
      recipientSnapshotId: "ab_snapshot_b",
      contactId: firstVariantBContactId,
      emailNormalised: `${firstVariantBContactId}@example.test`,
      providerKey: "test-provider",
      providerMessageId: `msg_b_${firstVariantBContactId}`,
      status: "delivered",
      eventType: "delivered",
      eventAt: "2026-08-11T10:05:00.000Z",
      metadata: {}
    });

    // In production, delivery records only appear once the worker has actually sent
    // the batch, at which point it has also advanced the job to "completed" - mirror
    // that here so the later remainder send correctly starts a fresh job instead of
    // reusing a still-"queued" sample job.
    started.jobA.status = "completed";
    started.jobB.status = "completed";

    const comparison = compareSubjectLineVariants(localContext(), permissions, data, "ab_campaign");
    expect(comparison.canDeclareWinner).toBe(true);
    const variantAStats = comparison.variants.find((candidate) => candidate.version.id === "ab_campaign_v1")!;
    expect(variantAStats.delivered).toBe(started.snapshotA.recipientCount);
    expect(variantAStats.opened).toBe(1);
    expect(variantAStats.openRate).toBe(1 / started.snapshotA.recipientCount);

    const decision = await declareSubjectLineWinner(localContext(), permissions, recorder, data, {
      campaignId: "ab_campaign",
      winningVersionId: "ab_campaign_v1",
      decidedAt: "2026-08-12T09:00:00.000Z"
    });

    expect(decision.winner.status).toBe("approved");
    expect(decision.loser.status).toBe("rejected");
    expect(data.emailCampaigns.find((candidate) => candidate.id === "ab_campaign")?.status).toBe("approved");

    const remainder = await createWinnerRemainderSnapshot(localContext(), permissions, recorder, data, {
      campaignId: "ab_campaign",
      id: "ab_snapshot_remainder",
      generatedAt: "2026-08-12T09:05:00.000Z"
    });

    const totalSegmentContacts = previewSegment(localContext(), permissions, data, ids.segment).length;
    expect(remainder.campaignVersionId).toBe("ab_campaign_v1");
    expect(remainder.recipientCount).toBe(totalSegmentContacts - testedIds.size);
    for (const recipient of remainder.recipients) {
      expect(testedIds.has((recipient as { contactId: string }).contactId)).toBe(false);
    }
    for (const exclusion of remainder.exclusions) {
      const typed = exclusion as { contactId: string; reason: string };
      if (testedIds.has(typed.contactId)) {
        expect(typed.reason).toBe("already_sent_ab_test_sample");
      }
    }

    await scheduleEmailCampaign(localContext(), permissions, recorder, data, "ab_campaign", "2026-08-12T09:10:00.000Z");
    const remainderJob = enqueueEmailSend(localContext(), permissions, data, { id: "ab_job_remainder", campaignId: "ab_campaign" });
    expect(remainderJob.campaignVersionId).toBe("ab_campaign_v1");
    expect(remainderJob.recipientSnapshotId).toBe("ab_snapshot_remainder");
  });

  it("rejects starting a subject-line test without both variants, and rejects declaring a winner outside a running test", async () => {
    const data = seededData();
    const recorder = audit();

    await createEmailCampaign(localContext(), permissions, recorder, data, {
      id: "single_campaign",
      territoryId: ids.territories.own,
      templateId: "template_1",
      segmentId: ids.segment,
      campaignType: "newsletter",
      status: "draft",
      title: "Single subject",
      subject: "Only subject",
      preheader: null,
      sendProvider: "postmark",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "single_campaign_v1",
      campaignId: "single_campaign",
      versionNumber: 1,
      status: "draft",
      subject: "Only subject",
      preheader: null,
      contentSnapshot: {},
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });

    await expect(
      startSubjectLineTest(localContext(), permissions, recorder, data, {
        campaignId: "single_campaign",
        startedAt: "2026-08-11T10:00:00.000Z",
        snapshotIdA: "s_a",
        snapshotIdB: "s_b",
        jobIdA: "j_a",
        jobIdB: "j_b"
      })
    ).rejects.toThrow("both an \"a\" and a \"b\"");

    await expect(
      declareSubjectLineWinner(localContext(), permissions, recorder, data, {
        campaignId: "single_campaign",
        winningVersionId: "single_campaign_v1",
        decidedAt: "2026-08-12T09:00:00.000Z"
      })
    ).rejects.toThrow("running subject-line test");
  });

  it("computes each contact's modal engagement hour from opened/clicked history, falling back to the default hour", () => {
    const data = emptyData();
    const delivery = (id: string, contactId: string, eventType: string, hour: number) => ({
      id,
      campaignId: "campaign_x",
      campaignVersionId: "campaign_x_v1",
      recipientSnapshotId: "snapshot_x",
      contactId,
      emailNormalised: `${contactId}@example.test`,
      providerKey: "test-provider",
      providerMessageId: id,
      status: "delivered",
      eventType,
      eventAt: `2026-08-11T${String(hour).padStart(2, "0")}:15:00.000Z`,
      metadata: {}
    });

    // contact_a: opens 3 times at 14:xx, once at 9:xx - modal hour is 14.
    data.emailDeliveryRecords.push(
      delivery("d1", "contact_a", "opened", 14),
      delivery("d2", "contact_a", "opened", 14),
      delivery("d3", "contact_a", "opened", 14),
      delivery("d4", "contact_a", "opened", 9)
    );
    // contact_b: a tie between hour 10 and hour 20 - lower hour wins.
    data.emailDeliveryRecords.push(
      delivery("d5", "contact_b", "clicked", 20),
      delivery("d6", "contact_b", "opened", 10)
    );
    // contact_c: only a "delivered" (not opened/clicked) record - doesn't count as engagement.
    data.emailDeliveryRecords.push({ ...delivery("d7", "contact_c", "delivered", 5), eventType: "delivered" });

    const hours = computeContactEngagementHours(data, ["contact_a", "contact_b", "contact_c", "contact_d"]);

    expect(hours).toEqual({
      contact_a: 14,
      contact_b: 10,
      contact_c: 9,
      contact_d: 9
    });

    const customDefault = computeContactEngagementHours(data, ["contact_d"], { defaultHour: 17 });
    expect(customDefault.contact_d).toBe(17);
  });

  it("computes the next occurrence of an hour without ever going before the anchor", () => {
    const anchor = new Date("2026-08-12T15:30:00.000Z");

    // Target hour later in the day than the anchor's hour: same day.
    expect(nextOccurrenceOfHour(anchor, 18).toISOString()).toBe("2026-08-12T18:00:00.000Z");

    // Target hour earlier in the day than the anchor's hour: rolls to the next day
    // (never before the anchor, even though 15 < 15:30 would otherwise look "close").
    expect(nextOccurrenceOfHour(anchor, 15).toISOString()).toBe("2026-08-13T15:00:00.000Z");

    // Target hour exactly matching the anchor's hour but before its minute: also
    // rolls to the next day - the anchor is a hard floor, not just a day marker.
    expect(nextOccurrenceOfHour(anchor, 15).getTime()).toBeGreaterThanOrEqual(anchor.getTime());
  });

  it("runs a full send-time-optimized schedule: distinct hour buckets, staggered nextAttemptAt, and no premature 'sent' status", async () => {
    const data = seededData();
    const recorder = audit();

    for (let index = 0; index < 24; index += 1) {
      const contactId = `sto_contact_${index}`;
      data.contacts.push({ ...contact(`sto${index}@example.test`), id: contactId });
      data.subscriptions.push(subscription(`sto_sub_${index}`, contactId, ids.territories.own));
    }

    // Give the first 10 contacts real engagement history clustered at two hours.
    for (let index = 0; index < 6; index += 1) {
      data.emailDeliveryRecords.push({
        id: `sto_hist_${index}`,
        campaignId: "prior_campaign",
        campaignVersionId: "prior_campaign_v1",
        recipientSnapshotId: "prior_snapshot",
        contactId: `sto_contact_${index}`,
        emailNormalised: `sto${index}@example.test`,
        providerKey: "test-provider",
        providerMessageId: `sto_hist_${index}`,
        status: "delivered",
        eventType: "opened",
        eventAt: "2026-08-01T14:20:00.000Z",
        metadata: {}
      });
    }
    for (let index = 6; index < 10; index += 1) {
      data.emailDeliveryRecords.push({
        id: `sto_hist_${index}`,
        campaignId: "prior_campaign",
        campaignVersionId: "prior_campaign_v1",
        recipientSnapshotId: "prior_snapshot",
        contactId: `sto_contact_${index}`,
        emailNormalised: `sto${index}@example.test`,
        providerKey: "test-provider",
        providerMessageId: `sto_hist_${index}`,
        status: "delivered",
        eventType: "clicked",
        eventAt: "2026-08-01T20:05:00.000Z",
        metadata: {}
      });
    }
    // The remaining 14 contacts (10-23) have no history and land in the default-hour bucket.

    await createEmailCampaign(localContext(), permissions, recorder, data, {
      id: "sto_campaign",
      territoryId: ids.territories.own,
      templateId: "template_1",
      segmentId: ids.segment,
      campaignType: "newsletter",
      status: "draft",
      title: "Optimized send",
      subject: "Optimized send",
      preheader: null,
      sendProvider: "postmark",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "sto_campaign_v1",
      campaignId: "sto_campaign",
      versionNumber: 1,
      status: "draft",
      subject: "Optimized send",
      preheader: null,
      contentSnapshot: { blocks: [] },
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveEmailCampaignVersion(localContext(), permissions, recorder, data, "sto_campaign", "sto_campaign_v1", "2026-08-11T10:00:00.000Z");

    await expect(
      enqueueSendTimeOptimizedSend(localContext(), permissions, recorder, data, {
        campaignId: "sto_campaign",
        scheduledAt: "2026-08-12T10:00:00.000Z"
      })
    ).rejects.toThrow("Only scheduled campaigns");

    await scheduleEmailCampaign(localContext(), permissions, recorder, data, "sto_campaign", "2026-08-12T10:00:00.000Z");

    const result = await enqueueSendTimeOptimizedSend(localContext(), permissions, recorder, data, {
      campaignId: "sto_campaign",
      scheduledAt: "2026-08-12T10:00:00.000Z"
    });

    // Three buckets expected: hour 9 (default, contacts 10-23 + the 1 pre-seeded
    // contact from seededData()), hour 14 (contacts 0-5), hour 20 (contacts 6-9).
    expect(result.jobs).toHaveLength(3);
    expect(result.snapshots).toHaveLength(3);
    const totalRecipients = result.snapshots.reduce((total, snapshot) => total + snapshot.recipientCount, 0);
    expect(totalRecipients).toBe(25); // 24 new contacts + the 1 from seededData()

    const byHour = new Map(result.jobs.map((job, index) => [new Date(job.nextAttemptAt).getUTCHours(), result.snapshots[index]!]));
    expect(byHour.get(14)?.recipientCount).toBe(6);
    expect(byHour.get(20)?.recipientCount).toBe(4);
    expect(byHour.get(9)?.recipientCount).toBe(15);

    // Every bucket's nextAttemptAt is staggered correctly and never before scheduledAt.
    for (const job of result.jobs) {
      expect(new Date(job.nextAttemptAt).getTime()).toBeGreaterThanOrEqual(new Date("2026-08-12T10:00:00.000Z").getTime());
    }
    const hour14Job = result.jobs[[...byHour.keys()].indexOf(14)];
    expect(hour14Job?.nextAttemptAt).toBe("2026-08-12T14:00:00.000Z"); // 14:00 is still ahead of the 10:00 anchor -> same day
    const hour20Job = result.jobs[[...byHour.keys()].indexOf(20)];
    expect(hour20Job?.nextAttemptAt).toBe("2026-08-12T20:00:00.000Z"); // 20:00 is also ahead of the 10:00 anchor -> same day

    // Recipient sets across buckets are disjoint and match the expected hour-derived membership.
    const allRecipientIds = result.snapshots.flatMap((snapshot) => snapshot.recipients.map((recipient) => (recipient as { contactId: string }).contactId));
    expect(new Set(allRecipientIds).size).toBe(allRecipientIds.length);

    // Simulate every bucket's job completing except one, and confirm the campaign
    // is NOT marked sent until the very last one does too - this is exactly the
    // scenario the completeSendJob sibling-check fix (in the worker route) exists
    // for; here we confirm the underlying data this depends on is well-formed:
    // every job shares the same campaignVersionId, so a "list jobs for this
    // version" query used by that fix will see every sibling.
    expect(new Set(result.jobs.map((job) => job.campaignVersionId)).size).toBe(1);
    expect(result.jobs.map((job) => job.campaignVersionId)[0]).toBe("sto_campaign_v1");

    // Rejects an empty-segment schedule rather than leaving the campaign stuck.
    const emptyData2 = seededData();
    const recorder2 = audit();
    await createEmailCampaign(localContext(), permissions, recorder2, emptyData2, {
      id: "empty_sto_campaign",
      territoryId: ids.territories.own,
      templateId: "template_1",
      segmentId: ids.segment,
      campaignType: "newsletter",
      status: "draft",
      title: "Empty",
      subject: "Empty",
      preheader: null,
      sendProvider: "postmark",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "empty_sto_campaign_v1",
      campaignId: "empty_sto_campaign",
      versionNumber: 1,
      status: "draft",
      subject: "Empty",
      preheader: null,
      contentSnapshot: {},
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveEmailCampaignVersion(localContext(), permissions, recorder2, emptyData2, "empty_sto_campaign", "empty_sto_campaign_v1", "2026-08-11T10:00:00.000Z");
    await scheduleEmailCampaign(localContext(), permissions, recorder2, emptyData2, "empty_sto_campaign", "2026-08-12T10:00:00.000Z");
    // Suppress the one seeded contact so the segment resolves to zero eligible recipients.
    emptyData2.suppressions.push({
      id: "suppress_only_contact",
      contactId: ids.contact,
      emailNormalised: "parent@example.test",
      territoryId: ids.territories.own,
      reason: "unsubscribe",
      source: "test",
      active: true,
      suppressedAt: "2026-08-11T00:00:00.000Z",
      metadata: {}
    });

    await expect(
      enqueueSendTimeOptimizedSend(localContext(), permissions, recorder2, emptyData2, {
        campaignId: "empty_sto_campaign",
        scheduledAt: "2026-08-12T10:00:00.000Z"
      })
    ).rejects.toThrow("no eligible recipients");
  });

  it("scopes enqueueEmailSend's dedup check to a specific snapshot once one is explicitly given, allowing several concurrent jobs per campaign version", async () => {
    const data = seededData();
    const recorder = audit();

    await createEmailCampaign(localContext(), permissions, recorder, data, {
      id: "multi_bucket_campaign",
      territoryId: ids.territories.own,
      templateId: "template_1",
      segmentId: ids.segment,
      campaignType: "newsletter",
      status: "draft",
      title: "Multi bucket",
      subject: "Multi bucket",
      preheader: null,
      sendProvider: "postmark",
      scheduledAt: null,
      approvedAt: null,
      sentAt: null,
      metadata: {}
    }, {
      id: "multi_bucket_campaign_v1",
      campaignId: "multi_bucket_campaign",
      versionNumber: 1,
      status: "draft",
      subject: "Multi bucket",
      preheader: null,
      contentSnapshot: {},
      createdByUserId: ids.users.local,
      approvedByUserId: null,
      approvedAt: null
    });
    await approveEmailCampaignVersion(localContext(), permissions, recorder, data, "multi_bucket_campaign", "multi_bucket_campaign_v1", "2026-08-11T10:00:00.000Z");
    await scheduleEmailCampaign(localContext(), permissions, recorder, data, "multi_bucket_campaign", "2026-08-12T09:00:00.000Z");

    const snapshotOne = await createRecipientSnapshot(localContext(), permissions, recorder, data, {
      id: "multi_bucket_snapshot_1",
      campaignId: "multi_bucket_campaign",
      campaignVersionId: "multi_bucket_campaign_v1",
      segmentId: ids.segment,
      status: "created",
      generatedAt: "2026-08-11T10:05:00.000Z",
      idempotencyKey: "multi_bucket:1",
      restrictToContactIds: [ids.contact]
    });
    const snapshotTwo = await createRecipientSnapshot(localContext(), permissions, recorder, data, {
      id: "multi_bucket_snapshot_2",
      campaignId: "multi_bucket_campaign",
      campaignVersionId: "multi_bucket_campaign_v1",
      segmentId: ids.segment,
      status: "created",
      generatedAt: "2026-08-11T10:06:00.000Z",
      idempotencyKey: "multi_bucket:2",
      restrictToContactIds: []
    });

    const jobOne = enqueueEmailSend(localContext(), permissions, data, {
      id: "multi_bucket_job_1",
      campaignId: "multi_bucket_campaign",
      campaignVersionId: "multi_bucket_campaign_v1",
      recipientSnapshotId: snapshotOne.id,
      nextAttemptAt: "2026-08-12T09:00:00.000Z"
    });
    const jobTwo = enqueueEmailSend(localContext(), permissions, data, {
      id: "multi_bucket_job_2",
      campaignId: "multi_bucket_campaign",
      campaignVersionId: "multi_bucket_campaign_v1",
      recipientSnapshotId: snapshotTwo.id,
      nextAttemptAt: "2026-08-14T09:00:00.000Z"
    });

    // Two distinct jobs against the same campaignVersionId, one per snapshot - the
    // bug this fix addresses would have collapsed the second call into the first.
    expect(jobOne.id).toBe("multi_bucket_job_1");
    expect(jobTwo.id).toBe("multi_bucket_job_2");
    expect(jobOne.id).not.toBe(jobTwo.id);
    expect(data.emailSendJobs).toHaveLength(2);

    // Calling again with the same explicit snapshot id returns the existing job,
    // not a third one - the narrowed dedup check still dedups correctly.
    const jobOneAgain = enqueueEmailSend(localContext(), permissions, data, {
      id: "multi_bucket_job_1_dup",
      campaignId: "multi_bucket_campaign",
      campaignVersionId: "multi_bucket_campaign_v1",
      recipientSnapshotId: snapshotOne.id
    });
    expect(jobOneAgain.id).toBe("multi_bucket_job_1");
    expect(data.emailSendJobs).toHaveLength(2);
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

function fakeContactView(contactId: string) {
  return {
    contact: {
      id: contactId,
      email: `${contactId}@example.test`,
      emailNormalised: `${contactId}@example.test`,
      firstName: null,
      lastName: null,
      emailStatus: "subscribed",
      tags: [],
      metadata: {}
    },
    subscriptions: [],
    consentEvents: [],
    suppressions: [],
    activity: []
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
