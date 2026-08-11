import { auditActions } from "@raring2go/audit";
import { requirePermission, type PermissionData } from "@raring2go/permissions";
import { advertisingCapabilities, type AdvertisingCapability } from "./permissions";
import type {
  Advertiser360,
  AdvertiserActivityEvent,
  AdvertiserContact,
  AdvertiserRecord,
  AdvertisingActorContext,
  AdvertisingData,
  CatalogueView,
  CommercialBooking,
  CommercialBookingItem,
  CommercialProductionRequest,
  CommercialProposal,
  CommercialProposalItem,
  InventoryReservation,
  Opportunity,
  OpportunityView,
  PipelineView
} from "./types";

type AdvertisingAuditRecorder = {
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

export function listAdvertisers(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  data: AdvertisingData
): Advertiser360[] {
  requireAdvertisingPermission(context, permissions, "view");
  const visibleTerritoryIds = visibleTerritories(context, data);

  return data.advertisers
    .filter((advertiser) => !advertiser.deletedAt && advertiser.status !== "archived")
    .filter((advertiser) => visibleTerritoryIds == null || visibleTerritoryIds.has(advertiser.owningTerritoryId))
    .map((advertiser) => assembleAdvertiser360(data, advertiser))
    .sort((left, right) => left.organisation.name.localeCompare(right.organisation.name));
}

export function getAdvertiser360(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  data: AdvertisingData,
  advertiserId: string
): Advertiser360 {
  requireAdvertisingPermission(context, permissions, "view");
  const advertiser = requireAdvertiser(data, advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  return assembleAdvertiser360(data, advertiser);
}

export async function createAdvertiser(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  advertiser: AdvertiserRecord
) {
  requireAdvertisingPermission(context, permissions, "create");
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (data.advertisers.some((candidate) => candidate.advertiserOrganisationId === advertiser.advertiserOrganisationId && !candidate.deletedAt)) {
    throw new Error("Advertiser organisation already has an advertiser CRM record.");
  }
  const organisation = requireOrganisation(data, advertiser.advertiserOrganisationId);
  if (organisation.kind !== "advertiser") {
    throw new Error("Advertiser records must reference an advertiser organisation.");
  }
  data.advertisers.push(advertiser);
  await audit.record(auditEvent(context, auditActions.advertiserCreate, advertiser, {
    relationshipState: advertiser.relationshipState,
    annualAdvertiserValueMinor: advertiser.annualAdvertiserValueMinor
  }));
  return advertiser;
}

export async function updateAdvertiser(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  advertiserId: string,
  patch: Partial<Pick<AdvertiserRecord, "status" | "relationshipState" | "accountOwnerUserId" | "tags" | "commercialMetadata">>
) {
  requireAdvertisingPermission(context, permissions, "edit");
  const advertiser = requireAdvertiser(data, advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  Object.assign(advertiser, patch);
  await audit.record(auditEvent(context, auditActions.advertiserUpdate, advertiser, {
    patch: Object.keys(patch)
  }));
  return advertiser;
}

export async function addAdvertiserContact(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  contact: AdvertiserContact
) {
  requireAdvertisingPermission(context, permissions, "contactManage");
  const advertiser = requireAdvertiser(data, contact.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (contact.userId && (contact.name || contact.email)) {
    throw new Error("Linked user contacts should not duplicate user identity fields.");
  }
  data.contacts.push(contact);
  await audit.record(auditEvent(context, auditActions.advertiserContactUpdate, advertiser, {
    action: "add_contact",
    contactId: contact.id,
    linkedUser: Boolean(contact.userId)
  }));
  return contact;
}

export async function recordAdvertiserActivity(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  event: AdvertiserActivityEvent
) {
  requireAdvertisingPermission(context, permissions, "activityRecord");
  const advertiser = requireAdvertiser(data, event.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (event.territoryId !== advertiser.owningTerritoryId) {
    throw new Error("Advertiser activity must use the owning territory.");
  }
  data.activityEvents.push(event);
  await audit.record(auditEvent(context, auditActions.advertiserActivityRecord, advertiser, {
    activityType: event.activityType,
    title: event.title
  }));
  return event;
}

export function listPipeline(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  data: AdvertisingData
): PipelineView {
  requireAdvertisingPermission(context, permissions, "opportunityView");
  const visibleTerritoryIds = visibleTerritories(context, data);
  const opportunities = data.opportunities
    .filter((opportunity) => !opportunity.deletedAt)
    .filter((opportunity) => visibleTerritoryIds == null || visibleTerritoryIds.has(opportunity.territoryId))
    .map((opportunity) => assembleOpportunityView(data, opportunity))
    .filter((view) => view.state === "open");

  const stages = data.pipelineStages
    .filter((stage) => !stage.deletedAt)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((stage) => {
      const stageOpportunities = opportunities.filter((view) => view.stage.id === stage.id);
      return {
        stage,
        opportunities: stageOpportunities,
        totalValueMinor: stageOpportunities.reduce((sum, view) => sum + view.opportunity.estimatedValueMinor, 0),
        weightedValueMinor: stageOpportunities.reduce((sum, view) => sum + view.weightedValueMinor, 0)
      };
    });

  return {
    stages,
    overdueFollowUps: opportunities.filter((view) => view.attention === "overdue_follow_up"),
    closingSoon: opportunities.filter((view) => view.attention === "closing_soon"),
    stale: opportunities.filter((view) => view.attention === "stale"),
    myPipeline: opportunities.filter((view) => view.opportunity.ownerUserId === context.userId),
    territoryPipeline: context.territoryId
      ? opportunities.filter((view) => view.opportunity.territoryId === context.territoryId)
      : opportunities
  };
}

export async function createOpportunity(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  opportunity: Opportunity
) {
  requireAdvertisingPermission(context, permissions, "opportunityCreate");
  const advertiser = requireAdvertiser(data, opportunity.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (opportunity.territoryId !== advertiser.owningTerritoryId) {
    throw new Error("Opportunity territory must match the advertiser owning territory.");
  }
  const stage = requirePipelineStage(data, opportunity.stageId);
  const created = {
    ...opportunity,
    probability: opportunity.probability || stage.probabilityDefault,
    createdByUserId: opportunity.createdByUserId ?? context.userId
  };
  data.opportunities.push(created);
  await audit.record(auditEvent(context, auditActions.advertiserOpportunityCreate, advertiser, {
    opportunityId: created.id,
    stageId: created.stageId,
    estimatedValueMinor: created.estimatedValueMinor
  }));
  return created;
}

export async function updateOpportunity(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  opportunityId: string,
  patch: Partial<Pick<Opportunity, "title" | "estimatedValueMinor" | "probability" | "expectedCloseDate" | "nextAction" | "nextActionDate" | "notes">>
) {
  requireAdvertisingPermission(context, permissions, "opportunityEdit");
  const opportunity = requireOpportunity(data, opportunityId);
  const advertiser = requireAdvertiser(data, opportunity.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  Object.assign(opportunity, patch);
  await audit.record(auditEvent(context, auditActions.advertiserOpportunityUpdate, advertiser, {
    opportunityId,
    patch: Object.keys(patch)
  }));
  return opportunity;
}

export async function changeOpportunityStage(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  opportunityId: string,
  input: {
    stageId: string;
    lostReason?: string | null;
    competitor?: string | null;
  }
) {
  requireAdvertisingPermission(context, permissions, "opportunityEdit");
  const opportunity = requireOpportunity(data, opportunityId);
  const advertiser = requireAdvertiser(data, opportunity.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  const stage = requirePipelineStage(data, input.stageId);
  opportunity.stageId = stage.id;
  opportunity.probability = stage.probabilityDefault;
  opportunity.lostReason = input.lostReason ?? opportunity.lostReason ?? null;
  opportunity.competitor = input.competitor ?? opportunity.competitor ?? null;
  opportunity.closedAt = stage.isClosed ? today() : null;
  await audit.record(auditEvent(context, auditActions.advertiserOpportunityStageChange, advertiser, {
    opportunityId,
    stageId: stage.id,
    outcome: stage.outcome ?? "open"
  }));
  return opportunity;
}

export function listCatalogue(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  data: AdvertisingData
): CatalogueView {
  requireAdvertisingPermission(context, permissions, "catalogueView");
  const visibleTerritoryIds = visibleTerritories(context, data);

  return {
    products: data.products.filter((product) => product.status === "active" && !product.deletedAt),
    packages: data.packages.filter((bundle) => bundle.status === "active" && !bundle.deletedAt),
    priceBooks: data.priceBooks.filter((book) => book.status === "active" && !book.deletedAt),
    priceBookItems: data.priceBookItems.filter((item) => !item.deletedAt),
    inventorySlots: data.inventorySlots
      .filter((slot) => !slot.deletedAt)
      .filter((slot) => visibleTerritoryIds == null || visibleTerritoryIds.has(slot.territoryId))
  };
}

export async function reserveInventorySlot(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  reservation: InventoryReservation
) {
  requireAdvertisingPermission(context, permissions, "inventoryReserve");
  const slot = data.inventorySlots.find((candidate) => candidate.id === reservation.inventorySlotId && !candidate.deletedAt);
  if (!slot) {
    throw new Error("Inventory slot was not found.");
  }
  if (context.territoryId && context.territoryId !== slot.territoryId) {
    throw new Error("Inventory slot is outside the active territory.");
  }
  const advertiser = requireAdvertiser(data, reservation.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  const activeReservation = data.inventoryReservations.find(
    (candidate) => candidate.inventorySlotId === slot.id && candidate.status === "reserved" && !candidate.deletedAt
  );
  if (slot.exclusive && activeReservation) {
    throw new Error("Exclusive inventory slot is already reserved.");
  }
  slot.status = "reserved";
  data.inventoryReservations.push({
    ...reservation,
    reservedByUserId: reservation.reservedByUserId ?? context.userId
  });
  await audit.record(auditEvent(context, auditActions.advertiserInventoryReserve, advertiser, {
    inventorySlotId: slot.id,
    opportunityId: reservation.opportunityId ?? null
  }));
  return reservation;
}

export async function createProposal(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  proposal: CommercialProposal,
  items: CommercialProposalItem[]
) {
  requireAdvertisingPermission(context, permissions, "proposalCreate");
  const advertiser = requireAdvertiser(data, proposal.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (proposal.territoryId !== advertiser.owningTerritoryId) {
    throw new Error("Proposal territory must match the advertiser owning territory.");
  }
  if (proposal.opportunityId) {
    const opportunity = requireOpportunity(data, proposal.opportunityId);
    if (opportunity.advertiserId !== advertiser.id || opportunity.territoryId !== proposal.territoryId) {
      throw new Error("Proposal opportunity must belong to the advertiser territory.");
    }
  }
  if (items.length === 0) {
    throw new Error("Proposal requires at least one item.");
  }
  const totalValueMinor = items.reduce((sum, item) => sum + item.totalPriceMinor, 0);
  const created = {
    ...proposal,
    totalValueMinor
  };

  for (const item of items) {
    requireProduct(data, item.productId);
    if (item.proposalId !== proposal.id) {
      throw new Error("Proposal item must reference the proposal.");
    }
    if (item.inventorySlotId) {
      const slot = requireInventorySlot(data, item.inventorySlotId);
      if (slot.territoryId !== proposal.territoryId) {
        throw new Error("Proposal inventory must belong to the proposal territory.");
      }
    }
  }

  data.proposals.push(created);
  data.proposalItems.push(...items);
  await audit.record(auditEvent(context, auditActions.advertiserProposalCreate, advertiser, {
    proposalId: proposal.id,
    itemCount: items.length,
    totalValueMinor
  }));
  return created;
}

export async function acceptProposalAsBooking(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  input: {
    proposalId: string;
    bookingId: string;
    bookingItemIdPrefix: string;
    reservationIdPrefix: string;
    productionRequestIdPrefix: string;
    acceptedOn: string;
  }
) {
  requireAdvertisingPermission(context, permissions, "bookingAccept");
  const proposal = requireProposal(data, input.proposalId);
  const advertiser = requireAdvertiser(data, proposal.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (!["draft", "sent"].includes(proposal.status)) {
    const existing = data.bookings.find((booking) => booking.proposalId === proposal.id && !booking.deletedAt);
    if (proposal.status === "accepted" && existing) {
      return existing;
    }
    throw new Error("Only draft or sent proposals can be accepted into bookings.");
  }

  const proposalItems = data.proposalItems.filter((item) => item.proposalId === proposal.id && !item.deletedAt);
  if (proposalItems.length === 0) {
    throw new Error("Cannot accept a proposal without items.");
  }

  const booking: CommercialBooking = {
    id: input.bookingId,
    proposalId: proposal.id,
    advertiserId: proposal.advertiserId,
    opportunityId: proposal.opportunityId ?? null,
    territoryId: proposal.territoryId,
    status: "booked",
    bookedOn: input.acceptedOn,
    totalValueMinor: proposal.totalValueMinor,
    currency: proposal.currency,
    metadata: {
      source: "proposal_acceptance"
    }
  };
  const bookingItems: CommercialBookingItem[] = [];
  const productionRequests: CommercialProductionRequest[] = [];
  const reservations: InventoryReservation[] = [];

  proposalItems.forEach((item, index) => {
    let inventoryReservationId: string | null = null;
    if (item.inventorySlotId) {
      const slot = requireInventorySlot(data, item.inventorySlotId);
      if (slot.territoryId !== proposal.territoryId) {
        throw new Error("Proposal inventory is outside the proposal territory.");
      }
      const activeReservation = data.inventoryReservations.find(
        (candidate) => candidate.inventorySlotId === slot.id && candidate.status === "reserved" && !candidate.deletedAt
      );
      if (slot.exclusive && activeReservation) {
        throw new Error("Exclusive inventory slot is already reserved.");
      }
      inventoryReservationId = `${input.reservationIdPrefix}_${index + 1}`;
      slot.status = "reserved";
      reservations.push({
        id: inventoryReservationId,
        inventorySlotId: slot.id,
        advertiserId: proposal.advertiserId,
        opportunityId: proposal.opportunityId ?? null,
        status: "reserved",
        reservedByUserId: context.userId,
        expiresOn: null,
        metadata: {
          proposalId: proposal.id,
          bookingId: booking.id
        }
      });
    }

    const bookingItemId = `${input.bookingItemIdPrefix}_${index + 1}`;
    bookingItems.push({
      id: bookingItemId,
      bookingId: booking.id,
      proposalItemId: item.id,
      productId: item.productId,
      inventoryReservationId,
      description: item.description,
      quantity: item.quantity,
      totalPriceMinor: item.totalPriceMinor,
      currency: item.currency,
      metadata: {
        proposalItemId: item.id
      }
    });
    const product = requireProduct(data, item.productId);
    if (product.requiresArtwork) {
      productionRequests.push({
        id: `${input.productionRequestIdPrefix}_${index + 1}`,
        bookingId: booking.id,
        bookingItemId,
        advertiserId: proposal.advertiserId,
        territoryId: proposal.territoryId,
        requestType: "artwork",
        status: "requested",
        dueOn: null,
        metadata: {
          productId: product.id
        }
      });
    }
  });

  proposal.status = "accepted";
  proposal.acceptedOn = input.acceptedOn;
  data.inventoryReservations.push(...reservations);
  data.bookings.push(booking);
  data.bookingItems.push(...bookingItems);
  data.productionRequests.push(...productionRequests);
  await audit.record(auditEvent(context, auditActions.advertiserProposalAccept, advertiser, {
    proposalId: proposal.id,
    bookingId: booking.id
  }));
  await audit.record(auditEvent(context, auditActions.advertiserBookingCreate, advertiser, {
    bookingId: booking.id,
    itemCount: bookingItems.length,
    productionRequestCount: productionRequests.length
  }));
  return booking;
}

function assembleAdvertiser360(data: AdvertisingData, advertiser: AdvertiserRecord): Advertiser360 {
  return {
    advertiser,
    organisation: requireOrganisation(data, advertiser.advertiserOrganisationId),
    territory: data.territories.find((territory) => territory.id === advertiser.owningTerritoryId),
    contacts: data.contacts.filter((contact) => contact.advertiserId === advertiser.id && !contact.deletedAt),
    opportunities: data.opportunities
      .filter((opportunity) => opportunity.advertiserId === advertiser.id && !opportunity.deletedAt)
      .map((opportunity) => assembleOpportunityView(data, opportunity)),
    proposals: data.proposals.filter((proposal) => proposal.advertiserId === advertiser.id && !proposal.deletedAt),
    bookings: data.bookings.filter((booking) => booking.advertiserId === advertiser.id && !booking.deletedAt),
    productionRequests: data.productionRequests.filter((request) => request.advertiserId === advertiser.id && !request.deletedAt),
    activity: data.activityEvents
      .filter((event) => event.advertiserId === advertiser.id && !event.deletedAt)
      .slice()
      .reverse(),
    latestMetrics: data.metricSnapshots
      .filter((snapshot) => snapshot.advertiserId === advertiser.id && !snapshot.deletedAt)
      .sort((left, right) => right.periodKey.localeCompare(left.periodKey))[0]
  };
}

function assembleOpportunityView(data: AdvertisingData, opportunity: Opportunity): OpportunityView {
  const advertiser = requireAdvertiser(data, opportunity.advertiserId);
  const stage = requirePipelineStage(data, opportunity.stageId);
  return {
    opportunity,
    advertiser,
    organisation: requireOrganisation(data, advertiser.advertiserOrganisationId),
    territory: data.territories.find((territory) => territory.id === opportunity.territoryId),
    stage,
    weightedValueMinor: Math.round((opportunity.estimatedValueMinor * opportunity.probability) / 100),
    state: stage.outcome === "won" ? "won" : stage.outcome === "lost" ? "lost" : "open",
    attention: opportunityAttention(opportunity)
  };
}

function requireAdvertisingPermission(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  capability: AdvertisingCapability
) {
  const permission = advertisingCapabilities[capability];
  requirePermission({
    userId: context.userId,
    module: permission.module,
    action: permission.action,
    context: {
      organisationId: context.organisationId ?? undefined,
      territoryId: context.territoryId ?? undefined
    }
  }, permissions);
}

function visibleTerritories(context: AdvertisingActorContext, data: AdvertisingData) {
  if (!context.territoryId) {
    return null;
  }
  const territory = data.territories.find((candidate) => candidate.id === context.territoryId);
  if (!territory) {
    throw new Error("Active territory context is invalid.");
  }
  return new Set([territory.id]);
}

function ensureContextCanAccessAdvertiser(context: AdvertisingActorContext, advertiser: AdvertiserRecord) {
  if (context.territoryId && context.territoryId !== advertiser.owningTerritoryId) {
    throw new Error("Advertiser is outside the active territory.");
  }
}

function requireAdvertiser(data: AdvertisingData, advertiserId: string) {
  const advertiser = data.advertisers.find((candidate) => candidate.id === advertiserId && !candidate.deletedAt);
  if (!advertiser) {
    throw new Error("Advertiser was not found.");
  }
  return advertiser;
}

function requireOpportunity(data: AdvertisingData, opportunityId: string) {
  const opportunity = data.opportunities.find((candidate) => candidate.id === opportunityId && !candidate.deletedAt);
  if (!opportunity) {
    throw new Error("Opportunity was not found.");
  }
  return opportunity;
}

function requirePipelineStage(data: AdvertisingData, stageId: string) {
  const stage = data.pipelineStages.find((candidate) => candidate.id === stageId && !candidate.deletedAt);
  if (!stage) {
    throw new Error("Pipeline stage was not found.");
  }
  return stage;
}

function requireProduct(data: AdvertisingData, productId: string) {
  const product = data.products.find((candidate) => candidate.id === productId && !candidate.deletedAt);
  if (!product) {
    throw new Error("Commercial product was not found.");
  }
  return product;
}

function requireInventorySlot(data: AdvertisingData, inventorySlotId: string) {
  const slot = data.inventorySlots.find((candidate) => candidate.id === inventorySlotId && !candidate.deletedAt);
  if (!slot) {
    throw new Error("Inventory slot was not found.");
  }
  return slot;
}

function requireProposal(data: AdvertisingData, proposalId: string) {
  const proposal = data.proposals.find((candidate) => candidate.id === proposalId && !candidate.deletedAt);
  if (!proposal) {
    throw new Error("Proposal was not found.");
  }
  return proposal;
}

function requireOrganisation(data: AdvertisingData, organisationId: string) {
  const organisation = data.organisations.find((candidate) => candidate.id === organisationId);
  if (!organisation) {
    throw new Error("Advertiser organisation was not found.");
  }
  return organisation;
}

function opportunityAttention(opportunity: Opportunity): OpportunityView["attention"] {
  if (opportunity.nextActionDate && opportunity.nextActionDate < today()) {
    return "overdue_follow_up";
  }
  if (opportunity.expectedCloseDate && opportunity.expectedCloseDate <= "2026-08-18") {
    return "closing_soon";
  }
  if (!opportunity.nextActionDate) {
    return "stale";
  }
  return "normal";
}

function today() {
  return "2026-08-11";
}

function auditEvent(
  context: AdvertisingActorContext,
  action: string,
  advertiser: AdvertiserRecord,
  payload: Record<string, unknown>
) {
  return {
    action,
    actorUserId: context.userId,
    entityType: "advertiser",
    entityId: advertiser.id,
    organisationId: context.organisationId,
    territoryId: advertiser.owningTerritoryId,
    payload
  };
}
