import { auditActions } from "@raring2go/audit";
import { describe, expect, it } from "vitest";
import {
  addAdvertiserContact,
  acceptProposalCommercially,
  acceptProposalAsBooking,
  allocatePayment,
  changeOpportunityStage,
  createAdvertiser,
  createInvoiceFromBooking,
  createOpportunity,
  createProposal,
  editDraftInvoice,
  getAdvertiser360,
  issueCreditNote,
  issueInvoice,
  listCatalogue,
  listAdvertisers,
  listPipeline,
  recordAdvertiserActivity,
  recordPayment,
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
    grant(ids.roles.hq, "advertiser.finance", "view", "network"),
    grant(ids.roles.hq, "advertiser.invoice", "create", "network"),
    grant(ids.roles.hq, "advertiser.invoice", "edit_draft", "network"),
    grant(ids.roles.hq, "advertiser.invoice", "issue", "network"),
    grant(ids.roles.hq, "advertiser.credit", "create", "network"),
    grant(ids.roles.hq, "advertiser.payment", "record", "network"),
    grant(ids.roles.hq, "advertiser.payment", "allocate", "network"),
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
    grant(ids.roles.local, "advertiser.proposal", "respond", "own_territory"),
    grant(ids.roles.local, "advertiser.finance", "view", "own_territory"),
    grant(ids.roles.local, "advertiser.invoice", "create", "own_territory"),
    grant(ids.roles.local, "advertiser.invoice", "edit_draft", "own_territory"),
    grant(ids.roles.local, "advertiser.invoice", "issue", "own_territory"),
    grant(ids.roles.local, "advertiser.credit", "create", "own_territory"),
    grant(ids.roles.local, "advertiser.payment", "record", "own_territory"),
    grant(ids.roles.local, "advertiser.payment", "allocate", "own_territory")
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

  it("issues invoices from confirmed bookings with immutable numbering and tax snapshots", async () => {
    const data = seededData();
    seedAcceptedBooking(data);
    const recorder = audit();
    const invoice = await createInvoiceFromBooking(localContext(), permissions, recorder, data, {
      invoiceId: "invoice_1",
      lineIdPrefix: "invoice_line_1",
      bookingId: "booking_autumn",
      issuerOrganisationId: ids.organisations.franchise,
      dueDate: "2026-09-10",
      billingSnapshot: { customer: "Example Advertiser" },
      paymentTermsSnapshot: { days: 30 },
      taxRateBps: 2000,
      domainEventId: "event_invoice_created"
    });
    const issued = await issueInvoice(localContext(), permissions, recorder, data, {
      invoiceId: invoice.id,
      issuedOn: "2026-08-11",
      domainEventId: "event_invoice_issued"
    });

    data.products[0]!.taxCode = "changed_later";
    await expect(editDraftInvoice(localContext(), permissions, data, issued.id, {
      dueDate: "2026-10-10"
    })).rejects.toThrow("Issued invoices cannot");

    expect(issued).toMatchObject({
      invoiceNumber: "R2G-00001",
      status: "issued",
      subtotalMinor: 52500,
      taxMinor: 10500,
      totalMinor: 63000,
      balanceMinor: 63000
    });
    expect(data.invoiceSequences[0]?.nextNumber).toBe(2);
    expect(issued.issuedSnapshot).toMatchObject({
      invoice: {
        invoiceNumber: "R2G-00001",
        totalMinor: 63000
      },
      lines: [{ taxCode: "standard_vat", taxRateBps: 2000 }]
    });
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.advertiserInvoiceCreate,
      auditActions.advertiserInvoiceIssue
    ]);
  });

  it("records duplicate provider payments idempotently and allocates partial payments", async () => {
    const data = seededData();
    seedIssuedInvoice(data);
    const recorder = audit();
    const payment = await recordPayment(localContext(), permissions, recorder, data, {
      id: "payment_1",
      issuerOrganisationId: ids.organisations.franchise,
      advertiserId: ids.advertiser,
      payerOrganisationId: ids.organisations.advertiser,
      amountMinor: 70000,
      allocatedMinor: 0,
      unallocatedMinor: 70000,
      currency: "GBP",
      receivedDate: "2026-08-12",
      method: "bank_transfer",
      providerKey: "bank-import",
      externalReference: "BANK-1",
      providerEventId: "event-1",
      status: "received",
      metadata: {}
    }, "event_payment_received");
    const duplicate = await recordPayment(localContext(), permissions, recorder, data, {
      ...payment,
      id: "payment_duplicate"
    }, "event_payment_duplicate");
    await allocatePayment(localContext(), permissions, recorder, data, {
      id: "allocation_1",
      paymentId: payment.id,
      invoiceId: "invoice_1",
      amountMinor: 30000,
      allocatedAt: "2026-08-12",
      status: "allocated",
      metadata: {}
    }, "event_payment_allocated");

    expect(duplicate).toBe(payment);
    expect(data.payments).toHaveLength(1);
    expect(data.payments[0]).toMatchObject({ allocatedMinor: 30000, unallocatedMinor: 40000 });
    expect(data.invoices[0]).toMatchObject({ status: "part_paid", amountPaidMinor: 30000, balanceMinor: 33000 });
    await expect(allocatePayment(localContext(), permissions, audit(), data, {
      id: "allocation_too_much",
      paymentId: payment.id,
      invoiceId: "invoice_1",
      amountMinor: 40000,
      allocatedAt: "2026-08-12",
      status: "allocated",
      metadata: {}
    }, "event_too_much")).rejects.toThrow("cannot exceed");
  });

  it("settles invoices and applies credit notes without rewriting invoice totals", async () => {
    const data = seededData();
    seedIssuedInvoice(data);
    const recorder = audit();
    const payment = await recordPayment(localContext(), permissions, recorder, data, {
      id: "payment_1",
      issuerOrganisationId: ids.organisations.franchise,
      advertiserId: ids.advertiser,
      payerOrganisationId: ids.organisations.advertiser,
      amountMinor: 63000,
      allocatedMinor: 0,
      unallocatedMinor: 63000,
      currency: "GBP",
      receivedDate: "2026-08-12",
      method: "card",
      providerKey: null,
      externalReference: "manual",
      providerEventId: null,
      status: "received",
      metadata: {}
    }, "event_payment_received");
    await allocatePayment(localContext(), permissions, recorder, data, {
      id: "allocation_1",
      paymentId: payment.id,
      invoiceId: "invoice_1",
      amountMinor: 63000,
      allocatedAt: "2026-08-12",
      status: "allocated",
      metadata: {}
    }, "event_payment_allocated");
    expect(data.invoices[0]).toMatchObject({ status: "paid", balanceMinor: 0 });

    const creditData = seededData();
    seedIssuedInvoice(creditData);
    await issueCreditNote(localContext(), permissions, audit(), creditData, {
      creditNote: {
        id: "credit_1",
        invoiceId: "invoice_1",
        issuerOrganisationId: ids.organisations.franchise,
        creditNoteNumber: "CR-00001",
        reason: "Goodwill adjustment",
        issuedByUserId: ids.users.local,
        issuedDate: "2026-08-12",
        currency: "GBP",
        subtotalMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
        snapshot: {}
      },
      lines: [{
        id: "credit_line_1",
        creditNoteId: "credit_1",
        invoiceLineId: "invoice_line_1",
        description: "Adjustment",
        netMinor: 10000,
        taxRateBps: 2000,
        taxMinor: 2000,
        grossMinor: 12000,
        taxCode: "standard_vat"
      }],
      domainEventId: "event_credit"
    });
    expect(creditData.invoices[0]).toMatchObject({ totalMinor: 63000, balanceMinor: 51000 });
  });

  it("denies cross-territory finance access", async () => {
    const data = seededData();
    seedIssuedInvoice(data);
    await expect(recordPayment({
      userId: ids.users.local,
      organisationId: ids.organisations.otherFranchise,
      territoryId: ids.territories.other
    }, permissions, audit(), data, {
      id: "payment_cross",
      issuerOrganisationId: ids.organisations.franchise,
      advertiserId: ids.advertiser,
      payerOrganisationId: ids.organisations.advertiser,
      amountMinor: 100,
      allocatedMinor: 0,
      unallocatedMinor: 100,
      currency: "GBP",
      receivedDate: "2026-08-12",
      method: "bank",
      status: "received",
      metadata: {}
    }, "event_cross")).rejects.toThrow();
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
    invoiceSequences: [],
    invoices: [],
    invoiceLines: [],
    creditNotes: [],
    creditNoteLines: [],
    payments: [],
    paymentAllocations: [],
    providerSyncReferences: [],
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

function seedAcceptedBooking(data: AdvertisingData) {
  data.bookings.push({
    id: "booking_autumn",
    proposalId: "proposal_autumn",
    advertiserId: ids.advertiser,
    opportunityId: ids.opportunity,
    territoryId: ids.territories.own,
    status: "booked",
    bookedOn: "2026-08-11",
    totalValueMinor: 52500,
    currency: "GBP",
    metadata: {}
  });
  data.bookingItems.push({
    id: "booking_item_autumn_1",
    bookingId: "booking_autumn",
    proposalItemId: "proposal_item_autumn",
    productId: ids.product,
    inventoryReservationId: null,
    description: "Full page advert",
    quantity: 1,
    totalPriceMinor: 52500,
    currency: "GBP",
    metadata: {}
  });
  data.invoiceSequences.push({
    id: "sequence_franchise",
    issuerOrganisationId: ids.organisations.franchise,
    key: "default",
    prefix: "R2G",
    nextNumber: 1,
    padding: 5
  });
}

function seedIssuedInvoice(data: AdvertisingData) {
  data.invoiceSequences.push({
    id: "sequence_franchise",
    issuerOrganisationId: ids.organisations.franchise,
    key: "default",
    prefix: "R2G",
    nextNumber: 2,
    padding: 5
  });
  data.invoices.push({
    id: "invoice_1",
    issuerOrganisationId: ids.organisations.franchise,
    advertiserId: ids.advertiser,
    customerOrganisationId: ids.organisations.advertiser,
    territoryId: ids.territories.own,
    bookingId: "booking_autumn",
    invoiceNumber: "R2G-00001",
    status: "issued",
    issueDate: "2026-08-11",
    dueDate: "2026-09-10",
    voidedAt: null,
    currency: "GBP",
    subtotalMinor: 52500,
    taxMinor: 10500,
    totalMinor: 63000,
    amountPaidMinor: 0,
    balanceMinor: 63000,
    billingSnapshot: { customer: "Example Advertiser" },
    paymentTermsSnapshot: { days: 30 },
    issuedSnapshot: { invoice: { invoiceNumber: "R2G-00001" } }
  });
  data.invoiceLines.push({
    id: "invoice_line_1",
    invoiceId: "invoice_1",
    bookingItemId: "booking_item_autumn_1",
    productId: ids.product,
    description: "Full page advert",
    quantity: 1,
    netMinor: 52500,
    taxRateBps: 2000,
    taxMinor: 10500,
    grossMinor: 63000,
    taxCode: "standard_vat"
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
