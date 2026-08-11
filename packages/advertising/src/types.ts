export type AdvertisingActorContext = {
  userId: string;
  organisationId?: string | null;
  territoryId?: string | null;
};

export type AdvertiserStatus = "prospect" | "active" | "paused" | "archived" | (string & {});
export type AdvertiserRelationshipState = "new" | "retained" | "lapsed" | "at_risk" | (string & {});

export type AdvertiserRecord = {
  id: string;
  advertiserOrganisationId: string;
  owningTerritoryId: string;
  accountOwnerUserId?: string | null;
  status: AdvertiserStatus;
  relationshipState: AdvertiserRelationshipState;
  source: string;
  firstBookedOn?: string | null;
  lastBookedOn?: string | null;
  lapsedOn?: string | null;
  averageSaleValueMinor: number;
  annualAdvertiserValueMinor: number;
  currency: string;
  tags: string[];
  commercialMetadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type AdvertiserContact = {
  id: string;
  advertiserId: string;
  userId?: string | null;
  label: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role: string;
  isPrimary: boolean;
  deletedAt?: Date | null;
};

export type AdvertiserActivityEvent = {
  id: string;
  advertiserId: string;
  territoryId: string;
  actorUserId?: string | null;
  activityType: string;
  title: string;
  body?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type AdvertiserMetricSnapshot = {
  id: string;
  advertiserId: string;
  territoryId: string;
  periodKey: string;
  averageSaleValueMinor: number;
  annualAdvertiserValueMinor: number;
  bookingCount: number;
  packageMix: Record<string, unknown>;
  digitalMix: Record<string, unknown>;
  conversionState: string;
  churnRisk: string;
  overdueDebtMinor: number;
  benchmarkMetadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type AdvertisingOrganisation = {
  id: string;
  kind: string;
  name: string;
};

export type AdvertisingTerritory = {
  id: string;
  franchiseOrganisationId?: string | null;
  code?: string;
  name?: string;
  status?: string;
};

export type AdvertisingData = {
  advertisers: AdvertiserRecord[];
  contacts: AdvertiserContact[];
  activityEvents: AdvertiserActivityEvent[];
  metricSnapshots: AdvertiserMetricSnapshot[];
  organisations: AdvertisingOrganisation[];
  territories: AdvertisingTerritory[];
};

export type Advertiser360 = {
  advertiser: AdvertiserRecord;
  organisation: AdvertisingOrganisation;
  territory?: AdvertisingTerritory;
  contacts: AdvertiserContact[];
  activity: AdvertiserActivityEvent[];
  latestMetrics?: AdvertiserMetricSnapshot;
};
