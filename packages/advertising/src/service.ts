import { auditActions } from "@raring2go/audit";
import { requirePermission, type PermissionData } from "@raring2go/permissions";
import { advertisingCapabilities, type AdvertisingCapability } from "./permissions";
import type {
  Advertiser360,
  AdvertiserActivityEvent,
  AdvertiserContact,
  AdvertiserDomainEvent,
  AdvertiserCreditNote,
  AdvertiserCreditNoteLine,
  AdvertiserInvoice,
  AdvertiserInvoiceLine,
  AdvertiserPayment,
  AdvertiserPaymentAllocation,
  AdvertiserProposalAcceptance,
  AdvertiserTerms,
  AdvertiserRecord,
  AdvertisingActorContext,
  AdvertisingData,
  ArtworkRequirement,
  ArtworkVersion,
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

export async function acceptProposalCommercially(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  input: {
    acceptanceId: string;
    proposalId: string;
    termsId: string;
    acceptedByContactId: string;
    acceptedAt: string;
    idempotencyKey: string;
    requestMetadata: Record<string, unknown>;
    bookingId: string;
    bookingItemIdPrefix: string;
    reservationIdPrefix: string;
    productionRequestIdPrefix: string;
    method?: "simple" | "signature_required";
    providerMetadata?: Record<string, unknown>;
    domainEventId: string;
  }
) {
  requireAdvertisingPermission(context, permissions, "proposalAccept");
  const existing = data.acceptances.find((candidate) => candidate.idempotencyKey === input.idempotencyKey && !candidate.deletedAt);
  if (existing) {
    return existing;
  }
  const proposal = requireProposal(data, input.proposalId);
  const advertiser = requireAdvertiser(data, proposal.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  const terms = requireTerms(data, input.termsId);
  const contact = data.contacts.find((candidate) => candidate.id === input.acceptedByContactId && !candidate.deletedAt);
  if (!contact || contact.advertiserId !== advertiser.id) {
    throw new Error("Acceptance contact must belong to the advertiser.");
  }
  ensureProposalAcceptable(data, proposal, terms, input.acceptedAt);

  const acceptance: AdvertiserProposalAcceptance = {
    id: input.acceptanceId,
    proposalId: proposal.id,
    advertiserId: advertiser.id,
    territoryId: proposal.territoryId,
    termsId: terms.id,
    bookingId: null,
    method: input.method ?? "simple",
    status: input.method === "signature_required" ? "pending_signature" : "accepted",
    acceptedByContactId: contact.id,
    acceptedAt: input.method === "signature_required" ? null : input.acceptedAt,
    rejectedAt: null,
    requestMetadata: { ...input.requestMetadata },
    commercialSnapshot: commercialSnapshot(data, proposal, terms),
    providerMetadata: input.method === "signature_required" ? { ...(input.providerMetadata ?? {}) } : {},
    idempotencyKey: input.idempotencyKey
  };

  data.acceptances.push(acceptance);
  if (acceptance.status === "accepted") {
    const booking = await acceptProposalAsBooking(context, permissions, audit, data, {
      proposalId: proposal.id,
      bookingId: input.bookingId,
      bookingItemIdPrefix: input.bookingItemIdPrefix,
      reservationIdPrefix: input.reservationIdPrefix,
      productionRequestIdPrefix: input.productionRequestIdPrefix,
      acceptedOn: input.acceptedAt
    });
    acceptance.bookingId = booking.id;
    emitAdvertiserEvent(data, {
      id: input.domainEventId,
      eventType: "advertiser.proposal.accepted",
      entityType: "commercial_proposal",
      entityId: proposal.id,
      advertiserId: advertiser.id,
      territoryId: proposal.territoryId,
      payload: {
        acceptanceId: acceptance.id,
        bookingId: booking.id,
        method: acceptance.method
      },
      idempotencyKey: `advertiser.proposal.accepted:${acceptance.id}`
    });
    emitAdvertiserEvent(data, {
      id: `${input.domainEventId}_booking`,
      eventType: "advertiser.booking.confirmed",
      entityType: "commercial_booking",
      entityId: booking.id,
      advertiserId: advertiser.id,
      territoryId: proposal.territoryId,
      payload: {
        proposalId: proposal.id,
        acceptanceId: acceptance.id
      },
      idempotencyKey: `advertiser.booking.confirmed:${booking.id}`
    });
  }
  await audit.record(auditEvent(context, auditActions.advertiserProposalAccept, advertiser, {
    proposalId: proposal.id,
    acceptanceId: acceptance.id,
    method: acceptance.method,
    status: acceptance.status
  }));
  if (acceptance.bookingId) {
    await audit.record(auditEvent(context, auditActions.advertiserBookingConfirm, advertiser, {
      proposalId: proposal.id,
      bookingId: acceptance.bookingId
    }));
  }
  return acceptance;
}

export async function respondToProposal(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  input: {
    acceptanceId: string;
    proposalId: string;
    termsId: string;
    acceptedByContactId: string;
    response: "rejected" | "change_requested";
    respondedAt: string;
    idempotencyKey: string;
    requestMetadata: Record<string, unknown>;
    domainEventId: string;
  }
) {
  requireAdvertisingPermission(context, permissions, "proposalRespond");
  const existing = data.acceptances.find((candidate) => candidate.idempotencyKey === input.idempotencyKey && !candidate.deletedAt);
  if (existing) {
    return existing;
  }
  const proposal = requireProposal(data, input.proposalId);
  const advertiser = requireAdvertiser(data, proposal.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  const terms = requireTerms(data, input.termsId);
  const contact = data.contacts.find((candidate) => candidate.id === input.acceptedByContactId && !candidate.deletedAt);
  if (!contact || contact.advertiserId !== advertiser.id) {
    throw new Error("Response contact must belong to the advertiser.");
  }
  ensureProposalAcceptable(data, proposal, terms, input.respondedAt);
  proposal.status = input.response;
  const acceptance: AdvertiserProposalAcceptance = {
    id: input.acceptanceId,
    proposalId: proposal.id,
    advertiserId: advertiser.id,
    territoryId: proposal.territoryId,
    termsId: terms.id,
    bookingId: null,
    method: "simple",
    status: input.response,
    acceptedByContactId: contact.id,
    acceptedAt: null,
    rejectedAt: input.respondedAt,
    requestMetadata: { ...input.requestMetadata },
    commercialSnapshot: commercialSnapshot(data, proposal, terms),
    providerMetadata: {},
    idempotencyKey: input.idempotencyKey
  };
  data.acceptances.push(acceptance);
  emitAdvertiserEvent(data, {
    id: input.domainEventId,
    eventType: input.response === "rejected" ? "advertiser.proposal.rejected" : "advertiser.proposal.change_requested",
    entityType: "commercial_proposal",
    entityId: proposal.id,
    advertiserId: advertiser.id,
    territoryId: proposal.territoryId,
    payload: {
      acceptanceId: acceptance.id,
      response: input.response
    },
    idempotencyKey: `advertiser.proposal.${input.response}:${acceptance.id}`
  });
  await audit.record(auditEvent(context, input.response === "rejected"
    ? auditActions.advertiserProposalReject
    : auditActions.advertiserProposalChangeRequest, advertiser, {
    proposalId: proposal.id,
    acceptanceId: acceptance.id,
    response: input.response
  }));
  return acceptance;
}

export async function createInvoiceFromBooking(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  input: {
    invoiceId: string;
    lineIdPrefix: string;
    bookingId: string;
    issuerOrganisationId: string;
    dueDate: string;
    billingSnapshot: Record<string, unknown>;
    paymentTermsSnapshot: Record<string, unknown>;
    taxRateBps?: number;
    domainEventId: string;
  }
) {
  requireAdvertisingPermission(context, permissions, "invoiceCreate");
  const booking = requireBooking(data, input.bookingId);
  const advertiser = requireAdvertiser(data, booking.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  const bookingItems = data.bookingItems.filter((item) => item.bookingId === booking.id && !item.deletedAt);
  if (bookingItems.length === 0) {
    throw new Error("Cannot invoice booking without items.");
  }
  const lines: AdvertiserInvoiceLine[] = bookingItems.map((item, index) => invoiceLineFromBookingItem(input.invoiceId, `${input.lineIdPrefix}_${index + 1}`, item, input.taxRateBps ?? 2000));
  const subtotalMinor = lines.reduce((sum, line) => sum + line.netMinor, 0);
  const taxMinor = lines.reduce((sum, line) => sum + line.taxMinor, 0);
  const totalMinor = lines.reduce((sum, line) => sum + line.grossMinor, 0);
  const invoice: AdvertiserInvoice = {
    id: input.invoiceId,
    issuerOrganisationId: input.issuerOrganisationId,
    advertiserId: advertiser.id,
    customerOrganisationId: advertiser.advertiserOrganisationId,
    territoryId: booking.territoryId,
    bookingId: booking.id,
    invoiceNumber: "DRAFT",
    status: "draft",
    issueDate: null,
    dueDate: input.dueDate,
    voidedAt: null,
    currency: booking.currency,
    subtotalMinor,
    taxMinor,
    totalMinor,
    amountPaidMinor: 0,
    balanceMinor: totalMinor,
    billingSnapshot: { ...input.billingSnapshot },
    paymentTermsSnapshot: { ...input.paymentTermsSnapshot },
    issuedSnapshot: {}
  };
  data.invoices.push(invoice);
  data.invoiceLines.push(...lines);
  emitAdvertiserEvent(data, event(input.domainEventId, "advertiser.invoice.created", "advertiser_invoice", invoice.id, advertiser, {
    invoiceId: invoice.id,
    bookingId: booking.id,
    totalMinor
  }));
  await audit.record(auditEvent(context, auditActions.advertiserInvoiceCreate, advertiser, {
    invoiceId: invoice.id,
    bookingId: booking.id,
    totalMinor
  }));
  return invoice;
}

export async function issueInvoice(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  input: {
    invoiceId: string;
    issuedOn: string;
    sequenceKey?: string;
    domainEventId: string;
  }
) {
  requireAdvertisingPermission(context, permissions, "invoiceIssue");
  const invoice = requireInvoice(data, input.invoiceId);
  const advertiser = requireAdvertiser(data, invoice.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (invoice.status !== "draft") {
    throw new Error("Only draft invoices can be issued.");
  }
  const sequence = requireInvoiceSequence(data, invoice.issuerOrganisationId, input.sequenceKey ?? "default");
  invoice.invoiceNumber = formatInvoiceNumber(sequence);
  sequence.nextNumber += 1;
  invoice.status = "issued";
  invoice.issueDate = input.issuedOn;
  invoice.issuedSnapshot = invoiceSnapshot(data, invoice);
  emitAdvertiserEvent(data, event(input.domainEventId, "advertiser.invoice.issued", "advertiser_invoice", invoice.id, advertiser, {
    invoiceNumber: invoice.invoiceNumber,
    totalMinor: invoice.totalMinor
  }));
  await audit.record(auditEvent(context, auditActions.advertiserInvoiceIssue, advertiser, {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    totalMinor: invoice.totalMinor
  }));
  return invoice;
}

export async function editDraftInvoice(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  data: AdvertisingData,
  invoiceId: string,
  patch: Partial<Pick<AdvertiserInvoice, "dueDate" | "billingSnapshot" | "paymentTermsSnapshot">>
) {
  requireAdvertisingPermission(context, permissions, "invoiceEditDraft");
  const invoice = requireInvoice(data, invoiceId);
  const advertiser = requireAdvertiser(data, invoice.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (invoice.status !== "draft") {
    throw new Error("Issued invoices cannot be materially edited.");
  }
  Object.assign(invoice, patch);
  return invoice;
}

export async function recordPayment(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  payment: AdvertiserPayment,
  domainEventId: string
) {
  requireAdvertisingPermission(context, permissions, "paymentRecord");
  const existing = payment.providerKey && payment.providerEventId
    ? data.payments.find((candidate) => candidate.providerKey === payment.providerKey && candidate.providerEventId === payment.providerEventId && !candidate.deletedAt)
    : undefined;
  if (existing) {
    return existing;
  }
  const advertiser = requireAdvertiser(data, payment.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  const storedPayment = { ...payment, allocatedMinor: 0, unallocatedMinor: payment.amountMinor };
  data.payments.push(storedPayment);
  emitAdvertiserEvent(data, event(domainEventId, "advertiser.payment.received", "advertiser_payment", payment.id, advertiser, {
    amountMinor: payment.amountMinor,
    providerKey: payment.providerKey ?? null
  }));
  await audit.record(auditEvent(context, auditActions.advertiserPaymentRecord, advertiser, {
    paymentId: payment.id,
    amountMinor: payment.amountMinor
  }));
  return storedPayment;
}

export async function allocatePayment(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  allocation: AdvertiserPaymentAllocation,
  domainEventId: string
) {
  requireAdvertisingPermission(context, permissions, "paymentAllocate");
  const payment = requirePayment(data, allocation.paymentId);
  const invoice = requireInvoice(data, allocation.invoiceId);
  const advertiser = requireAdvertiser(data, invoice.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (payment.advertiserId !== invoice.advertiserId || payment.issuerOrganisationId !== invoice.issuerOrganisationId) {
    throw new Error("Payment and invoice must share advertiser and issuer.");
  }
  if (allocation.amountMinor > payment.unallocatedMinor || allocation.amountMinor > invoice.balanceMinor) {
    throw new Error("Allocation cannot exceed payment or invoice balance.");
  }
  data.paymentAllocations.push(allocation);
  payment.allocatedMinor += allocation.amountMinor;
  payment.unallocatedMinor -= allocation.amountMinor;
  invoice.amountPaidMinor += allocation.amountMinor;
  invoice.balanceMinor -= allocation.amountMinor;
  invoice.status = invoice.balanceMinor === 0 ? "paid" : "part_paid";
  emitAdvertiserEvent(data, event(domainEventId, "advertiser.payment.allocated", "advertiser_payment_allocation", allocation.id, advertiser, {
    paymentId: payment.id,
    invoiceId: invoice.id,
    amountMinor: allocation.amountMinor
  }));
  if (invoice.status === "paid") {
    emitAdvertiserEvent(data, event(`${domainEventId}_paid`, "advertiser.invoice.paid", "advertiser_invoice", invoice.id, advertiser, {
      invoiceId: invoice.id
    }));
  }
  await audit.record(auditEvent(context, auditActions.advertiserPaymentAllocate, advertiser, {
    allocationId: allocation.id,
    paymentId: payment.id,
    invoiceId: invoice.id,
    amountMinor: allocation.amountMinor
  }));
  return allocation;
}

export async function issueCreditNote(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  input: {
    creditNote: AdvertiserCreditNote;
    lines: AdvertiserCreditNoteLine[];
    domainEventId: string;
  }
) {
  requireAdvertisingPermission(context, permissions, "creditCreate");
  const invoice = requireInvoice(data, input.creditNote.invoiceId);
  const advertiser = requireAdvertiser(data, invoice.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  const totalMinor = input.lines.reduce((sum, line) => sum + line.grossMinor, 0);
  if (totalMinor > invoice.balanceMinor) {
    throw new Error("Credit note cannot exceed invoice balance.");
  }
  const credit = {
    ...input.creditNote,
    subtotalMinor: input.lines.reduce((sum, line) => sum + line.netMinor, 0),
    taxMinor: input.lines.reduce((sum, line) => sum + line.taxMinor, 0),
    totalMinor,
    snapshot: { invoiceNumber: invoice.invoiceNumber, lines: input.lines }
  };
  data.creditNotes.push(credit);
  data.creditNoteLines.push(...input.lines);
  invoice.balanceMinor -= totalMinor;
  invoice.status = invoice.balanceMinor === 0 ? "credited" : invoice.status;
  emitAdvertiserEvent(data, event(input.domainEventId, "advertiser.credit.issued", "advertiser_credit_note", credit.id, advertiser, {
    invoiceId: invoice.id,
    totalMinor
  }));
  await audit.record(auditEvent(context, auditActions.advertiserCreditIssue, advertiser, {
    creditNoteId: credit.id,
    invoiceId: invoice.id,
    totalMinor
  }));
  return credit;
}

export async function createArtworkRequirement(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  requirement: ArtworkRequirement,
  domainEventId: string
) {
  requireAdvertisingPermission(context, permissions, "artworkManage");
  const advertiser = requireAdvertiser(data, requirement.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  const request = data.productionRequests.find((candidate) => candidate.id === requirement.productionRequestId && !candidate.deletedAt);
  if (!request || request.advertiserId !== advertiser.id || request.territoryId !== requirement.territoryId) {
    throw new Error("Artwork requirement must reference a matching production request.");
  }
  if (data.artworkRequirements.some((candidate) => candidate.productionRequestId === requirement.productionRequestId && !candidate.deletedAt)) {
    throw new Error("Production request already has an artwork requirement.");
  }
  data.artworkRequirements.push(requirement);
  emitAdvertiserEvent(data, event(domainEventId, "advertiser.artwork.requested", "artwork_requirement", requirement.id, advertiser, {
    productionRequestId: requirement.productionRequestId,
    bookingItemId: requirement.bookingItemId
  }));
  await audit.record(auditEvent(context, auditActions.advertiserArtworkRequest, advertiser, {
    artworkRequirementId: requirement.id,
    productionRequestId: requirement.productionRequestId
  }));
  return requirement;
}

export async function submitArtworkVersion(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  requirementId: string,
  version: ArtworkVersion,
  domainEventId: string
) {
  requireAdvertisingPermission(context, permissions, "artworkSubmit");
  const requirement = requireArtworkRequirement(data, requirementId);
  const advertiser = requireAdvertiser(data, requirement.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (version.artworkRequirementId !== requirement.id) {
    throw new Error("Artwork version must reference the requirement.");
  }
  data.artworkVersions.push(version);
  requirement.status = version.preflightResultId && version.status === "rejected" ? "rejected" : "submitted";
  emitAdvertiserEvent(data, event(domainEventId, "advertiser.artwork.submitted", "artwork_requirement", requirement.id, advertiser, {
    versionId: version.id,
    preflightResultId: version.preflightResultId ?? null
  }));
  await audit.record(auditEvent(context, auditActions.advertiserArtworkSubmit, advertiser, {
    artworkRequirementId: requirement.id,
    versionId: version.id
  }));
  if (version.status === "rejected") {
    await audit.record(auditEvent(context, auditActions.advertiserArtworkPreflightFail, advertiser, {
      artworkRequirementId: requirement.id,
      versionId: version.id,
      preflightResultId: version.preflightResultId ?? null
    }));
  }
  return version;
}

export async function updateArtworkStatus(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  requirementId: string,
  input: {
    status: ArtworkRequirement["status"];
    approvedVersionId?: string | null;
    proofReference?: Record<string, unknown>;
    actorDate: string;
    domainEventId: string;
  }
) {
  requireAdvertisingPermission(context, permissions, input.status === "production_ready" || input.status === "approved" ? "artworkApprove" : "artworkManage");
  const requirement = requireArtworkRequirement(data, requirementId);
  const advertiser = requireAdvertiser(data, requirement.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser);
  if (input.approvedVersionId && !data.artworkVersions.some((version) => version.id === input.approvedVersionId && version.artworkRequirementId === requirement.id && !version.deletedAt)) {
    throw new Error("Approved artwork version must belong to the requirement.");
  }
  requirement.status = input.status;
  requirement.approvedVersionId = input.approvedVersionId ?? requirement.approvedVersionId ?? null;
  requirement.proofReference = input.proofReference ?? requirement.proofReference;
  if (input.status === "approved") {
    requirement.advertiserApprovedAt = input.actorDate;
  }
  if (input.status === "production_ready") {
    requirement.productionApprovedAt = input.actorDate;
  }
  const action = input.status === "changes_requested"
    ? auditActions.advertiserArtworkChangesRequest
    : input.status === "approved"
      ? auditActions.advertiserArtworkProofApprove
      : input.status === "production_ready"
        ? auditActions.advertiserArtworkProductionReady
        : auditActions.advertiserArtworkProofIssue;
  const eventType = input.status === "changes_requested"
    ? "advertiser.artwork.changes_requested"
    : input.status === "approved"
      ? "advertiser.artwork.proof_approved"
      : input.status === "production_ready"
        ? "advertiser.artwork.production_ready"
        : "advertiser.artwork.proof_issued";
  emitAdvertiserEvent(data, event(input.domainEventId, eventType, "artwork_requirement", requirement.id, advertiser, {
    status: input.status,
    approvedVersionId: requirement.approvedVersionId ?? null
  }));
  await audit.record(auditEvent(context, action, advertiser, {
    artworkRequirementId: requirement.id,
    status: input.status
  }));
  return requirement;
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
    acceptances: data.acceptances.filter((acceptance) => acceptance.advertiserId === advertiser.id && !acceptance.deletedAt),
    invoices: data.invoices.filter((invoice) => invoice.advertiserId === advertiser.id && !invoice.deletedAt),
    creditNotes: data.creditNotes.filter((credit) => {
      const invoice = data.invoices.find((candidate) => candidate.id === credit.invoiceId);
      return invoice?.advertiserId === advertiser.id && !credit.deletedAt;
    }),
    payments: data.payments.filter((payment) => payment.advertiserId === advertiser.id && !payment.deletedAt),
    artworkRequirements: data.artworkRequirements.filter((requirement) => requirement.advertiserId === advertiser.id && !requirement.deletedAt),
    artworkVersions: data.artworkVersions.filter((version) => {
      const requirement = data.artworkRequirements.find((candidate) => candidate.id === version.artworkRequirementId);
      return requirement?.advertiserId === advertiser.id && !version.deletedAt;
    }),
    financeSummary: financeSummary(data, advertiser.id),
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

function requireBooking(data: AdvertisingData, bookingId: string) {
  const booking = data.bookings.find((candidate) => candidate.id === bookingId && !candidate.deletedAt);
  if (!booking) {
    throw new Error("Booking was not found.");
  }
  return booking;
}

function requireInvoice(data: AdvertisingData, invoiceId: string) {
  const invoice = data.invoices.find((candidate) => candidate.id === invoiceId && !candidate.deletedAt);
  if (!invoice) {
    throw new Error("Invoice was not found.");
  }
  return invoice;
}

function requirePayment(data: AdvertisingData, paymentId: string) {
  const payment = data.payments.find((candidate) => candidate.id === paymentId && !candidate.deletedAt);
  if (!payment) {
    throw new Error("Payment was not found.");
  }
  return payment;
}

function requireArtworkRequirement(data: AdvertisingData, requirementId: string) {
  const requirement = data.artworkRequirements.find((candidate) => candidate.id === requirementId && !candidate.deletedAt);
  if (!requirement) {
    throw new Error("Artwork requirement was not found.");
  }
  return requirement;
}

function requireInvoiceSequence(data: AdvertisingData, issuerOrganisationId: string, key: string) {
  const sequence = data.invoiceSequences.find((candidate) => candidate.issuerOrganisationId === issuerOrganisationId && candidate.key === key);
  if (!sequence) {
    throw new Error("Invoice sequence was not found for issuer.");
  }
  return sequence;
}

function requireTerms(data: AdvertisingData, termsId: string): AdvertiserTerms {
  const terms = data.terms.find((candidate) => candidate.id === termsId && !candidate.deletedAt);
  if (!terms || terms.status !== "approved") {
    throw new Error("Approved advertiser terms were not found.");
  }
  return terms;
}

function ensureProposalAcceptable(
  data: AdvertisingData,
  proposal: CommercialProposal,
  terms: AdvertiserTerms,
  todayDate: string
) {
  if (proposal.status !== "sent") {
    throw new Error("Only sent proposals can be accepted or responded to.");
  }
  if (proposal.validUntil && proposal.validUntil < todayDate) {
    throw new Error("Expired proposals cannot be accepted.");
  }
  if (proposal.metadata.current === false || proposal.metadata.supersededBy) {
    throw new Error("Superseded proposal versions cannot be accepted.");
  }
  if (terms.status !== "approved") {
    throw new Error("Only approved terms can be accepted.");
  }
  if (data.acceptances.some((candidate) => candidate.proposalId === proposal.id && !candidate.deletedAt)) {
    throw new Error("Proposal already has an acceptance response.");
  }
}

function commercialSnapshot(data: AdvertisingData, proposal: CommercialProposal, terms: AdvertiserTerms) {
  const items = data.proposalItems.filter((item) => item.proposalId === proposal.id && !item.deletedAt);
  return {
    proposal: {
      id: proposal.id,
      version: proposal.version,
      title: proposal.title,
      totalValueMinor: proposal.totalValueMinor,
      currency: proposal.currency,
      validUntil: proposal.validUntil
    },
    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      inventorySlotId: item.inventorySlotId ?? null,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      totalPriceMinor: item.totalPriceMinor,
      currency: item.currency
    })),
    terms: {
      id: terms.id,
      key: terms.key,
      version: terms.version,
      contentHash: terms.contentHash
    }
  };
}

function emitAdvertiserEvent(data: AdvertisingData, event: AdvertiserDomainEvent) {
  if (data.domainEvents.some((candidate) => candidate.idempotencyKey === event.idempotencyKey)) {
    return;
  }
  data.domainEvents.push(event);
}

function event(id: string, eventType: string, entityType: string, entityId: string, advertiser: AdvertiserRecord, payload: Record<string, unknown>): AdvertiserDomainEvent {
  return {
    id,
    eventType,
    entityType,
    entityId,
    advertiserId: advertiser.id,
    territoryId: advertiser.owningTerritoryId,
    payload,
    idempotencyKey: `${eventType}:${entityId}`
  };
}

function formatInvoiceNumber(sequence: { prefix: string; nextNumber: number; padding: number }) {
  return `${sequence.prefix}-${String(sequence.nextNumber).padStart(sequence.padding, "0")}`;
}

function invoiceLineFromBookingItem(invoiceId: string, id: string, item: CommercialBookingItem, taxRateBps: number): AdvertiserInvoiceLine {
  const netMinor = item.totalPriceMinor;
  const taxMinor = Math.round((netMinor * taxRateBps) / 10000);
  return {
    id,
    invoiceId,
    bookingItemId: item.id,
    productId: item.productId,
    description: item.description,
    quantity: item.quantity,
    netMinor,
    taxRateBps,
    taxMinor,
    grossMinor: netMinor + taxMinor,
    taxCode: "standard_vat"
  };
}

function invoiceSnapshot(data: AdvertisingData, invoice: AdvertiserInvoice) {
  return {
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issuerOrganisationId: invoice.issuerOrganisationId,
      advertiserId: invoice.advertiserId,
      subtotalMinor: invoice.subtotalMinor,
      taxMinor: invoice.taxMinor,
      totalMinor: invoice.totalMinor,
      currency: invoice.currency,
      billingSnapshot: invoice.billingSnapshot,
      paymentTermsSnapshot: invoice.paymentTermsSnapshot
    },
    lines: data.invoiceLines.filter((line) => line.invoiceId === invoice.id && !line.deletedAt)
  };
}

function financeSummary(data: AdvertisingData, advertiserId: string) {
  const invoices = data.invoices.filter((invoice) => invoice.advertiserId === advertiserId && !invoice.deletedAt);
  const payments = data.payments.filter((payment) => payment.advertiserId === advertiserId && !payment.deletedAt);
  return {
    lifetimeInvoicedMinor: invoices.reduce((sum, invoice) => sum + invoice.totalMinor, 0),
    lifetimePaidMinor: payments.reduce((sum, payment) => sum + payment.allocatedMinor, 0),
    outstandingMinor: invoices.reduce((sum, invoice) => sum + invoice.balanceMinor, 0),
    overdueMinor: invoices
      .filter((invoice) => invoice.dueDate && invoice.dueDate < today() && invoice.balanceMinor > 0)
      .reduce((sum, invoice) => sum + invoice.balanceMinor, 0),
    unallocatedPaymentsMinor: payments.reduce((sum, payment) => sum + payment.unallocatedMinor, 0)
  };
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
