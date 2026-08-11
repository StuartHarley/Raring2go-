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
  emailTemplates,
  marketingJourneyAudienceEntries,
  marketingJourneyExecutions,
  marketingJourneyStepExecutions,
  marketingJourneyVersions,
  marketingJourneys,
  networkNewsletterMasters,
  newsletterFactoryRuns,
  territoryNewsletterEditions,
  territories
} from "@raring2go/db";
import type { MarketingData } from "./types";

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
    newsletterMasterRows,
    newsletterEditionRows,
    newsletterRunRows,
    journeyRows,
    journeyVersionRows,
    journeyEntryRows,
    journeyExecutionRows,
    journeyStepRows,
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
    db.select().from(networkNewsletterMasters),
    db.select().from(territoryNewsletterEditions),
    db.select().from(newsletterFactoryRuns),
    db.select().from(marketingJourneys),
    db.select().from(marketingJourneyVersions),
    db.select().from(marketingJourneyAudienceEntries),
    db.select().from(marketingJourneyExecutions),
    db.select().from(marketingJourneyStepExecutions),
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
    networkNewsletterMasters: newsletterMasterRows.map(dateRows(["approvedAt"])) as MarketingData["networkNewsletterMasters"],
    territoryNewsletterEditions: newsletterEditionRows.map(dateRows(["generatedAt", "approvedAt"])) as MarketingData["territoryNewsletterEditions"],
    newsletterFactoryRuns: newsletterRunRows.map(dateRows(["generatedAt"])) as MarketingData["newsletterFactoryRuns"],
    journeys: journeyRows.map(dateRows(["approvedAt", "activatedAt", "pausedAt"])) as MarketingData["journeys"],
    journeyVersions: journeyVersionRows.map(dateRows(["approvedAt"])) as MarketingData["journeyVersions"],
    journeyAudienceEntries: journeyEntryRows.map(dateRows(["enteredAt", "exitedAt"])) as MarketingData["journeyAudienceEntries"],
    journeyExecutions: journeyExecutionRows.map(dateRows(["runAfter", "completedAt"])) as MarketingData["journeyExecutions"],
    journeyStepExecutions: journeyStepRows.map(dateRows(["scheduledFor", "completedAt"])) as MarketingData["journeyStepExecutions"],
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
