import {
  audienceActivityEvents,
  audienceConsentEvents,
  audienceContacts,
  audienceImports,
  audienceSegmentMembers,
  audienceSegments,
  audienceSuppressions,
  audienceTerritorySubscriptions,
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
