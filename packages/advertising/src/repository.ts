import {
  advertiserActivityEvents,
  advertiserContacts,
  advertiserMetricSnapshots,
  advertisers,
  organisations,
  opportunities,
  pipelineStages,
  territories
} from "@raring2go/db";
import type { AdvertisingData } from "./types";

type DrizzleDb = {
  select(): {
    from(table: unknown): Promise<Array<Record<string, unknown>>>;
  };
};

export async function loadAdvertisingData(db: DrizzleDb): Promise<AdvertisingData> {
  const [
    advertiserRows,
    contactRows,
    activityRows,
    metricRows,
    stageRows,
    opportunityRows,
    organisationRows,
    territoryRows
  ] = await Promise.all([
    db.select().from(advertisers),
    db.select().from(advertiserContacts),
    db.select().from(advertiserActivityEvents),
    db.select().from(advertiserMetricSnapshots),
    db.select().from(pipelineStages),
    db.select().from(opportunities),
    db.select().from(organisations),
    db.select().from(territories)
  ]);

  return {
    advertisers: advertiserRows.map((row) => ({
      ...row,
      firstBookedOn: dateString(row.firstBookedOn),
      lastBookedOn: dateString(row.lastBookedOn),
      lapsedOn: dateString(row.lapsedOn)
    })) as AdvertisingData["advertisers"],
    contacts: contactRows as AdvertisingData["contacts"],
    activityEvents: activityRows as AdvertisingData["activityEvents"],
    metricSnapshots: metricRows as AdvertisingData["metricSnapshots"],
    pipelineStages: stageRows as AdvertisingData["pipelineStages"],
    opportunities: opportunityRows.map((row) => ({
      ...row,
      expectedCloseDate: dateString(row.expectedCloseDate),
      nextActionDate: dateString(row.nextActionDate),
      closedAt: dateString(row.closedAt)
    })) as AdvertisingData["opportunities"],
    organisations: organisationRows as AdvertisingData["organisations"],
    territories: territoryRows as AdvertisingData["territories"]
  };
}

function dateString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return (value ?? null) as string | null;
}
