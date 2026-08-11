import { auditActions } from "@raring2go/audit";
import { describe, expect, it } from "vitest";
import {
  addAdvertiserContact,
  acceptProposalCommercially,
  acceptProposalAsBooking,
  changeOpportunityStage,
  createAdvertiser,
  createOpportunity,
  createProposal,
  getAdvertiser360,
  listCatalogue,
  listAdvertisers,
  listPipeline,
  recordAdvertiserActivity,
  reserveInventorySlot,
  respondToProposal,
  updateAdvertiser
} from "./service";
import type { AdvertisingData } from "./types";
import type { PermissionData } from "@raring2go/permissions";

const ids = {
  users: {
    hq: "user_hq",
    local: "user_local"
  },
  organisations: {
    hq: "org_hq",
    advertiser: "org_advertiser",
    otherAdvertiser: "org_other_advertiser",
    franchise: "org_franchise",
    otherFranchise: "org_other_franchise"
  },
  territories: {
    own: "territory_own",
    other: "territory_other"
  },
  roles: {
    hq: "role_hq",
    local: "role_local"
  },
  advertiser: "advertiser_own",
  otherAdvertiser: "advertiser_other",
  contact: "contact_primary",
  activity: "activity_note",
  metric: "metric_2026",
  stages: {
    lead: "stage_lead",
    qualified: "stage_qualified",
    won: "stage_won",
    lost: "stage_lost"
  },
  opportunity: "opportunity_renewal",
  product: "product_full_page",
  slot: "slot_cover",
  reservation: "reservation_cover"
} as const;

const permissions: PermissionData = {
  roleAssignments: [
    {
      id: "assignment_hq",
      userId: ids.users.hq,
      roleId: ids.roles.hq,
      organisationId: ids.organisations.hq
    },
    {
      id: "assignment_local",
      userId: ids.users.local,
      roleId: ids.roles.local,
      organisationId: ids.organisations.franchise,
      territoryId: ids.territories.own
    }
  ],
  rolePermissions: [
    grant(ids.roles.hq, "advertiser", "view", "network"),
    grant(ids.roles.hq, "advertiser", "create", "network"),
    grant(ids.roles.hq, "advertiser", "edit", "network"),
    grant(ids.roles.hq, "advertiser.contact", "manage", "network"),
    grant(ids.roles.hq, "advertiser.activity", "record", "network"),
    grant(ids.roles.hq, "advertiser.opportunity", "view", "network"),
    grant(ids.roles.hq, "advertiser.opportunity", "create", "network"),
    grant(ids.roles.hq, "advertiser.opportunity", "edit", "network"),
    grant(ids.roles.hq, "advertiser.catalogue", "view", "network"),
    grant(ids.roles.hq, "advertiser.inventory", "reserve", "network"),
    grant(ids.roles.hq, "advertiser.proposal", "view", "network"),
    grant(ids.roles.hq, "advertiser.proposal", "create", "network"),
    grant(ids.roles.hq, "advertiser.booking", "accept", "network"),
    grant(ids.roles.hq, "advertiser.proposal", "accept", "network"),
    grant(ids.roles.hq, "advertiser.proposal", "respond", "network"),
    grant(ids.roles.local, "advertiser", "view", "own_territory"),
    grant(ids.roles.local, "advertiser", "create", "own_territory"),
    grant(ids.roles.local, "advertiser", "edit", "own_territory"),
    grant(ids.roles.local, "advertiser.contact", "manage", "own_territory"),
    grant(ids.roles.local, "advertiser.activity", "record", "own_territory"),
    grant(ids.roles.local, "advertiser.opportunity", "view", "own_territory"),
    grant(ids.roles.local, "advertiser.opportunity", "create", "own_territory"),
    grant(ids.roles.local, "advertiser.opportunity", "edit", "own_territory"),
    grant(ids.roles.local, "advertiser.catalogue", "view", "own_territory"),
    grant(ids.roles.local, "advertiser.inventory", "reserve", "own_territory"),
    grant(ids.roles.local, "advertiser.proposal", "view", "own_territory"),
    grant(ids.roles.local, "advertiser.proposal", "create", "own_territory"),
    grant(ids.roles.local, "advertiser.booking", "accept", "own_territory"),
    grant(ids.roles.local, "advertiser.proposal", "accept", "own_territory"),
    grant(ids.roles.local, "advertiser.proposal", "respond", "own_territory")
  ],
  territories: [
    {
      id: ids.territories.own,
      franchiseOrganisationId: ids.organisations.franchise
    },
    {
      id: ids.territories.other,
      franchiseOrganisationId: ids.organisations.otherFranchise
    }
  ]
};

describe("advertiser CRM foundation", () => {
  it("lists advertiser records with organisation, contacts, activity and metrics", () => {
    const view = getAdvertiser360(localContext(), permissions, seededData(), ids.advertiser);

    expect(view).toMatchObject({
      advertiser: {
        id: ids.advertiser,
        relationshipState: "retained",
        averageSaleValueMinor: 42500,
        annualAdvertiserValueMinor: 170000
      },
      organisation: {
        name: "Example Advertiser"
      },
      contacts: [{ id: ids.contact, isPrimary: true }],
      latestMetrics: {
        periodKey: "2026",
        conversionState: "retained",
        churnRisk: "low",
        overdueDebtMinor: 0
      }
    });
    expect(view.opportunities).toHaveLength(1);
    expect(view.opportunities[0]).toMatchObject({
      weightedValueMinor: 18375,
      attention: "overdue_follow_up"
    });
  });

  it("filters local users to their own territory and rejects cross-territory URL access", () => {
    const data = seededData();

    expect(listAdvertisers(localContext(), permissions, data).map((view) => view.advertiser.id)).toEqual([
      ids.advertiser
    ]);
    expect(() => getAdvertiser360(localContext(), permissions, data, ids.otherAdvertiser)).toThrow("outside the active territory");
  });

  it("creates advertiser records without duplicating organisation identity", async () => {
    const data = emptyData();
    const recorder = audit();

    const created = await createAdvertiser(hqContext(), permissions, recorder, data, advertiser());

    expect(created).toMatchObject({
      advertiserOrganisationId: ids.organisations.advertiser,
      owningTerritoryId: ids.territories.own
    });
    expect(recorder.events.map((event) => event.action)).toEqual([auditActions.advertiserCreate]);
    await expect(createAdvertiser(hqContext(), permissions, audit(), data, { ...advertiser(), id: "duplicate" })).rejects.toThrow("already has");
  });

  it("updates state and records activity with audit events", async () => {
    const data = seededData();
    const recorder = audit();

    await updateAdvertiser(localContext(), permissions, recorder, data, ids.advertiser, {
      relationshipState: "at_risk",
      tags: ["renewal-needed"]
    });
    await recordAdvertiserActivity(localContext(), permissions, recorder, data, {
      id: "activity_follow_up",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      actorUserId: ids.users.local,
      activityType: "note",
      title: "Renewal call booked",
      body: "Follow up next week.",
      metadata: { channel: "phone" }
    });

    expect(data.advertisers[0]).toMatchObject({
      relationshipState: "at_risk",
      tags: ["renewal-needed"]
    });
    expect(data.activityEvents).toHaveLength(2);
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.advertiserUpdate,
      auditActions.advertiserActivityRecord
    ]);
  });

  it("prevents linked platform user contacts from duplicating identity fields", async () => {
    const data = seededData();

    await expect(
      addAdvertiserContact(localContext(), permissions, audit(), data, {
        id: "linked_contact",
        advertiserId: ids.advertiser,
        userId: ids.users.local,
        label: "Platform user",
        name: "Duplicate Name",
        role: "contact",
        isPrimary: false
      })
    ).rejects.toThrow("should not duplicate");
  });

  it("builds territory pipeline views and attention queues", () => {
    const pipeline = listPipeline(localContext(), permissions, seededData());

    expect(pipeline.stages.map((stage) => stage.stage.key)).toEqual(["lead", "qualified", "won", "lost"]);
    expect(pipeline.stages.find((stage) => stage.stage.key === "qualified")?.opportunities).toHaveLength(1);
    expect(pipeline.overdueFollowUps.map((view) => view.opportunity.id)).toEqual([ids.opportunity]);
    expect(pipeline.myPipeline.map((view) => view.opportunity.id)).toEqual([ids.opportunity]);
  });

  it("creates opportunities and audits stage changes", async () => {
    const data = seededData();
    const recorder = audit();
    const opportunity = await createOpportunity(localContext(), permissions, recorder, data, {
      ...baseOpportunity(),
      id: "opportunity_new",
      stageId: ids.stages.lead,
      probability: 0,
      estimatedValueMinor: 30000
    });
    await changeOpportunityStage(localContext(), permissions, recorder, data, opportunity.id, {
      stageId: ids.stages.won
    });

    expect(opportunity).toMatchObject({
      stageId: ids.stages.won,
      probability: 100,
      closedAt: "2026-08-11"
    });
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.advertiserOpportunityCreate,
      auditActions.advertiserOpportunityStageChange
    ]);
  });

  it("lists configurable catalogue and blocks double booking exclusive inventory", async () => {
    const data = seededData();
    const recorder = audit();

    expect(listCatalogue(localContext(), permissions, data).products.map((product) => product.key)).toEqual([
      "full-page-ad"
    ]);
    await reserveInventorySlot(localContext(), permissions, recorder, data, {
      id: ids.reservation,
      inventorySlotId: ids.slot,
      advertiserId: ids.advertiser,
      opportunityId: ids.opportunity,
      status: "reserved",
      metadata: {}
    });
    await expect(
      reserveInventorySlot(localContext(), permissions, audit(), data, {
        id: "reservation_duplicate",
        inventorySlotId: ids.slot,
        advertiserId: ids.advertiser,
        opportunityId: ids.opportunity,
        status: "reserved",
        metadata: {}
      })
    ).rejects.toThrow("already reserved");
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.advertiserInventoryReserve
    ]);
  });

  it("creates proposals and accepts them into inventory-backed bookings exactly once", async () => {
    const data = seededData();
    const recorder = audit();
    const proposal = await createProposal(localContext(), permissions, recorder, data, {
      id: "proposal_autumn",
      advertiserId: ids.advertiser,
      opportunityId: ids.opportunity,
      territoryId: ids.territories.own,
      status: "sent",
      version: 1,
      title: "Autumn proposal",
      totalValueMinor: 0,
      currency: "GBP",
      validUntil: "2026-08-31",
      sentOn: "2026-08-11",
      acceptedOn: null,
      metadata: {}
    }, [
      {
        id: "proposal_item_autumn",
        proposalId: "proposal_autumn",
        productId: ids.product,
        inventorySlotId: ids.slot,
        description: "Full page advert",
        quantity: 1,
        unitPriceMinor: 52500,
        totalPriceMinor: 52500,
        currency: "GBP",
        metadata: {}
      }
    ]);

    const booking = await acceptProposalAsBooking(localContext(), permissions, recorder, data, {
      proposalId: proposal.id,
      bookingId: "booking_autumn",
      bookingItemIdPrefix: "booking_item_autumn",
      reservationIdPrefix: "reservation_autumn",
      productionRequestIdPrefix: "production_autumn",
      acceptedOn: "2026-08-11"
    });
    const duplicate = await acceptProposalAsBooking(localContext(), permissions, recorder, data, {
      proposalId: proposal.id,
      bookingId: "booking_duplicate",
      bookingItemIdPrefix: "booking_item_duplicate",
      reservationIdPrefix: "reservation_duplicate",
      productionRequestIdPrefix: "production_duplicate",
      acceptedOn: "2026-08-11"
    });

    expect(duplicate).toBe(booking);
    expect(data.bookings).toHaveLength(1);
    expect(data.inventoryReservations).toHaveLength(1);
    expect(data.productionRequests).toHaveLength(1);
    expect(data.inventorySlots[0]?.status).toBe("reserved");
    expect(getAdvertiser360(localContext(), permissions, data, ids.advertiser).bookings).toHaveLength(1);
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.advertiserProposalCreate,
      auditActions.advertiserProposalAccept,
      auditActions.advertiserBookingCreate
    ]);
  });

  it("records simple commercial acceptance with immutable snapshot, events and idempotent booking confirmation", async () => {
    const data = seededData();
    seedProposal(data);
    const recorder = audit();
    const acceptance = await acceptProposalCommercially(localContext(), permissions, recorder, data, {
      acceptanceId: "acceptance_autumn",
      proposalId: "proposal_autumn",
      termsId: "terms_standard",
      acceptedByContactId: ids.contact,
      acceptedAt: "2026-08-11",
      idempotencyKey: "acceptance:proposal_autumn",
      requestMetadata: { ip: "127.0.0.1", userAgent: "vitest" },
      bookingId: "booking_autumn",
      bookingItemIdPrefix: "booking_item_autumn",
      reservationIdPrefix: "reservation_autumn",
      productionRequestIdPrefix: "production_autumn",
      domainEventId: "event_acceptance"
    });
    const duplicate = await acceptProposalCommercially(localContext(), permissions, recorder, data, {
      acceptanceId: "acceptance_duplicate",
      proposalId: "proposal_autumn",
      termsId: "terms_standard",
      acceptedByContactId: ids.contact,
      acceptedAt: "2026-08-11",
      idempotencyKey: "acceptance:proposal_autumn",
      requestMetadata: {},
      bookingId: "booking_duplicate",
      bookingItemIdPrefix: "booking_item_duplicate",
      reservationIdPrefix: "reservation_duplicate",
      productionRequestIdPrefix: "production_duplicate",
      domainEventId: "event_duplicate"
    });

    data.proposals[0]!.totalValueMinor = 1;

    expect(duplicate).toBe(acceptance);
    expect(acceptance).toMatchObject({
      status: "accepted",
      method: "simple",
      bookingId: "booking_autumn"
    });
    expect(acceptance.commercialSnapshot).toMatchObject({
      proposal: { totalValueMinor: 52500 },
      terms: { version: "2026.1" }
    });
    expect(data.bookings).toHaveLength(1);
    expect(data.domainEvents.map((event) => event.eventType)).toEqual([
      "advertiser.proposal.accepted",
      "advertiser.booking.confirmed"
    ]);
    expect(getAdvertiser360(localContext(), permissions, data, ids.advertiser).acceptances).toHaveLength(1);
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.advertiserProposalAccept,
      auditActions.advertiserBookingCreate,
      auditActions.advertiserProposalAccept,
      auditActions.advertiserBookingConfirm
    ]);
  });

  it("rejects expired, superseded, cross-territory and cross-advertiser acceptance attempts", async () => {
    const expired = seededData();
    seedProposal(expired, { validUntil: "2026-08-01" });
    await expect(simpleAcceptance(expired)).rejects.toThrow("Expired proposals");

    const superseded = seededData();
    seedProposal(superseded, { metadata: { current: false, supersededBy: "proposal_v2" } });
    await expect(simpleAcceptance(superseded)).rejects.toThrow("Superseded proposal");

    const otherTerritory = seededData();
    seedProposal(otherTerritory);
    await expect(simpleAcceptance(otherTerritory, {
      context: {
        userId: ids.users.local,
        organisationId: ids.organisations.otherFranchise,
        territoryId: ids.territories.other
      }
    })).rejects.toThrow();

    const wrongContact = seededData();
    seedProposal(wrongContact);
    wrongContact.contacts[0]!.advertiserId = ids.otherAdvertiser;
    await expect(simpleAcceptance(wrongContact)).rejects.toThrow("contact must belong");
  });

  it("records rejection and change-request responses without confirming a booking", async () => {
    const rejected = seededData();
    seedProposal(rejected);
    const recorder = audit();
    const response = await respondToProposal(localContext(), permissions, recorder, rejected, {
      acceptanceId: "response_rejected",
      proposalId: "proposal_autumn",
      termsId: "terms_standard",
      acceptedByContactId: ids.contact,
      response: "rejected",
      respondedAt: "2026-08-11",
      idempotencyKey: "response:rejected",
      requestMetadata: {},
      domainEventId: "event_rejected"
    });

    expect(response.status).toBe("rejected");
    expect(rejected.bookings).toHaveLength(0);
    expect(rejected.domainEvents[0]?.eventType).toBe("advertiser.proposal.rejected");

    const change = seededData();
    seedProposal(change);
    const changeResponse = await respondToProposal(localContext(), permissions, audit(), change, {
      acceptanceId: "response_change",
      proposalId: "proposal_autumn",
      termsId: "terms_standard",
      acceptedByContactId: ids.contact,
      response: "change_requested",
      respondedAt: "2026-08-11",
      idempotencyKey: "response:change",
      requestMetadata: {},
      domainEventId: "event_change"
    });
    expect(changeResponse.status).toBe("change_requested");
    expect(change.domainEvents[0]?.eventType).toBe("advertiser.proposal.change_requested");
  });

  it("keeps signature-required acceptance provider-neutral and pending", async () => {
    const data = seededData();
    seedProposal(data);
    const acceptance = await acceptProposalCommercially(localContext(), permissions, audit(), data, {
      acceptanceId: "acceptance_signature",
      proposalId: "proposal_autumn",
      termsId: "terms_standard",
      acceptedByContactId: ids.contact,
      acceptedAt: "2026-08-11",
      idempotencyKey: "acceptance:signature",
      requestMetadata: {},
      bookingId: "booking_signature",
      bookingItemIdPrefix: "booking_item_signature",
      reservationIdPrefix: "reservation_signature",
      productionRequestIdPrefix: "production_signature",
      method: "signature_required",
      providerMetadata: { providerKey: "test-provider" },
      domainEventId: "event_signature"
    });

    expect(acceptance).toMatchObject({
      status: "pending_signature",
      acceptedAt: null,
      bookingId: null
    });
    expect(data.bookings).toHaveLength(0);
    expect(data.domainEvents).toHaveLength(0);
  });
});

function hqContext() {
  return {
    userId: ids.users.hq,
    organisationId: ids.organisations.hq
  };
}

function localContext() {
  return {
    userId: ids.users.local,
    organisationId: ids.organisations.franchise,
    territoryId: ids.territories.own
  };
}

function emptyData(): AdvertisingData {
  return {
    advertisers: [],
    contacts: [],
    activityEvents: [],
    metricSnapshots: [],
    pipelineStages: pipelineStages(),
    opportunities: [],
    products: [],
    packages: [],
    priceBooks: [],
    priceBookItems: [],
    inventorySlots: [],
    inventoryReservations: [],
    proposals: [],
    proposalItems: [],
    bookings: [],
    bookingItems: [],
    productionRequests: [],
    terms: [],
    acceptances: [],
    domainEvents: [],
    organisations: [
      { id: ids.organisations.hq, kind: "hq", name: "HQ" },
      { id: ids.organisations.franchise, kind: "franchise", name: "Own Franchise" },
      { id: ids.organisations.otherFranchise, kind: "franchise", name: "Other Franchise" },
      { id: ids.organisations.advertiser, kind: "advertiser", name: "Example Advertiser" },
      { id: ids.organisations.otherAdvertiser, kind: "advertiser", name: "Other Advertiser" }
    ],
    territories: [
      { id: ids.territories.own, franchiseOrganisationId: ids.organisations.franchise, name: "Own Territory" },
      { id: ids.territories.other, franchiseOrganisationId: ids.organisations.otherFranchise, name: "Other Territory" }
    ]
  };
}

function seededData() {
  const data = emptyData();
  data.advertisers.push(advertiser(), {
    ...advertiser(),
    id: ids.otherAdvertiser,
    advertiserOrganisationId: ids.organisations.otherAdvertiser,
    owningTerritoryId: ids.territories.other
  });
  data.contacts.push({
    id: ids.contact,
    advertiserId: ids.advertiser,
    label: "Primary contact",
    name: "Alex Advertiser",
    email: "alex@example.test",
    role: "owner",
    isPrimary: true
  });
  data.activityEvents.push({
    id: ids.activity,
    advertiserId: ids.advertiser,
    territoryId: ids.territories.own,
    actorUserId: ids.users.local,
    activityType: "note",
    title: "Intro note",
    metadata: {}
  });
  data.metricSnapshots.push({
    id: ids.metric,
    advertiserId: ids.advertiser,
    territoryId: ids.territories.own,
    periodKey: "2026",
    averageSaleValueMinor: 42500,
    annualAdvertiserValueMinor: 170000,
    bookingCount: 4,
    packageMix: { printDigital: 3 },
    digitalMix: { included: 3 },
    conversionState: "retained",
    churnRisk: "low",
    overdueDebtMinor: 0,
    benchmarkMetadata: {}
  });
  data.opportunities.push(baseOpportunity());
  data.products.push({
    id: ids.product,
    key: "full-page-ad",
    name: "Full page advert",
    channel: "magazine",
    status: "active",
    requiresInventory: true,
    requiresArtwork: true,
    taxCode: "standard_vat",
    metadata: {}
  });
  data.inventorySlots.push({
    id: ids.slot,
    territoryEditionId: "edition_autumn",
    editionPageId: "page_3",
    territoryId: ids.territories.own,
    productId: ids.product,
    slotKey: "autumn-page-3-full",
    inventoryClass: "full_page",
    exclusive: true,
    status: "available",
    metadata: {}
  });
  data.terms.push({
    id: "terms_standard",
    key: "standard-advertiser-terms",
    version: "2026.1",
    status: "approved",
    title: "Standard terms",
    contentHash: "sha256:terms",
    contentSnapshot: { cancellation: "standard" },
    approvedAt: "2026-01-01"
  });
  return data;
}

function seedProposal(data: AdvertisingData, patch: Partial<AdvertisingData["proposals"][number]> = {}) {
  data.proposals.push({
    id: "proposal_autumn",
    advertiserId: ids.advertiser,
    opportunityId: ids.opportunity,
    territoryId: ids.territories.own,
    status: "sent",
    version: 1,
    title: "Autumn proposal",
    totalValueMinor: 52500,
    currency: "GBP",
    validUntil: "2026-08-31",
    sentOn: "2026-08-11",
    acceptedOn: null,
    metadata: { current: true },
    ...patch
  });
  data.proposalItems.push({
    id: "proposal_item_autumn",
    proposalId: "proposal_autumn",
    productId: ids.product,
    inventorySlotId: ids.slot,
    description: "Full page advert",
    quantity: 1,
    unitPriceMinor: 52500,
    totalPriceMinor: 52500,
    currency: "GBP",
    metadata: {}
  });
}

function simpleAcceptance(
  data: AdvertisingData,
  options: {
    context?: { userId: string; organisationId: string; territoryId: string };
  } = {}
) {
  return acceptProposalCommercially(options.context ?? localContext(), permissions, audit(), data, {
    acceptanceId: "acceptance_autumn",
    proposalId: "proposal_autumn",
    termsId: "terms_standard",
    acceptedByContactId: ids.contact,
    acceptedAt: "2026-08-11",
    idempotencyKey: "acceptance:proposal_autumn",
    requestMetadata: {},
    bookingId: "booking_autumn",
    bookingItemIdPrefix: "booking_item_autumn",
    reservationIdPrefix: "reservation_autumn",
    productionRequestIdPrefix: "production_autumn",
    domainEventId: "event_acceptance"
  });
}

function pipelineStages() {
  return [
    { id: ids.stages.lead, key: "lead", name: "Lead", sortOrder: 1, probabilityDefault: 10, isClosed: false, outcome: null },
    { id: ids.stages.qualified, key: "qualified", name: "Qualified", sortOrder: 2, probabilityDefault: 35, isClosed: false, outcome: null },
    { id: ids.stages.won, key: "won", name: "Won", sortOrder: 3, probabilityDefault: 100, isClosed: true, outcome: "won" },
    { id: ids.stages.lost, key: "lost", name: "Lost", sortOrder: 4, probabilityDefault: 0, isClosed: true, outcome: "lost" }
  ];
}

function baseOpportunity() {
  return {
    id: ids.opportunity,
    advertiserId: ids.advertiser,
    territoryId: ids.territories.own,
    ownerUserId: ids.users.local,
    stageId: ids.stages.qualified,
    source: "renewal",
    title: "Autumn renewal",
    estimatedValueMinor: 52500,
    currency: "GBP",
    probability: 35,
    expectedCloseDate: "2026-08-18",
    nextAction: "Confirm package",
    nextActionDate: "2026-08-10",
    notes: "Seed opportunity",
    lostReason: null,
    competitor: null,
    closedAt: null,
    createdByUserId: ids.users.local
  };
}

function advertiser() {
  return {
    id: ids.advertiser,
    advertiserOrganisationId: ids.organisations.advertiser,
    owningTerritoryId: ids.territories.own,
    accountOwnerUserId: ids.users.local,
    status: "active",
    relationshipState: "retained",
    source: "seed",
    firstBookedOn: "2025-09-01",
    lastBookedOn: "2026-06-01",
    lapsedOn: null,
    averageSaleValueMinor: 42500,
    annualAdvertiserValueMinor: 170000,
    currency: "GBP",
    tags: ["family-days-out"],
    commercialMetadata: {}
  };
}

function grant(roleId: string, module: string, action: string, scope: string) {
  return {
    roleId,
    permission: {
      id: `${module}:${action}`,
      module,
      action
    },
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
