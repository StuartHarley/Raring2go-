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

export type CommercialProposal = {
  id: string;
  advertiserId: string;
  opportunityId?: string | null;
  territoryId: string;
  status: "draft" | "sent" | "accepted" | "rejected" | "change_requested" | "declined" | "expired" | (string & {});
  version: number;
  title: string;
  totalValueMinor: number;
  currency: string;
  validUntil?: string | null;
  sentOn?: string | null;
  acceptedOn?: string | null;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type CommercialProposalItem = {
  id: string;
  proposalId: string;
  productId: string;
  packageId?: string | null;
  inventorySlotId?: string | null;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  totalPriceMinor: number;
  currency: string;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type CommercialBooking = {
  id: string;
  proposalId: string;
  advertiserId: string;
  opportunityId?: string | null;
  territoryId: string;
  status: "booked" | "cancelled" | (string & {});
  bookedOn: string;
  totalValueMinor: number;
  currency: string;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type CommercialBookingItem = {
  id: string;
  bookingId: string;
  proposalItemId: string;
  productId: string;
  inventoryReservationId?: string | null;
  description: string;
  quantity: number;
  totalPriceMinor: number;
  currency: string;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type CommercialProductionRequest = {
  id: string;
  bookingId: string;
  bookingItemId: string;
  advertiserId: string;
  territoryId: string;
  requestType: string;
  status: string;
  dueOn?: string | null;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type AdvertiserTerms = {
  id: string;
  key: string;
  version: string;
  status: string;
  title: string;
  contentHash: string;
  contentSnapshot: Record<string, unknown>;
  approvedAt?: string | null;
  deletedAt?: Date | null;
};

export type AdvertiserProposalAcceptance = {
  id: string;
  proposalId: string;
  advertiserId: string;
  territoryId: string;
  termsId: string;
  bookingId?: string | null;
  method: "simple" | "signature_required" | (string & {});
  status: "accepted" | "rejected" | "change_requested" | "pending_signature" | (string & {});
  acceptedByContactId?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  requestMetadata: Record<string, unknown>;
  commercialSnapshot: Record<string, unknown>;
  providerMetadata: Record<string, unknown>;
  idempotencyKey: string;
  deletedAt?: Date | null;
};

export type AdvertiserDomainEvent = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  advertiserId?: string | null;
  territoryId?: string | null;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  processedAt?: string | null;
};

export type AdvertiserInvoiceSequence = {
  id: string;
  issuerOrganisationId: string;
  key: string;
  prefix: string;
  nextNumber: number;
  padding: number;
};

export type AdvertiserInvoice = {
  id: string;
  issuerOrganisationId: string;
  advertiserId: string;
  customerOrganisationId: string;
  territoryId: string;
  bookingId?: string | null;
  invoiceNumber: string;
  status: "draft" | "issued" | "part_paid" | "paid" | "void" | "credited" | (string & {});
  issueDate?: string | null;
  dueDate?: string | null;
  voidedAt?: string | null;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  billingSnapshot: Record<string, unknown>;
  paymentTermsSnapshot: Record<string, unknown>;
  issuedSnapshot: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type AdvertiserInvoiceLine = {
  id: string;
  invoiceId: string;
  bookingItemId?: string | null;
  productId?: string | null;
  description: string;
  quantity: number;
  netMinor: number;
  taxRateBps: number;
  taxMinor: number;
  grossMinor: number;
  taxCode: string;
  deletedAt?: Date | null;
};

export type AdvertiserCreditNote = {
  id: string;
  invoiceId: string;
  issuerOrganisationId: string;
  creditNoteNumber: string;
  reason: string;
  issuedByUserId?: string | null;
  issuedDate: string;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  snapshot: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type AdvertiserCreditNoteLine = {
  id: string;
  creditNoteId: string;
  invoiceLineId?: string | null;
  description: string;
  netMinor: number;
  taxRateBps: number;
  taxMinor: number;
  grossMinor: number;
  taxCode: string;
  deletedAt?: Date | null;
};

export type AdvertiserPayment = {
  id: string;
  issuerOrganisationId: string;
  advertiserId: string;
  payerOrganisationId: string;
  amountMinor: number;
  allocatedMinor: number;
  unallocatedMinor: number;
  currency: string;
  receivedDate: string;
  method: string;
  providerKey?: string | null;
  externalReference?: string | null;
  providerEventId?: string | null;
  status: string;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type AdvertiserPaymentAllocation = {
  id: string;
  paymentId: string;
  invoiceId: string;
  amountMinor: number;
  allocatedAt: string;
  status: string;
  metadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type AdvertiserProviderSyncReference = {
  id: string;
  providerType: string;
  providerKey: string;
  entityType: string;
  entityId: string;
  providerEntityId?: string | null;
  status: string;
  lastSyncedAt?: string | null;
  metadata: Record<string, unknown>;
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
  proposals: CommercialProposal[];
  proposalItems: CommercialProposalItem[];
  bookings: CommercialBooking[];
  bookingItems: CommercialBookingItem[];
  productionRequests: CommercialProductionRequest[];
  terms: AdvertiserTerms[];
  acceptances: AdvertiserProposalAcceptance[];
  domainEvents: AdvertiserDomainEvent[];
  invoiceSequences: AdvertiserInvoiceSequence[];
  invoices: AdvertiserInvoice[];
  invoiceLines: AdvertiserInvoiceLine[];
  creditNotes: AdvertiserCreditNote[];
  creditNoteLines: AdvertiserCreditNoteLine[];
  payments: AdvertiserPayment[];
  paymentAllocations: AdvertiserPaymentAllocation[];
  providerSyncReferences: AdvertiserProviderSyncReference[];
  organisations: AdvertisingOrganisation[];
  territories: AdvertisingTerritory[];
};

export type Advertiser360 = {
  advertiser: AdvertiserRecord;
  organisation: AdvertisingOrganisation;
  territory?: AdvertisingTerritory;
  contacts: AdvertiserContact[];
  opportunities: OpportunityView[];
  proposals: CommercialProposal[];
  bookings: CommercialBooking[];
  productionRequests: CommercialProductionRequest[];
  acceptances: AdvertiserProposalAcceptance[];
  invoices: AdvertiserInvoice[];
  creditNotes: AdvertiserCreditNote[];
  payments: AdvertiserPayment[];
  financeSummary: {
    lifetimeInvoicedMinor: number;
    lifetimePaidMinor: number;
    outstandingMinor: number;
    overdueMinor: number;
    unallocatedPaymentsMinor: number;
  };
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
