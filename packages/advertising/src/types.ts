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

export type PipelineStage = {
  id: string;
  key: string;
  name: string;
  sortOrder: number;
  probabilityDefault: number;
  isClosed: boolean;
  outcome?: "won" | "lost" | null | (string & {});
  deletedAt?: Date | null;
};

export type Opportunity = {
  id: string;
  advertiserId: string;
  territoryId: string;
  ownerUserId?: string | null;
  stageId: string;
  source: string;
  title: string;
  estimatedValueMinor: number;
  currency: string;
  probability: number;
  expectedCloseDate?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  notes?: string | null;
  lostReason?: string | null;
  competitor?: string | null;
  closedAt?: string | null;
  createdByUserId?: string | null;
  deletedAt?: Date | null;
};

export type OpportunityView = {
  opportunity: Opportunity;
  advertiser: AdvertiserRecord;
  organisation: AdvertisingOrganisation;
  territory?: AdvertisingTerritory;
  stage: PipelineStage;
  weightedValueMinor: number;
  state: "open" | "won" | "lost";
  attention:
    | "overdue_follow_up"
    | "closing_soon"
    | "stale"
    | "normal";
};

export type CommercialProduct = {
  id: string;
  key: string;
  name: string;
  channel: string;
  status: string;
  requiresInventory: boolean;
  requiresArtwork: boolean;
  taxCode: string;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type CommercialPackage = {
  id: string;
  key: string;
  name: string;
  status: string;
  lines: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type PriceBook = {
  id: string;
  key: string;
  name: string;
  territoryId?: string | null;
  status: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  deletedAt?: Date | null;
};

export type PriceBookItem = {
  id: string;
  priceBookId: string;
  productId: string;
  standardPriceMinor: number;
  minimumPriceMinor: number;
  currency: string;
  approvalRequiredBelowMinor: number;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type InventorySlot = {
  id: string;
  territoryEditionId?: string | null;
  editionPageId?: string | null;
  territoryId: string;
  productId: string;
  slotKey: string;
  inventoryClass: string;
  exclusive: boolean;
  status: string;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type InventoryReservation = {
  id: string;
  inventorySlotId: string;
  advertiserId: string;
  opportunityId?: string | null;
  status: string;
  reservedByUserId?: string | null;
  expiresOn?: string | null;
  metadata: Record<string, unknown>;
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
  pipelineStages: PipelineStage[];
  opportunities: Opportunity[];
  products: CommercialProduct[];
  packages: CommercialPackage[];
  priceBooks: PriceBook[];
  priceBookItems: PriceBookItem[];
  inventorySlots: InventorySlot[];
  inventoryReservations: InventoryReservation[];
  organisations: AdvertisingOrganisation[];
  territories: AdvertisingTerritory[];
};

export type Advertiser360 = {
  advertiser: AdvertiserRecord;
  organisation: AdvertisingOrganisation;
  territory?: AdvertisingTerritory;
  contacts: AdvertiserContact[];
  opportunities: OpportunityView[];
  activity: AdvertiserActivityEvent[];
  latestMetrics?: AdvertiserMetricSnapshot;
};

export type PipelineView = {
  stages: Array<{
    stage: PipelineStage;
    opportunities: OpportunityView[];
    totalValueMinor: number;
    weightedValueMinor: number;
  }>;
  overdueFollowUps: OpportunityView[];
  closingSoon: OpportunityView[];
  stale: OpportunityView[];
  myPipeline: OpportunityView[];
  territoryPipeline: OpportunityView[];
};

export type CatalogueView = {
  products: CommercialProduct[];
  packages: CommercialPackage[];
  priceBooks: PriceBook[];
  priceBookItems: PriceBookItem[];
  inventorySlots: InventorySlot[];
};
