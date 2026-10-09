import { randomUUID } from "node:crypto";
import { auditActions } from "@raring2go/audit";
import { evaluatePermission, requirePermission, type PermissionData } from "@raring2go/permissions";
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
  CampaignFulfilment,
  CatalogueView,
  CommercialCommandCentreView,
  CommercialBooking,
  CommercialBookingItem,
  CommercialProductionRequest,
  CommercialProposal,
  CommercialProposalItem,
  InventoryReservation,
  Opportunity,
  OpportunityView,
  PipelineView,
  ProofPack,
  RenewalPrompt
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

export function getCommercialCommandCentre(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  data: AdvertisingData
): CommercialCommandCentreView {
  requireAdvertisingPermission(context, permissions, "analyticsView");
  const visibleTerritoryIds = visibleTerritories(context, data);
  const visibleAdvertisers = data.advertisers
    .filter((advertiser) => !advertiser.deletedAt && advertiser.status !== "archived")
    .filter((advertiser) => visibleTerritoryIds == null || visibleTerritoryIds.has(advertiser.owningTerritoryId));
  const visibleAdvertiserIds = new Set(visibleAdvertisers.map((advertiser) => advertiser.id));
  const opportunities = data.opportunities.filter((opportunity) => visibleAdvertiserIds.has(opportunity.advertiserId) && !opportunity.deletedAt);
  const bookings = data.bookings.filter((booking) => visibleAdvertiserIds.has(booking.advertiserId) && !booking.deletedAt);
  const invoices = data.invoices.filter((invoice) => visibleAdvertiserIds.has(invoice.advertiserId) && !invoice.deletedAt);
  const payments = data.payments.filter((payment) => visibleAdvertiserIds.has(payment.advertiserId) && !payment.deletedAt);
  const artwork = data.artworkRequirements.filter((requirement) => visibleAdvertiserIds.has(requirement.advertiserId) && !requirement.deletedAt);
  const fulfilments = data.campaignFulfilments.filter((fulfilment) => visibleAdvertiserIds.has(fulfilment.advertiserId) && !fulfilment.deletedAt);
  const renewals = data.renewalPrompts.filter((renewal) => visibleAdvertiserIds.has(renewal.advertiserId) && !renewal.deletedAt);
  const openOpportunities = opportunities.filter((opportunity) => {
    const stage = data.pipelineStages.find((candidate) => candidate.id === opportunity.stageId);
    return !stage?.isClosed;
  });
  const territoryBenchmarks = [...new Set(visibleAdvertisers.map((advertiser) => advertiser.owningTerritoryId))]
    .sort()
    .map((territoryId) => {
      const territoryAdvertisers = visibleAdvertisers.filter((advertiser) => advertiser.owningTerritoryId === territoryId);
      const territoryAdvertiserIds = new Set(territoryAdvertisers.map((advertiser) => advertiser.id));
      const territoryBookings = bookings.filter((booking) => territoryAdvertiserIds.has(booking.advertiserId));
      const territoryInvoices = invoices.filter((invoice) => territoryAdvertiserIds.has(invoice.advertiserId));
      const territoryOpportunities = opportunities.filter((opportunity) => territoryAdvertiserIds.has(opportunity.advertiserId));
      const territoryClosed = territoryOpportunities.filter((opportunity) => data.pipelineStages.find((stage) => stage.id === opportunity.stageId)?.isClosed);
      const territoryWon = territoryOpportunities.filter((opportunity) => data.pipelineStages.find((stage) => stage.id === opportunity.stageId)?.outcome === "won");
      const territory = data.territories.find((candidate) => candidate.id === territoryId);
      return {
        territoryId,
        territoryName: territory?.name,
        advertisers: territoryAdvertisers.length,
        bookedValueMinor: territoryBookings.reduce((sum, booking) => sum + booking.totalValueMinor, 0),
        annualAdvertiserValueMinor: territoryAdvertisers.reduce((sum, advertiser) => sum + advertiser.annualAdvertiserValueMinor, 0),
        averageSaleValueMinor: average(territoryAdvertisers.map((advertiser) => advertiser.averageSaleValueMinor)),
        overdueDebtMinor: territoryInvoices
          .filter((invoice) => invoice.dueDate && invoice.dueDate < today() && invoice.balanceMinor > 0)
          .reduce((sum, invoice) => sum + invoice.balanceMinor, 0),
        conversionRate: territoryClosed.length === 0 ? 0 : Math.round((territoryWon.length / territoryClosed.length) * 100),
        retentionRate: percentage(territoryAdvertisers.filter((advertiser) => advertiser.relationshipState === "retained").length, territoryAdvertisers.length),
        openRenewals: renewals.filter((renewal) => renewal.territoryId === territoryId && renewal.status === "open").length
      };
    });

  return {
    scope: context.territoryId ? "territory" : "network",
    totals: {
      advertisers: visibleAdvertisers.length,
      activeAdvertisers: visibleAdvertisers.filter((advertiser) => advertiser.status === "active").length,
      newAdvertisers: visibleAdvertisers.filter((advertiser) => advertiser.relationshipState === "new").length,
      retainedAdvertisers: visibleAdvertisers.filter((advertiser) => advertiser.relationshipState === "retained").length,
      lapsedAdvertisers: visibleAdvertisers.filter((advertiser) => advertiser.relationshipState === "lapsed").length,
      pipelineValueMinor: openOpportunities.reduce((sum, opportunity) => sum + opportunity.estimatedValueMinor, 0),
      weightedPipelineMinor: openOpportunities.reduce((sum, opportunity) => sum + Math.round((opportunity.estimatedValueMinor * opportunity.probability) / 100), 0),
      bookedValueMinor: bookings.reduce((sum, booking) => sum + booking.totalValueMinor, 0),
      invoicedMinor: invoices.reduce((sum, invoice) => sum + invoice.totalMinor, 0),
      paidMinor: payments.reduce((sum, payment) => sum + payment.allocatedMinor, 0),
      overdueDebtMinor: invoices
        .filter((invoice) => invoice.dueDate && invoice.dueDate < today() && invoice.balanceMinor > 0)
        .reduce((sum, invoice) => sum + invoice.balanceMinor, 0),
      openArtwork: artwork.filter((requirement) => requirement.status !== "production_ready").length,
      openFulfilments: fulfilments.filter((fulfilment) => fulfilment.status !== "fulfilled").length,
      openRenewals: renewals.filter((renewal) => renewal.status === "open").length
    },
    territoryBenchmarks,
    attention: {
      overdueDebtAdvertiserIds: [...new Set(invoices.filter((invoice) => invoice.dueDate && invoice.dueDate < today() && invoice.balanceMinor > 0).map((invoice) => invoice.advertiserId))],
      artworkAdvertiserIds: [...new Set(artwork.filter((requirement) => requirement.status !== "production_ready").map((requirement) => requirement.advertiserId))],
      fulfilmentAdvertiserIds: [...new Set(fulfilments.filter((fulfilment) => fulfilment.status !== "fulfilled").map((fulfilment) => fulfilment.advertiserId))],
      renewalAdvertiserIds: [...new Set(renewals.filter((renewal) => renewal.status === "open").map((renewal) => renewal.advertiserId))]
    }
  };
}

export function getAdvertiser360(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  data: AdvertisingData,
  advertiserId: string
): Advertiser360 {
  requireAdvertisingPermission(context, permissions, "view");
  const advertiser = requireAdvertiser(data, advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  // Status is a closed set. A form can post anything, so the domain, not the page, decides what is valid.
  if (patch.status !== undefined && !["prospect", "active", "paused", "archived"].includes(patch.status)) {
    throw new Error("That is not a valid advertiser status.");
  }
  Object.assign(advertiser, patch);
  await audit.record(auditEvent(context, auditActions.advertiserUpdate, advertiser, {
    patch: Object.keys(patch)
  }));
  return advertiser;
}

export type DerivedAdvertiserMetrics = Pick<
  AdvertiserRecord,
  "firstBookedOn" | "lastBookedOn" | "lapsedOn" | "averageSaleValueMinor" | "annualAdvertiserValueMinor" | "relationshipState"
>;

const dayMs = 24 * 60 * 60 * 1000;

/**
 * Average sale value, annual advertiser value and relationship state computed from the booking
 * history, so they cannot drift from what was actually sold. Annual value is the last 365 days;
 * a booking in the last 9 months keeps an advertiser healthy, 9 to 12 months is at risk, and
 * more than 12 months is lapsed (with the lapse date recorded).
 */
export function deriveAdvertiserMetrics(data: AdvertisingData, advertiserId: string, asOf: string = today()): DerivedAdvertiserMetrics {
  const bookings = data.bookings
    .filter((booking) => booking.advertiserId === advertiserId && booking.status === "booked" && !booking.deletedAt)
    .sort((left, right) => left.bookedOn.localeCompare(right.bookedOn));
  const asOfTime = Date.parse(`${asOf}T00:00:00Z`);
  const daysSince = (date: string) => Math.floor((asOfTime - Date.parse(`${date}T00:00:00Z`)) / dayMs);

  if (bookings.length === 0) {
    return { firstBookedOn: null, lastBookedOn: null, lapsedOn: null, averageSaleValueMinor: 0, annualAdvertiserValueMinor: 0, relationshipState: "new" };
  }

  const first = bookings[0]!.bookedOn;
  const last = bookings[bookings.length - 1]!.bookedOn;
  const recent = bookings.filter((booking) => daysSince(booking.bookedOn) <= 365);
  const sinceLast = daysSince(last);

  let relationshipState: AdvertiserRecord["relationshipState"];
  let lapsedOn: string | null = null;
  if (sinceLast > 365) {
    relationshipState = "lapsed";
    lapsedOn = new Date(Date.parse(`${last}T00:00:00Z`) + 365 * dayMs).toISOString().slice(0, 10);
  } else if (sinceLast > 270) {
    relationshipState = "at_risk";
  } else {
    // Retained once they have bought again after their first booking.
    relationshipState = bookings.length > 1 ? "retained" : "new";
  }

  return {
    firstBookedOn: first,
    lastBookedOn: last,
    lapsedOn,
    averageSaleValueMinor: Math.round(bookings.reduce((sum, booking) => sum + booking.totalValueMinor, 0) / bookings.length),
    annualAdvertiserValueMinor: recent.reduce((sum, booking) => sum + booking.totalValueMinor, 0),
    relationshipState
  };
}

export async function refreshAdvertiserMetrics(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  advertiserId: string,
  asOf: string = today()
) {
  requireAdvertisingPermission(context, permissions, "edit");
  const advertiser = requireAdvertiser(data, advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  const derived = deriveAdvertiserMetrics(data, advertiserId, asOf);
  const changed = (Object.keys(derived) as Array<keyof DerivedAdvertiserMetrics>).filter((key) => advertiser[key] !== derived[key]);
  if (changed.length === 0) return { advertiser, changed };

  Object.assign(advertiser, derived);
  await audit.record(auditEvent(context, auditActions.advertiserUpdate, advertiser, { derived: true, fields: changed, asOf }));
  return { advertiser, changed };
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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

export type PublishedPlacementEvidence = {
  territoryEditionId: string;
  editionPageId?: string | null;
  outputId: string;
  publishedOn?: string | null;
};

export type ProposalLineInput = {
  productId: string;
  quantity: number;
  /** Omit to charge the list price. Anything lower is a discount and is checked against the price book. */
  unitPriceMinor?: number;
  inventorySlotId?: string | null;
};

export type PricedProposalLine = {
  productId: string;
  quantity: number;
  unitPriceMinor: number;
  totalPriceMinor: number;
  standardPriceMinor: number;
  discountPercent: number;
  currency: string;
  inventorySlotId: string | null;
};

/** The price book that applies in a territory today: its own if it has one, otherwise the network book. */
function applicablePriceBookIds(data: AdvertisingData, territoryId: string, onDate: string) {
  const active = data.priceBooks.filter((book) =>
    !book.deletedAt && book.status === "active" &&
    (!book.effectiveFrom || book.effectiveFrom <= onDate) &&
    (!book.effectiveTo || book.effectiveTo >= onDate)
  );
  const own = active.filter((book) => book.territoryId === territoryId);
  return (own.length > 0 ? own : active.filter((book) => !book.territoryId)).map((book) => book.id);
}

/**
 * Prices a proposal line from the price book, never from what the client sent. A price below the
 * list price is a discount: below the book's minimum is refused outright, and below its approval
 * threshold needs the pricing-manage permission.
 */
export function priceProposalLine(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  data: AdvertisingData,
  territoryId: string,
  line: ProposalLineInput,
  onDate: string = today()
): PricedProposalLine {
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) {
    throw new Error("Quantity must be a whole number from 1 to 100.");
  }
  const product = requireProduct(data, line.productId);
  if (product.status !== "active") {
    throw new Error("That product is not available to sell.");
  }
  const bookIds = new Set(applicablePriceBookIds(data, territoryId, onDate));
  const item = data.priceBookItems.find((candidate) => !candidate.deletedAt && candidate.productId === product.id && bookIds.has(candidate.priceBookId));
  if (!item) {
    throw new Error("There is no price for that product in this territory.");
  }

  const unitPriceMinor = line.unitPriceMinor ?? item.standardPriceMinor;
  if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new Error("Price must be a whole number of pence.");
  }
  if (unitPriceMinor < item.minimumPriceMinor) {
    throw new Error("That price is below the minimum allowed for this product.");
  }
  if (unitPriceMinor < item.approvalRequiredBelowMinor) {
    const approver = evaluatePermission(
      { userId: context.userId, module: advertisingCapabilities.pricingManage.module, action: advertisingCapabilities.pricingManage.action, context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } },
      permissions
    ).allowed;
    if (!approver) {
      throw new Error("That discount needs approval from someone who can manage pricing.");
    }
  }
  if (line.inventorySlotId) {
    const slot = requireInventorySlot(data, line.inventorySlotId);
    if (slot.territoryId !== territoryId) throw new Error("Proposal inventory must belong to the proposal territory.");
    if (slot.productId !== product.id) throw new Error("That slot is not for this product.");
  } else if (product.requiresInventory) {
    throw new Error("Choose the edition slot this product is for.");
  }

  return {
    productId: product.id,
    quantity: line.quantity,
    unitPriceMinor,
    totalPriceMinor: unitPriceMinor * line.quantity,
    standardPriceMinor: item.standardPriceMinor,
    discountPercent: item.standardPriceMinor > 0 ? Math.max(0, Math.round(((item.standardPriceMinor - unitPriceMinor) / item.standardPriceMinor) * 100)) : 0,
    currency: item.currency,
    inventorySlotId: line.inventorySlotId ?? null
  };
}

export async function createPricedProposal(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  input: { proposalId: string; advertiserId: string; opportunityId?: string | null; title: string; validUntil: string; lines: ProposalLineInput[]; newId: () => string }
) {
  requireAdvertisingPermission(context, permissions, "proposalCreate");
  const advertiser = requireAdvertiser(data, input.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  if (input.lines.length === 0) throw new Error("Proposal requires at least one item.");
  if (input.validUntil < today()) throw new Error("A proposal cannot be valid until a date in the past.");

  const priced = input.lines.map((line) => priceProposalLine(context, permissions, data, advertiser.owningTerritoryId, line));
  const currencies = new Set(priced.map((line) => line.currency));
  if (currencies.size > 1) throw new Error("All proposal lines must use one currency.");

  return createProposal(
    context,
    permissions,
    audit,
    data,
    {
      id: input.proposalId,
      advertiserId: advertiser.id,
      opportunityId: input.opportunityId ?? null,
      territoryId: advertiser.owningTerritoryId,
      status: "draft",
      version: 1,
      title: input.title,
      totalValueMinor: 0,
      currency: priced[0]!.currency,
      validUntil: input.validUntil,
      sentOn: null,
      acceptedOn: null,
      metadata: {}
    },
    priced.map((line) => {
      const product = requireProduct(data, line.productId);
      return {
        id: input.newId(),
        proposalId: input.proposalId,
        productId: line.productId,
        packageId: null,
        inventorySlotId: line.inventorySlotId,
        description: product.name,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        totalPriceMinor: line.totalPriceMinor,
        currency: line.currency,
        metadata: { standardPriceMinor: line.standardPriceMinor, discountPercent: line.discountPercent }
      };
    })
  );
}

/** Sending freezes what the advertiser will be asked to accept: only a draft can be sent. */
export async function sendProposal(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  proposalId: string
) {
  requireAdvertisingPermission(context, permissions, "proposalCreate");
  const proposal = requireProposal(data, proposalId);
  const advertiser = requireAdvertiser(data, proposal.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  if (proposal.status !== "draft") throw new Error("Only a draft proposal can be sent.");
  if (!proposal.validUntil || proposal.validUntil < today()) throw new Error("Set a valid-until date in the future before sending.");

  proposal.status = "sent";
  proposal.sentOn = today();
  await audit.record(auditEvent(context, auditActions.advertiserProposalCreate, advertiser, { proposalId, action: "sent", totalValueMinor: proposal.totalValueMinor }));
  return proposal;
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
    /** When set, child ids come from here (real persistence needs UUIDs); otherwise `${prefix}_${n}`. */
    newId?: () => string;
  }
) {
  requireAdvertisingPermission(context, permissions, "bookingAccept");
  const proposal = requireProposal(data, input.proposalId);
  const advertiser = requireAdvertiser(data, proposal.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  if (!["draft", "sent"].includes(proposal.status)) {
    const existing = data.bookings.find((booking) => booking.proposalId === proposal.id && !booking.deletedAt);
    if (proposal.status === "accepted" && existing) {
      return existing;
    }
    throw new Error("Only draft or sent proposals can be accepted into bookings.");
  }
  // A proposal's price is only held until its valid-until date; a lapsed one has to be re-quoted.
  if (proposal.validUntil && proposal.validUntil < input.acceptedOn) {
    throw new Error("Expired proposals cannot be accepted.");
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
  const artworkRequirementsToCreate: ArtworkRequirement[] = [];
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
      inventoryReservationId = input.newId ? input.newId() : `${input.reservationIdPrefix}_${index + 1}`;
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

    const bookingItemId = input.newId ? input.newId() : `${input.bookingItemIdPrefix}_${index + 1}`;
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
      const productionRequestId = input.newId ? input.newId() : `${input.productionRequestIdPrefix}_${index + 1}`;
      productionRequests.push({
        id: productionRequestId,
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
      // Booking is the handoff to production: the advertiser is asked for artwork straight away, placed
      // on the slot's edition and page when there is one, so nothing depends on someone remembering to ask.
      const slot = inventorySlotForBookingItem(data, inventoryReservationId, reservations);
      artworkRequirementsToCreate.push({
        id: input.newId ? input.newId() : `${input.productionRequestIdPrefix}_artwork_${index + 1}`,
        productionRequestId,
        bookingItemId,
        advertiserId: proposal.advertiserId,
        territoryId: proposal.territoryId,
        territoryEditionId: slot?.territoryEditionId ?? null,
        editionPageId: slot?.editionPageId ?? null,
        inventorySlotId: slot?.id ?? null,
        sourceType: "advertiser_supplied",
        status: "requested",
        specification: { productKey: product.key },
        dimensions: {},
        contentFields: {},
        deadline: null,
        approvedVersionId: null,
        proofReference: {},
        advertiserApprovedAt: null,
        productionApprovedAt: null
      });
    }
  });

  proposal.status = "accepted";
  proposal.acceptedOn = input.acceptedOn;
  data.inventoryReservations.push(...reservations);
  data.bookings.push(booking);
  data.bookingItems.push(...bookingItems);
  data.productionRequests.push(...productionRequests);
  data.artworkRequirements.push(...artworkRequirementsToCreate);
  for (const requirement of artworkRequirementsToCreate) {
    emitAdvertiserEvent(data, event(input.newId ? input.newId() : `${requirement.id}_event`, "advertiser.artwork.requested", "artwork_requirement", requirement.id, advertiser, {
      productionRequestId: requirement.productionRequestId,
      bookingItemId: requirement.bookingItemId
    }));
  }
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
    newId?: () => string;
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
      acceptedOn: input.acceptedAt,
      newId: input.newId
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
      id: input.newId ? input.newId() : `${input.domainEventId}_booking`,
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
    domainEventId: string;
    /** Real persistence needs UUIDs for line ids; without it ids are `${lineIdPrefix}_${n}`. */
    newId?: () => string;
  }
) {
  requireAdvertisingPermission(context, permissions, "invoiceCreate");
  const booking = requireBooking(data, input.bookingId);
  const advertiser = requireAdvertiser(data, booking.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  const bookingItems = data.bookingItems.filter((item) => item.bookingId === booking.id && !item.deletedAt);
  if (bookingItems.length === 0) {
    throw new Error("Cannot invoice booking without items.");
  }
  const onDate = today();
  const lines: AdvertiserInvoiceLine[] = bookingItems.map((item, index) => {
    const taxCode = requireProduct(data, item.productId).taxCode;
    return invoiceLineFromBookingItem(input.invoiceId, input.newId ? input.newId() : `${input.lineIdPrefix}_${index + 1}`, item, taxCode, taxRateFor(data, taxCode, onDate));
  });
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
    // Unique per draft: the database enforces one invoice number per issuer, so drafts cannot all be "DRAFT".
    invoiceNumber: `DRAFT-${input.invoiceId}`,
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  if (invoice.status !== "draft") {
    throw new Error("Only draft invoices can be issued.");
  }
  const sequence = requireInvoiceSequence(data, invoice.issuerOrganisationId, input.sequenceKey ?? "default");
  invoice.invoiceNumber = formatInvoiceNumber(sequence);
  sequence.nextNumber += 1;
  invoice.status = "issued";
  invoice.issueDate = input.issuedOn;
  invoice.issuedSnapshot = invoiceSnapshot(data, invoice);
  queueAccountingSync(data, "advertiser_invoice", invoice.id);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  domainEventId: string,
  /** Real persistence needs UUIDs for the events this emits; without it ids are derived as `${domainEventId}_paid`. */
  options: { newId?: () => string } = {}
) {
  requireAdvertisingPermission(context, permissions, "paymentAllocate");
  const payment = requirePayment(data, allocation.paymentId);
  const invoice = requireInvoice(data, allocation.invoiceId);
  const advertiser = requireAdvertiser(data, invoice.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
    emitAdvertiserEvent(data, event(options.newId ? options.newId() : `${domainEventId}_paid`, "advertiser.invoice.paid", "advertiser_invoice", invoice.id, advertiser, {
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  queueAccountingSync(data, "advertiser_credit_note", credit.id);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
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
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  if (version.artworkRequirementId !== requirement.id) {
    throw new Error("Artwork version must reference the requirement.");
  }
  data.artworkVersions.push(version);
  requirement.status = version.preflightResultId && version.status === "rejected" ? "rejected" : "submitted";
  // A failed preflight is a production exception: it stays open, and blocks sign-off, until a later
  // version gets through. Nothing here lets an exception be bypassed.
  const exceptions = artworkExceptions(requirement);
  if (version.status === "rejected") {
    exceptions.push({ versionId: version.id, preflightResultId: version.preflightResultId ?? null, raisedAt: today(), resolvedAt: null });
  } else {
    for (const open of exceptions) if (!open.resolvedAt) open.resolvedAt = today();
  }
  requirement.proofReference = { ...requirement.proofReference, exceptions };
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
    /** The edition page's readiness, read by the caller from Edition Factory when the artwork is placed on a page. */
    pageReadiness?: string | null;
  }
) {
  requireAdvertisingPermission(context, permissions, input.status === "production_ready" || input.status === "approved" ? "artworkApprove" : "artworkManage");
  const requirement = requireArtworkRequirement(data, requirementId);
  const advertiser = requireAdvertiser(data, requirement.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  if (input.approvedVersionId && !data.artworkVersions.some((version) => version.id === input.approvedVersionId && version.artworkRequirementId === requirement.id && !version.deletedAt)) {
    throw new Error("Approved artwork version must belong to the requirement.");
  }
  assertArtworkTransition(data, requirement, input);
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

type ArtworkException = { versionId: string; preflightResultId: string | null; raisedAt: string; resolvedAt: string | null };

export function artworkExceptions(requirement: ArtworkRequirement): ArtworkException[] {
  const raw = requirement.proofReference?.exceptions;
  return Array.isArray(raw) ? (raw as ArtworkException[]) : [];
}

export function openArtworkExceptions(requirement: ArtworkRequirement) {
  return artworkExceptions(requirement).filter((entry) => !entry.resolvedAt);
}

const artworkTransitions: Record<string, string[]> = {
  requested: ["submitted", "received", "changes_requested"],
  submitted: ["received", "in_review", "changes_requested", "approved", "rejected"],
  received: ["in_review", "changes_requested", "approved", "rejected"],
  in_review: ["changes_requested", "approved", "rejected"],
  changes_requested: ["submitted", "received", "in_review", "approved"],
  rejected: ["submitted", "changes_requested"],
  approved: ["production_ready", "changes_requested"],
  production_ready: []
};

/**
 * What may happen to artwork next. Sign-off for production needs an approved, passing version, no
 * open production exception, and (when it is placed on a page) a page that Edition Factory says is
 * ready, so artwork can never be pushed to production past a failed preflight or an unready page.
 */
function assertArtworkTransition(
  data: AdvertisingData,
  requirement: ArtworkRequirement,
  input: { status: string; approvedVersionId?: string | null; pageReadiness?: string | null }
) {
  if (requirement.status === input.status) return;
  if (!(artworkTransitions[requirement.status] ?? []).includes(input.status)) {
    throw new Error(`Artwork cannot move from ${requirement.status.replaceAll("_", " ")} to ${input.status.replaceAll("_", " ")}.`);
  }

  const versionId = input.approvedVersionId ?? requirement.approvedVersionId;
  if (input.status === "approved" || input.status === "production_ready") {
    const version = versionId ? data.artworkVersions.find((candidate) => candidate.id === versionId && !candidate.deletedAt) : undefined;
    if (!version) throw new Error("Artwork needs a submitted version before it can be approved.");
    if (version.status === "rejected") throw new Error("A version that failed preflight cannot be approved.");
  }
  if (input.status === "production_ready") {
    if (openArtworkExceptions(requirement).length > 0) {
      throw new Error("Resolve the open production exception before sign-off.");
    }
    if (requirement.editionPageId && input.pageReadiness !== "ready") {
      throw new Error("The edition page is not ready for artwork sign-off.");
    }
  }
}

export async function recordCampaignFulfilment(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  fulfilment: CampaignFulfilment,
  domainEventId: string,
  /** Proof, found by the caller in Edition Factory, that the placement is in a published output. */
  options: { publishedEvidence?: PublishedPlacementEvidence } = {}
) {
  requireAdvertisingPermission(context, permissions, "fulfilmentManage");
  const booking = requireBooking(data, fulfilment.bookingId);
  const advertiser = requireAdvertiser(data, fulfilment.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  if (booking.advertiserId !== advertiser.id || booking.territoryId !== advertiser.owningTerritoryId) {
    throw new Error("Campaign fulfilment must match the advertiser booking.");
  }
  const bookingItem = requireBookingItem(data, fulfilment.bookingItemId);
  if (bookingItem.bookingId !== booking.id) {
    throw new Error("Campaign fulfilment must reference a booking item from the booking.");
  }
  if (fulfilment.territoryId !== advertiser.owningTerritoryId) {
    throw new Error("Campaign fulfilment territory must match the advertiser territory.");
  }
  // "Fulfilled" is a promise to the advertiser that their advert ran, so for an edition placement it
  // must point at a published output rather than be asserted.
  if (fulfilment.status === "fulfilled" && fulfilment.territoryEditionId) {
    const evidence = options.publishedEvidence;
    if (!evidence || evidence.territoryEditionId !== fulfilment.territoryEditionId || (fulfilment.editionPageId && evidence.editionPageId !== fulfilment.editionPageId)) {
      throw new Error("Fulfilment needs a published edition output for this placement.");
    }
    fulfilment = { ...fulfilment, fulfilledOn: fulfilment.fulfilledOn ?? today(), placementReference: { ...fulfilment.placementReference, publishedOutputId: evidence.outputId, publishedOn: evidence.publishedOn ?? null } };
  }
  if (fulfilment.artworkRequirementId) {
    const requirement = requireArtworkRequirement(data, fulfilment.artworkRequirementId);
    // Scheduling can happen while artwork is still being produced; running the campaign cannot.
    const needsArtwork = fulfilment.status === "in_progress" || fulfilment.status === "fulfilled";
    if (requirement.bookingItemId !== fulfilment.bookingItemId || (needsArtwork && requirement.status !== "production_ready")) {
      throw new Error("Campaign fulfilment requires production-ready artwork for the booking item.");
    }
  }
  const existing = data.campaignFulfilments.find((candidate) => candidate.bookingItemId === fulfilment.bookingItemId && !candidate.deletedAt);
  if (existing) {
    Object.assign(existing, {
      status: fulfilment.status,
      scheduledOn: fulfilment.scheduledOn,
      fulfilledOn: fulfilment.fulfilledOn,
      placementReference: fulfilment.placementReference,
      performanceReference: fulfilment.performanceReference,
      metadata: fulfilment.metadata
    });
    await audit.record(auditEvent(context, auditActions.advertiserFulfilmentRecord, advertiser, {
      fulfilmentId: existing.id,
      status: existing.status,
      updated: true
    }));
    return existing;
  }
  data.campaignFulfilments.push(fulfilment);
  emitAdvertiserEvent(data, event(domainEventId, "advertiser.campaign.fulfilment_recorded", "campaign_fulfilment", fulfilment.id, advertiser, {
    bookingItemId: fulfilment.bookingItemId,
    status: fulfilment.status
  }));
  await audit.record(auditEvent(context, auditActions.advertiserFulfilmentRecord, advertiser, {
    fulfilmentId: fulfilment.id,
    status: fulfilment.status
  }));
  return fulfilment;
}

export async function createProofPack(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  proofPack: Omit<ProofPack, "proofSnapshot"> & { proofSnapshot?: Record<string, unknown> },
  domainEventId: string
) {
  requireAdvertisingPermission(context, permissions, "proofCreate");
  const fulfilment = requireCampaignFulfilment(data, proofPack.fulfilmentId);
  const advertiser = requireAdvertiser(data, proofPack.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  if (fulfilment.advertiserId !== advertiser.id || fulfilment.territoryId !== advertiser.owningTerritoryId) {
    throw new Error("Proof pack must match the advertiser fulfilment.");
  }
  if (data.proofPacks.some((candidate) => candidate.fulfilmentId === fulfilment.id && !candidate.deletedAt)) {
    throw new Error("Fulfilment already has a proof pack.");
  }
  const created: ProofPack = {
    ...proofPack,
    proofSnapshot: proofPack.proofSnapshot ?? proofSnapshot(data, fulfilment)
  };
  data.proofPacks.push(created);
  emitAdvertiserEvent(data, event(domainEventId, "advertiser.proof_pack.created", "proof_pack", created.id, advertiser, {
    fulfilmentId: fulfilment.id,
    status: created.status
  }));
  await audit.record(auditEvent(context, auditActions.advertiserProofPackCreate, advertiser, {
    proofPackId: created.id,
    fulfilmentId: fulfilment.id
  }));
  if (created.status === "delivered") {
    await audit.record(auditEvent(context, auditActions.advertiserProofPackDeliver, advertiser, {
      proofPackId: created.id
    }));
  }
  return created;
}

export async function createRenewalPromptFromProofPack(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  renewal: RenewalPrompt,
  domainEventId: string
) {
  requireAdvertisingPermission(context, permissions, "renewalManage");
  const advertiser = requireAdvertiser(data, renewal.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  if (renewal.territoryId !== advertiser.owningTerritoryId) {
    throw new Error("Renewal prompt territory must match advertiser territory.");
  }
  if (renewal.sourceProofPackId) {
    const proofPack = requireProofPack(data, renewal.sourceProofPackId);
    if (proofPack.advertiserId !== advertiser.id) {
      throw new Error("Renewal prompt proof pack must match advertiser.");
    }
  }
  if (renewal.sourceBookingId) {
    const booking = requireBooking(data, renewal.sourceBookingId);
    if (booking.advertiserId !== advertiser.id) {
      throw new Error("Renewal prompt booking must match advertiser.");
    }
  }
  data.renewalPrompts.push(renewal);
  const proofPack = renewal.sourceProofPackId ? requireProofPack(data, renewal.sourceProofPackId) : null;
  if (proofPack) {
    proofPack.renewalPromptId = renewal.id;
  }
  emitAdvertiserEvent(data, event(domainEventId, "advertiser.renewal.prompt_created", "renewal_prompt", renewal.id, advertiser, {
    dueOn: renewal.dueOn ?? null,
    sourceBookingId: renewal.sourceBookingId ?? null,
    sourceProofPackId: renewal.sourceProofPackId ?? null
  }));
  await audit.record(auditEvent(context, auditActions.advertiserRenewalPromptCreate, advertiser, {
    renewalPromptId: renewal.id,
    dueOn: renewal.dueOn ?? null
  }));
  return renewal;
}

export type DerivedRenewal = {
  advertiserId: string;
  territoryId: string;
  sourceBookingId: string;
  sourceProofPackId: string | null;
  dueOn: string;
  renewalSnapshot: Record<string, unknown>;
};

const renewalLeadDays = 14;
const renewalDueDays = 30;
const highValueRenewalMinor = 200000;

/**
 * Who is due a renewal conversation, worked out from campaign history and advertiser value: the
 * latest fulfilled campaign per advertiser, once it has been over for two weeks, unless they have
 * already booked again, already have an open prompt, or the account is not live. Pure; callers
 * persist what it returns. A booking that already has a prompt (of any outcome) never gets another.
 */
export function deriveRenewalPrompts(data: AdvertisingData, asOf: string = today()): DerivedRenewal[] {
  const out: DerivedRenewal[] = [];
  const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

  for (const advertiser of data.advertisers.filter((candidate) => !candidate.deletedAt && ["active", "prospect"].includes(candidate.status))) {
    const fulfilled = data.campaignFulfilments
      .filter((item) => item.advertiserId === advertiser.id && item.status === "fulfilled" && item.fulfilledOn && !item.deletedAt)
      .sort((left, right) => right.fulfilledOn!.localeCompare(left.fulfilledOn!))[0];
    if (!fulfilled) continue;
    if (daysBetween(fulfilled.fulfilledOn!, asOf) < renewalLeadDays) continue;

    const prompts = data.renewalPrompts.filter((prompt) => prompt.advertiserId === advertiser.id && !prompt.deletedAt);
    if (prompts.some((prompt) => prompt.status === "open" || prompt.sourceBookingId === fulfilled.bookingId)) continue;
    const bookedAgain = data.bookings.some((booking) => booking.id !== fulfilled.bookingId && booking.advertiserId === advertiser.id && booking.status === "booked" && !booking.deletedAt && booking.bookedOn > fulfilled.fulfilledOn!);
    if (bookedAgain) continue;

    const proofPack = data.proofPacks.find((pack) => pack.fulfilmentId === fulfilled.id && !pack.deletedAt);
    const booking = data.bookings.find((candidate) => candidate.id === fulfilled.bookingId);
    out.push({
      advertiserId: advertiser.id,
      territoryId: advertiser.owningTerritoryId,
      sourceBookingId: fulfilled.bookingId,
      sourceProofPackId: proofPack?.id ?? null,
      dueOn: new Date(Date.parse(`${fulfilled.fulfilledOn}T00:00:00Z`) + renewalDueDays * 86400000).toISOString().slice(0, 10),
      renewalSnapshot: {
        lastFulfilledOn: fulfilled.fulfilledOn,
        lastCampaignValueMinor: booking?.totalValueMinor ?? null,
        annualAdvertiserValueMinor: advertiser.annualAdvertiserValueMinor,
        averageSaleValueMinor: advertiser.averageSaleValueMinor,
        priority: advertiser.annualAdvertiserValueMinor >= highValueRenewalMinor ? "high" : "normal",
        hasProofPack: Boolean(proofPack)
      }
    });
  }
  return out;
}

/** Writes the prompts `deriveRenewalPrompts` found, linking each to its proof pack. System work: no user, so no permission check. */
export function applyDerivedRenewals(data: AdvertisingData, derived: DerivedRenewal[], newId: () => string): RenewalPrompt[] {
  const created: RenewalPrompt[] = [];
  for (const item of derived) {
    const advertiser = requireAdvertiser(data, item.advertiserId);
    const prompt: RenewalPrompt = {
      id: newId(),
      advertiserId: item.advertiserId,
      territoryId: item.territoryId,
      sourceBookingId: item.sourceBookingId,
      sourceProofPackId: item.sourceProofPackId,
      status: "open",
      dueOn: item.dueOn,
      assignedToUserId: advertiser.accountOwnerUserId ?? null,
      opportunityId: null,
      renewalSnapshot: item.renewalSnapshot,
      metadata: { source: "renewal_engine" }
    };
    data.renewalPrompts.push(prompt);
    if (item.sourceProofPackId) {
      const pack = data.proofPacks.find((candidate) => candidate.id === item.sourceProofPackId);
      if (pack) pack.renewalPromptId = prompt.id;
    }
    emitAdvertiserEvent(data, event(newId(), "advertiser.renewal.prompt_created", "renewal_prompt", prompt.id, advertiser, { dueOn: prompt.dueOn, sourceBookingId: prompt.sourceBookingId, derived: true }));
    created.push(prompt);
  }
  return created;
}

export async function dismissRenewalPrompt(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  renewalId: string,
  reason: string
) {
  requireAdvertisingPermission(context, permissions, "renewalManage");
  const renewal = data.renewalPrompts.find((candidate) => candidate.id === renewalId && !candidate.deletedAt);
  if (!renewal) throw new Error("Renewal prompt was not found.");
  const advertiser = requireAdvertiser(data, renewal.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);
  if (renewal.status !== "open") throw new Error("Only an open renewal prompt can be dismissed.");
  if (!reason.trim()) throw new Error("Say why this renewal is being dismissed.");
  renewal.status = "dismissed";
  renewal.metadata = { ...renewal.metadata, dismissedReason: reason.trim(), dismissedByUserId: context.userId, dismissedOn: today() };
  await audit.record(auditEvent(context, auditActions.advertiserRenewalPromptCreate, advertiser, { renewalPromptId: renewal.id, action: "dismissed" }));
  return renewal;
}

/** Turns an open renewal into a pipeline opportunity, linking the two so it cannot be converted twice. */
export async function convertRenewalToOpportunity(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  input: { renewalId: string; opportunityId: string; stageId: string; title: string }
) {
  requireAdvertisingPermission(context, permissions, "renewalManage");
  const renewal = data.renewalPrompts.find((candidate) => candidate.id === input.renewalId && !candidate.deletedAt);
  if (!renewal) throw new Error("Renewal prompt was not found.");
  if (renewal.status !== "open") throw new Error("Only an open renewal prompt can be converted.");
  const advertiser = requireAdvertiser(data, renewal.advertiserId);
  ensureContextCanAccessAdvertiser(context, advertiser, data);

  const lastValue = Number(renewal.renewalSnapshot.lastCampaignValueMinor ?? 0);
  const opportunity = await createOpportunity(context, permissions, audit, data, {
    id: input.opportunityId,
    advertiserId: advertiser.id,
    territoryId: advertiser.owningTerritoryId,
    ownerUserId: context.userId,
    stageId: input.stageId,
    source: "renewal",
    title: input.title,
    estimatedValueMinor: lastValue,
    currency: advertiser.currency,
    probability: 0,
    expectedCloseDate: renewal.dueOn ?? null,
    nextAction: "Renewal conversation",
    nextActionDate: renewal.dueOn ?? null,
    notes: `From the renewal prompt for the campaign that finished ${renewal.renewalSnapshot.lastFulfilledOn ?? "recently"}.`
  });
  renewal.status = "converted";
  renewal.opportunityId = opportunity.id;
  return opportunity;
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
    campaignFulfilments: data.campaignFulfilments.filter((fulfilment) => fulfilment.advertiserId === advertiser.id && !fulfilment.deletedAt),
    proofPacks: data.proofPacks.filter((proofPack) => proofPack.advertiserId === advertiser.id && !proofPack.deletedAt),
    renewalPrompts: data.renewalPrompts.filter((renewal) => renewal.advertiserId === advertiser.id && !renewal.deletedAt),
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

function ensureContextCanAccessAdvertiser(context: AdvertisingActorContext, advertiser: AdvertiserRecord, data: AdvertisingData) {
  if (context.territoryId && context.territoryId !== advertiser.owningTerritoryId) {
    throw new Error("Advertiser is outside the active territory.");
  }
  // A user acting from an advertiser organisation (the portal) can only ever reach their own
  // advertiser: the territory check above cannot restrict them, because they have no territory.
  const actingOrganisation = context.organisationId ? data.organisations.find((organisation) => organisation.id === context.organisationId) : undefined;
  if (actingOrganisation?.kind === "advertiser" && actingOrganisation.id !== advertiser.advertiserOrganisationId) {
    throw new Error("Advertiser is outside your organisation.");
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

function requireBookingItem(data: AdvertisingData, bookingItemId: string) {
  const bookingItem = data.bookingItems.find((candidate) => candidate.id === bookingItemId && !candidate.deletedAt);
  if (!bookingItem) {
    throw new Error("Booking item was not found.");
  }
  return bookingItem;
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

function requireCampaignFulfilment(data: AdvertisingData, fulfilmentId: string) {
  const fulfilment = data.campaignFulfilments.find((candidate) => candidate.id === fulfilmentId && !candidate.deletedAt);
  if (!fulfilment) {
    throw new Error("Campaign fulfilment was not found.");
  }
  return fulfilment;
}

function requireProofPack(data: AdvertisingData, proofPackId: string) {
  const proofPack = data.proofPacks.find((candidate) => candidate.id === proofPackId && !candidate.deletedAt);
  if (!proofPack) {
    throw new Error("Proof pack was not found.");
  }
  return proofPack;
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

function inventorySlotForBookingItem(data: AdvertisingData, reservationId: string | null | undefined, pending: InventoryReservation[]) {
  const reservation = reservationId ? pending.find((candidate) => candidate.id === reservationId) : undefined;
  return reservation ? data.inventorySlots.find((candidate) => candidate.id === reservation.inventorySlotId) : undefined;
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

/** The rate for a tax code on a date. A code with no rate in force is an error, never a guess. */
export const ACCOUNTING_PROVIDER_TYPE = "accounting";
export const ACCOUNTING_PROVIDER_KEY = "primary";
/** After this many failed pushes a sync stops retrying on its own and waits for a person. */
export const ACCOUNTING_MAX_ATTEMPTS = 8;

/**
 * Every issued invoice and credit note must reach the accounting system. This records the intent in the same
 * transaction as the issue itself, so a crash can never leave an issued document nobody will ever push.
 * It is idempotent: one reference per document.
 */
export function queueAccountingSync(data: AdvertisingData, entityType: "advertiser_invoice" | "advertiser_credit_note", entityId: string) {
  const existing = data.providerSyncReferences.find((reference) =>
    reference.providerType === ACCOUNTING_PROVIDER_TYPE && reference.providerKey === ACCOUNTING_PROVIDER_KEY && reference.entityType === entityType && reference.entityId === entityId);
  if (existing) return existing;
  const reference = {
    id: randomUUID(),
    providerType: ACCOUNTING_PROVIDER_TYPE,
    providerKey: ACCOUNTING_PROVIDER_KEY,
    entityType,
    entityId,
    providerEntityId: null,
    status: "pending",
    lastSyncedAt: null,
    metadata: { attempts: 0 }
  };
  data.providerSyncReferences.push(reference);
  return reference;
}

/**
 * Records what the accounting provider answered. The durable job is the only caller and it audits as an
 * automation. A synced reference is final and is never moved back; a failure retries until the limit and then
 * waits for a person.
 */
export function applyAccountingSyncResult(
  data: AdvertisingData,
  referenceId: string,
  result: { status: "synced" | "failed"; providerEntityId?: string | null; error?: string; nextAttemptAt?: string; today: string }
) {
  const reference = data.providerSyncReferences.find((candidate) => candidate.id === referenceId && candidate.providerType === ACCOUNTING_PROVIDER_TYPE);
  if (!reference) throw new Error("Accounting sync reference was not found.");
  if (reference.status === "synced") return reference;
  const attempts = Number(reference.metadata.attempts ?? 0) + 1;
  if (result.status === "synced") {
    reference.status = "synced";
    reference.providerEntityId = result.providerEntityId ?? null;
    reference.lastSyncedAt = result.today;
    reference.metadata = { attempts };
  } else {
    reference.status = attempts >= ACCOUNTING_MAX_ATTEMPTS ? "failed" : "pending";
    reference.metadata = { attempts, lastError: (result.error ?? "Unknown error").slice(0, 300), nextAttemptAt: result.nextAttemptAt ?? null };
  }
  return reference;
}

/** Sets a rate from a date, closing the rate it replaces the day before so exactly one rate is ever in force. */
export async function setTaxRate(
  context: AdvertisingActorContext,
  permissions: PermissionData,
  audit: AdvertisingAuditRecorder,
  data: AdvertisingData,
  input: { id: string; code: string; description: string; rateBps: number; effectiveFrom: string }
) {
  requireAdvertisingPermission(context, permissions, "taxRateManage");
  const code = input.code.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(code)) throw new Error("A tax code is lower-case letters, numbers and underscores.");
  if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 10000) throw new Error("A tax rate must be between 0% and 100%.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new Error("Give the date the rate starts as YYYY-MM-DD.");
  const history = data.taxRates.filter((rate) => rate.code === code);
  const latest = history.sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
  if (latest && input.effectiveFrom <= latest.effectiveFrom) {
    throw new Error("A new rate must start after the rate it replaces. Rates already in force are never rewritten.");
  }
  if (latest && !latest.effectiveTo) {
    const day = new Date(`${input.effectiveFrom}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 1);
    latest.effectiveTo = day.toISOString().slice(0, 10);
  }
  const rate = { id: input.id, code, description: input.description.trim(), rateBps: input.rateBps, effectiveFrom: input.effectiveFrom, effectiveTo: null };
  data.taxRates.push(rate);
  await audit.record({
    action: auditActions.advertiserTaxRateSet,
    actorUserId: context.userId,
    entityType: "advertiser_tax_rate",
    entityId: rate.id,
    organisationId: context.organisationId,
    payload: { code, rateBps: rate.rateBps, effectiveFrom: rate.effectiveFrom }
  });
  return rate;
}

export function taxRateFor(data: AdvertisingData, taxCode: string, onDate: string) {
  const rate = data.taxRates
    .filter((candidate) => candidate.code === taxCode && candidate.effectiveFrom <= onDate && (!candidate.effectiveTo || candidate.effectiveTo >= onDate))
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
  if (!rate) {
    throw new Error(`No tax rate is configured for "${taxCode}".`);
  }
  return rate.rateBps;
}

function invoiceLineFromBookingItem(invoiceId: string, id: string, item: CommercialBookingItem, taxCode: string, taxRateBps: number): AdvertiserInvoiceLine {
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
    taxCode
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

function proofSnapshot(data: AdvertisingData, fulfilment: CampaignFulfilment) {
  const booking = requireBooking(data, fulfilment.bookingId);
  const bookingItem = requireBookingItem(data, fulfilment.bookingItemId);
  const artworkRequirement = fulfilment.artworkRequirementId
    ? requireArtworkRequirement(data, fulfilment.artworkRequirementId)
    : null;
  const approvedArtworkVersion = artworkRequirement?.approvedVersionId
    ? data.artworkVersions.find((version) => version.id === artworkRequirement.approvedVersionId && !version.deletedAt)
    : null;
  return {
    booking: {
      id: booking.id,
      bookedOn: booking.bookedOn,
      totalValueMinor: booking.totalValueMinor,
      currency: booking.currency
    },
    bookingItem: {
      id: bookingItem.id,
      productId: bookingItem.productId,
      description: bookingItem.description,
      totalPriceMinor: bookingItem.totalPriceMinor
    },
    fulfilment: {
      id: fulfilment.id,
      status: fulfilment.status,
      channel: fulfilment.channel,
      scheduledOn: fulfilment.scheduledOn,
      fulfilledOn: fulfilment.fulfilledOn,
      placementReference: fulfilment.placementReference
    },
    artwork: artworkRequirement
      ? {
          requirementId: artworkRequirement.id,
          approvedVersionId: artworkRequirement.approvedVersionId ?? null,
          assetReference: approvedArtworkVersion?.assetReference ?? null
        }
      : null
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

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentage(value: number, total: number) {
  if (total === 0) {
    return 0;
  }
  return Math.round((value / total) * 100);
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
  if (opportunity.expectedCloseDate && opportunity.expectedCloseDate <= daysFromToday(7)) {
    return "closing_soon";
  }
  if (!opportunity.nextActionDate) {
    return "stale";
  }
  return "normal";
}

/** Today's date from the clock. Tests pin the clock with fake timers rather than the code carrying a fixed date. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysFromToday(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
