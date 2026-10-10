import { auditActions } from "@raring2go/audit";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  addAdvertiserContact,
  acceptProposalCommercially,
  acceptProposalAsBooking,
  allocatePayment,
  changeOpportunityStage,
  createAdvertiser,
  createInvoiceFromBooking,
  createArtworkRequirement,
  createOpportunity,
  createPricedProposal,
  artworkExceptions,
  convertRenewalToOpportunity,
  deriveAdvertiserMetrics,
  deriveRenewalPrompts,
  dismissRenewalPrompt,
  openArtworkExceptions,
  taxRateFor,
  priceProposalLine,
  sendProposal,
  refreshAdvertiserMetrics,
  createProofPack,
  createProposal,
  createRenewalPromptFromProofPack,
  editDraftInvoice,
  getAdvertiser360,
  advertiserChurn,
  commercialMix,
  getCommercialCommandCentre,
  issueCreditNote,
  issueInvoice,
  submitArtworkVersion,
  listCatalogue,
  listAdvertisers,
  listPipeline,
  recordAdvertiserActivity,
  recordCampaignFulfilment,
  recordPayment,
  reserveInventorySlot,
  respondToProposal,
  updateArtworkStatus,
  updateAdvertiser,
  createEditionInventorySlots,
  retireInventorySlot
} from "./service";
import type { AdvertisingData, CampaignFulfilment } from "./types";
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
    grant(ids.roles.hq, "advertiser.pricing", "manage", "network"),
    grant(ids.roles.hq, "advertiser.inventory", "manage", "network"),
    grant(ids.roles.local, "advertiser.inventory", "manage", "own_territory"),
    grant(ids.roles.hq, "advertiser.inventory", "reserve", "network"),
    grant(ids.roles.hq, "advertiser.proposal", "view", "network"),
    grant(ids.roles.hq, "advertiser.proposal", "create", "network"),
    grant(ids.roles.hq, "advertiser.proposal", "send", "network"),
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
    grant(ids.roles.hq, "advertiser.artwork", "view", "network"),
    grant(ids.roles.hq, "advertiser.artwork", "manage", "network"),
    grant(ids.roles.hq, "advertiser.artwork", "submit", "network"),
    grant(ids.roles.hq, "advertiser.artwork", "approve", "network"),
    grant(ids.roles.hq, "advertiser.fulfilment", "view", "network"),
    grant(ids.roles.hq, "advertiser.fulfilment", "manage", "network"),
    grant(ids.roles.hq, "advertiser.proof", "view", "network"),
    grant(ids.roles.hq, "advertiser.proof", "create", "network"),
    grant(ids.roles.hq, "advertiser.renewal", "view", "network"),
    grant(ids.roles.hq, "advertiser.renewal", "manage", "network"),
    grant(ids.roles.hq, "advertiser.analytics", "view", "network"),
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
    grant(ids.roles.local, "advertiser.proposal", "send", "own_territory"),
    grant(ids.roles.local, "advertiser.booking", "accept", "own_territory"),
    grant(ids.roles.local, "advertiser.proposal", "accept", "own_territory"),
    grant(ids.roles.local, "advertiser.proposal", "respond", "own_territory"),
    grant(ids.roles.local, "advertiser.finance", "view", "own_territory"),
    grant(ids.roles.local, "advertiser.invoice", "create", "own_territory"),
    grant(ids.roles.local, "advertiser.invoice", "edit_draft", "own_territory"),
    grant(ids.roles.local, "advertiser.invoice", "issue", "own_territory"),
    grant(ids.roles.local, "advertiser.credit", "create", "own_territory"),
    grant(ids.roles.local, "advertiser.payment", "record", "own_territory"),
    grant(ids.roles.local, "advertiser.payment", "allocate", "own_territory"),
    grant(ids.roles.local, "advertiser.artwork", "view", "own_territory"),
    grant(ids.roles.local, "advertiser.artwork", "manage", "own_territory"),
    grant(ids.roles.local, "advertiser.artwork", "submit", "own_territory"),
    grant(ids.roles.local, "advertiser.artwork", "approve", "own_territory"),
    grant(ids.roles.local, "advertiser.fulfilment", "view", "own_territory"),
    grant(ids.roles.local, "advertiser.fulfilment", "manage", "own_territory"),
    grant(ids.roles.local, "advertiser.proof", "view", "own_territory"),
    grant(ids.roles.local, "advertiser.proof", "create", "own_territory"),
    grant(ids.roles.local, "advertiser.renewal", "view", "own_territory"),
    grant(ids.roles.local, "advertiser.renewal", "manage", "own_territory"),
    grant(ids.roles.local, "advertiser.analytics", "view", "own_territory")
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

// The fixtures are written for 2026-08-11; the code reads the real clock, so pin it here.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-11T09:00:00.000Z"));
});
afterAll(() => vi.useRealTimers());

describe("artwork sign-off guards", () => {
  const requirementIn = (status: string, extra: Record<string, unknown> = {}) => {
    const data = seededData();
    data.artworkRequirements.push({ id: "aw", productionRequestId: "pr", bookingItemId: "bi", advertiserId: ids.advertiser, territoryId: ids.territories.own, sourceType: "advertiser_supplied", status, specification: {}, dimensions: {}, contentFields: {}, proofReference: {}, ...extra } as never);
    data.artworkVersions.push({ id: "v1", artworkRequirementId: "aw", versionNumber: 1, assetReference: {}, status: "submitted" } as never);
    return { data, requirement: data.artworkRequirements[0]! };
  };
  const move = (data: AdvertisingData, input: Record<string, unknown>) =>
    updateArtworkStatus(localContext(), permissions, audit(), data, "aw", { actorDate: "2026-08-14", domainEventId: "e", ...input } as never);

  it("refuses moves the workflow does not allow", async () => {
    const { data } = requirementIn("requested");
    await expect(move(data, { status: "production_ready" })).rejects.toThrow(/cannot move from requested to production ready/);
    const done = requirementIn("production_ready");
    await expect(move(done.data, { status: "approved", approvedVersionId: "v1" })).rejects.toThrow(/cannot move/);
  });

  it("needs a real, passing version to approve or sign off", async () => {
    const { data } = requirementIn("in_review");
    await expect(move(data, { status: "approved" })).rejects.toThrow(/submitted version/);
    await expect(move(data, { status: "approved", approvedVersionId: "nope" })).rejects.toThrow(/belong to the requirement/);
    data.artworkVersions[0]!.status = "rejected";
    await expect(move(data, { status: "approved", approvedVersionId: "v1" })).rejects.toThrow(/failed preflight/);
  });

  it("will not sign off for production with an open production exception, or a page that is not ready", async () => {
    const { data, requirement } = requirementIn("approved", { approvedVersionId: "v1", editionPageId: "page_3", proofReference: { exceptions: [{ versionId: "v0", preflightResultId: null, raisedAt: "2026-08-10", resolvedAt: null }] } });
    await expect(move(data, { status: "production_ready", pageReadiness: "ready" })).rejects.toThrow(/open production exception/);
    requirement.proofReference = { exceptions: [] };
    await expect(move(data, { status: "production_ready", pageReadiness: "blocked" })).rejects.toThrow(/page is not ready/);
    await expect(move(data, { status: "production_ready" })).rejects.toThrow(/page is not ready/);
    await move(data, { status: "production_ready", pageReadiness: "ready" });
    expect(requirement.status).toBe("production_ready");
  });

  it("raises an exception when preflight fails and clears it when a later version passes", async () => {
    const { data, requirement } = requirementIn("requested");
    const submit = (id: string, status: string) => submitArtworkVersion(localContext(), permissions, audit(), data, "aw", { id, artworkRequirementId: "aw", versionNumber: 2, assetReference: {}, status, preflightResultId: status === "rejected" ? "pf1" : null, submittedAt: "2026-08-12" } as never, `e_${id}`);
    await submit("bad", "rejected");
    expect(openArtworkExceptions(requirement)).toHaveLength(1);
    expect(requirement.status).toBe("rejected");

    await submit("good", "submitted");
    expect(openArtworkExceptions(requirement)).toHaveLength(0);
    expect(artworkExceptions(requirement)[0]).toMatchObject({ versionId: "bad", resolvedAt: "2026-08-11" });
  });
});

describe("fulfilment evidence", () => {
  const base = { id: "f1", bookingId: "booking_autumn", bookingItemId: "booking_item_autumn_1", advertiserId: ids.advertiser, territoryId: ids.territories.own, territoryEditionId: "edition_autumn", editionPageId: "page_3", status: "fulfilled", channel: "print", fulfilledOn: null, placementReference: {}, performanceReference: {}, metadata: {} } as CampaignFulfilment;

  function booked() {
    const data = seededData();
    seedAcceptedBooking(data);
    return data;
  }

  it("will not mark an edition placement fulfilled without a published output", async () => {
    await expect(recordCampaignFulfilment(localContext(), permissions, audit(), booked(), base, "e")).rejects.toThrow(/published edition output/);
    await expect(recordCampaignFulfilment(localContext(), permissions, audit(), booked(), base, "e", { publishedEvidence: { territoryEditionId: "other_edition", outputId: "o" } })).rejects.toThrow(/published edition output/);
    await expect(recordCampaignFulfilment(localContext(), permissions, audit(), booked(), base, "e", { publishedEvidence: { territoryEditionId: "edition_autumn", editionPageId: "page_9", outputId: "o" } })).rejects.toThrow(/published edition output/);
  });

  it("records the published output on the fulfilment and stamps the date", async () => {
    const data = booked();
    const fulfilment = await recordCampaignFulfilment(localContext(), permissions, audit(), data, base, "e", { publishedEvidence: { territoryEditionId: "edition_autumn", editionPageId: "page_3", outputId: "out_1", publishedOn: "2026-09-10" } });
    expect(fulfilment).toMatchObject({ fulfilledOn: "2026-08-11", placementReference: { publishedOutputId: "out_1", publishedOn: "2026-09-10" } });
  });

  it("lets a scheduled placement be recorded before it is published", async () => {
    const scheduled = await recordCampaignFulfilment(localContext(), permissions, audit(), booked(), { ...base, status: "scheduled" }, "e");
    expect(scheduled.status).toBe("scheduled");
  });
});

describe("renewal engine", () => {
  const withCampaign = (fulfilledOn: string, extra: { bookingsAfter?: string; openPrompt?: boolean; aav?: number; status?: string } = {}) => {
    const data = seededData();
    seedAcceptedBooking(data);
    const advertiser = data.advertisers.find((candidate) => candidate.id === ids.advertiser)!;
    advertiser.annualAdvertiserValueMinor = extra.aav ?? 100000;
    advertiser.status = extra.status ?? "active";
    data.campaignFulfilments.push({ id: "ful", bookingId: "booking_autumn", bookingItemId: "booking_item_autumn_1", advertiserId: ids.advertiser, territoryId: ids.territories.own, status: "fulfilled", channel: "print", fulfilledOn, placementReference: {}, performanceReference: {}, metadata: {} } as never);
    if (extra.bookingsAfter) data.bookings.push({ id: "booking_later", proposalId: "p2", advertiserId: ids.advertiser, territoryId: ids.territories.own, status: "booked", bookedOn: extra.bookingsAfter, totalValueMinor: 1, currency: "GBP", metadata: {} } as never);
    if (extra.openPrompt) data.renewalPrompts.push({ id: "r0", advertiserId: ids.advertiser, territoryId: ids.territories.own, status: "open", renewalSnapshot: {}, metadata: {} } as never);
    return data;
  };

  it("waits two weeks after a campaign finishes, then prompts, due a month after it ended", () => {
    expect(deriveRenewalPrompts(withCampaign("2026-08-01"), "2026-08-10")).toEqual([]);
    const [prompt] = deriveRenewalPrompts(withCampaign("2026-08-01"), "2026-08-15");
    expect(prompt).toMatchObject({ advertiserId: ids.advertiser, sourceBookingId: "booking_autumn", dueOn: "2026-08-31", renewalSnapshot: { lastFulfilledOn: "2026-08-01", priority: "normal" } });
  });

  it("ranks high-value advertisers first and uses their value", () => {
    const [prompt] = deriveRenewalPrompts(withCampaign("2026-08-01", { aav: 250000 }), "2026-08-20");
    expect(prompt?.renewalSnapshot).toMatchObject({ priority: "high", annualAdvertiserValueMinor: 250000 });
  });

  it("does not prompt someone who already booked again, has an open prompt, or is not a live account", () => {
    expect(deriveRenewalPrompts(withCampaign("2026-08-01", { bookingsAfter: "2026-08-05" }), "2026-08-20")).toEqual([]);
    expect(deriveRenewalPrompts(withCampaign("2026-08-01", { openPrompt: true }), "2026-08-20")).toEqual([]);
    expect(deriveRenewalPrompts(withCampaign("2026-08-01", { status: "archived" }), "2026-08-20")).toEqual([]);
  });

  it("never prompts twice for the same campaign, even after the first was dismissed", () => {
    const data = withCampaign("2026-08-01");
    data.renewalPrompts.push({ id: "r1", advertiserId: ids.advertiser, territoryId: ids.territories.own, sourceBookingId: "booking_autumn", status: "dismissed", renewalSnapshot: {}, metadata: {} } as never);
    expect(deriveRenewalPrompts(data, "2026-09-30")).toEqual([]);
  });

  it("dismisses with a reason and converts to an opportunity once", async () => {
    const data = withCampaign("2026-08-01");
    data.renewalPrompts.push({ id: "r1", advertiserId: ids.advertiser, territoryId: ids.territories.own, status: "open", dueOn: "2026-08-31", renewalSnapshot: { lastCampaignValueMinor: 52500, lastFulfilledOn: "2026-08-01" }, metadata: {} } as never);
    await expect(dismissRenewalPrompt(localContext(), permissions, audit(), data, "r1", "  ")).rejects.toThrow(/why/);

    const opportunity = await convertRenewalToOpportunity(localContext(), permissions, audit(), data, { renewalId: "r1", opportunityId: "opp_r", stageId: ids.stages.lead, title: "Renew autumn" });
    expect(opportunity).toMatchObject({ estimatedValueMinor: 52500, source: "renewal", expectedCloseDate: "2026-08-31" });
    expect(data.renewalPrompts[0]).toMatchObject({ status: "converted", opportunityId: "opp_r" });
    await expect(convertRenewalToOpportunity(localContext(), permissions, audit(), data, { renewalId: "r1", opportunityId: "opp_2", stageId: ids.stages.lead, title: "again" })).rejects.toThrow(/open renewal/);
    await expect(dismissRenewalPrompt(localContext(), permissions, audit(), data, "r1", "no")).rejects.toThrow(/open renewal/);
  });
});

describe("tax rates", () => {
  const data = (rates: Array<{ code: string; rateBps: number; effectiveFrom: string; effectiveTo?: string | null }>) => ({
    ...emptyData(),
    taxRates: rates.map((rate, index) => ({ id: `r${index}`, description: "", effectiveTo: null, ...rate }))
  });

  it("uses the rate in force on the date, so a later change does not touch earlier dates", () => {
    const rates = data([{ code: "standard_vat", rateBps: 1500, effectiveFrom: "2011-01-04", effectiveTo: "2026-12-31" }, { code: "standard_vat", rateBps: 2200, effectiveFrom: "2027-01-01" }]);
    expect(taxRateFor(rates, "standard_vat", "2026-10-09")).toBe(1500);
    expect(taxRateFor(rates, "standard_vat", "2027-03-01")).toBe(2200);
  });

  it("refuses a code with no rate in force instead of guessing one", () => {
    expect(() => taxRateFor(data([{ code: "standard_vat", rateBps: 2000, effectiveFrom: "2011-01-04" }]), "reduced", "2026-10-09")).toThrow(/No tax rate is configured/);
    expect(() => taxRateFor(data([{ code: "standard_vat", rateBps: 2000, effectiveFrom: "2030-01-01" }]), "standard_vat", "2026-10-09")).toThrow(/No tax rate/);
  });

  it("charges no tax on a zero-rated product when invoicing", async () => {
    const base = seededData();
    seedAcceptedBooking(base);
    base.products[0]!.taxCode = "zero_rated";
    const invoice = await createInvoiceFromBooking(localContext(), permissions, audit(), base, {
      invoiceId: "invoice_zero", lineIdPrefix: "zero_line", bookingId: "booking_autumn", issuerOrganisationId: ids.organisations.franchise,
      dueDate: "2026-09-10", billingSnapshot: {}, paymentTermsSnapshot: {}, domainEventId: "event_zero"
    });
    expect(invoice).toMatchObject({ taxMinor: 0, totalMinor: invoice.subtotalMinor });
    expect(base.invoiceLines.find((line) => line.invoiceId === "invoice_zero")).toMatchObject({ taxCode: "zero_rated", taxRateBps: 0 });
  });

  it("will not invoice a product whose tax code has no rate", async () => {
    const base = seededData();
    seedAcceptedBooking(base);
    base.products[0]!.taxCode = "mystery";
    await expect(createInvoiceFromBooking(localContext(), permissions, audit(), base, {
      invoiceId: "invoice_x", lineIdPrefix: "x", bookingId: "booking_autumn", issuerOrganisationId: ids.organisations.franchise,
      dueDate: "2026-09-10", billingSnapshot: {}, paymentTermsSnapshot: {}, domainEventId: "e"
    })).rejects.toThrow(/No tax rate/);
  });
});

describe("proposal pricing and sending", () => {
  const withCatalogue = (overrides: { requiresInventory?: boolean; bookStatus?: string; bookTerritory?: string | null; effectiveTo?: string } = {}) => ({
    ...seededData(),
    products: [{ id: "prod_page", key: "full-page", name: "Full page advert", channel: "print", status: "active", requiresInventory: overrides.requiresInventory ?? false, requiresArtwork: true, taxCode: "std", metadata: {} }] as never,
    priceBooks: [{ id: "book_net", key: "net", name: "Network", territoryId: overrides.bookTerritory ?? null, status: overrides.bookStatus ?? "active", effectiveFrom: "2026-01-01", effectiveTo: overrides.effectiveTo ?? "2026-12-31" }] as never,
    priceBookItems: [{ id: "pbi_1", priceBookId: "book_net", productId: "prod_page", standardPriceMinor: 52500, minimumPriceMinor: 42500, currency: "GBP", approvalRequiredBelowMinor: 45000, metadata: {} }] as never,
    inventorySlots: [{ id: "slot_1", territoryId: ids.territories.own, productId: "prod_page", slotKey: "p3", inventoryClass: "page", exclusive: true, status: "available", metadata: {} }] as never
  });
  let counter = 0;
  const newId = () => `id_${++counter}`;

  it("charges the list price from the price book when no price is given", () => {
    expect(priceProposalLine(localContext(), permissions, withCatalogue(), ids.territories.own, { productId: "prod_page", quantity: 2 })).toMatchObject({ unitPriceMinor: 52500, totalPriceMinor: 105000, discountPercent: 0 });
  });

  it("refuses a price below the book minimum, and a discount below the approval line without pricing permission", () => {
    expect(() => priceProposalLine(hqContext(), permissions, withCatalogue(), ids.territories.own, { productId: "prod_page", quantity: 1, unitPriceMinor: 40000 })).toThrow(/below the minimum/);
    expect(() => priceProposalLine(localContext(), permissions, withCatalogue(), ids.territories.own, { productId: "prod_page", quantity: 1, unitPriceMinor: 44000 })).toThrow(/needs approval/);
    expect(priceProposalLine(hqContext(), permissions, withCatalogue(), ids.territories.own, { productId: "prod_page", quantity: 1, unitPriceMinor: 44000 })).toMatchObject({ discountPercent: 16 });
    // A small discount above the approval line needs nobody's sign-off.
    expect(priceProposalLine(localContext(), permissions, withCatalogue(), ids.territories.own, { productId: "prod_page", quantity: 1, unitPriceMinor: 50000 }).discountPercent).toBe(5);
  });

  it("will not price from an inactive, expired or missing book, or with a silly quantity", () => {
    expect(() => priceProposalLine(localContext(), permissions, withCatalogue({ bookStatus: "draft" }), ids.territories.own, { productId: "prod_page", quantity: 1 })).toThrow(/no price/);
    expect(() => priceProposalLine(localContext(), permissions, withCatalogue({ effectiveTo: "2025-12-31" }), ids.territories.own, { productId: "prod_page", quantity: 1 })).toThrow(/no price/);
    expect(() => priceProposalLine(localContext(), permissions, withCatalogue(), ids.territories.own, { productId: "prod_page", quantity: 0 })).toThrow(/Quantity/);
    expect(() => priceProposalLine(localContext(), permissions, withCatalogue(), ids.territories.own, { productId: "prod_page", quantity: 1.5 })).toThrow(/Quantity/);
  });

  it("requires a slot for inventory products and keeps it in the territory", () => {
    expect(() => priceProposalLine(localContext(), permissions, withCatalogue({ requiresInventory: true }), ids.territories.own, { productId: "prod_page", quantity: 1 })).toThrow(/edition slot/);
    expect(priceProposalLine(localContext(), permissions, withCatalogue({ requiresInventory: true }), ids.territories.own, { productId: "prod_page", quantity: 1, inventorySlotId: "slot_1" }).inventorySlotId).toBe("slot_1");
    expect(() => priceProposalLine(localContext(), permissions, withCatalogue({ requiresInventory: true }), ids.territories.other, { productId: "prod_page", quantity: 1, inventorySlotId: "slot_1" })).toThrow(/territory/);
  });

  it("creates a draft proposal priced by the server, then sends it once", async () => {
    const data = withCatalogue();
    const recorder = audit();
    const proposal = await createPricedProposal(localContext(), permissions, recorder, data, { proposalId: "prop_new", advertiserId: ids.advertiser, title: "Autumn", validUntil: "2026-12-01", lines: [{ productId: "prod_page", quantity: 2 }], newId });
    expect(proposal).toMatchObject({ status: "draft", totalValueMinor: 105000, currency: "GBP" });
    expect(data.proposalItems.filter((item) => item.proposalId === "prop_new")[0]).toMatchObject({ unitPriceMinor: 52500, description: "Full page advert" });

    await sendProposal(localContext(), permissions, recorder, data, "prop_new");
    expect(data.proposals.find((p) => p.id === "prop_new")).toMatchObject({ status: "sent", sentOn: "2026-08-11" });
    await expect(sendProposal(localContext(), permissions, recorder, data, "prop_new")).rejects.toThrow(/draft/);
  });

  it("refuses an expired validity date and an empty proposal", async () => {
    await expect(createPricedProposal(localContext(), permissions, audit(), withCatalogue(), { proposalId: "p", advertiserId: ids.advertiser, title: "x", validUntil: "2020-01-01", lines: [{ productId: "prod_page", quantity: 1 }], newId })).rejects.toThrow(/past/);
    await expect(createPricedProposal(localContext(), permissions, audit(), withCatalogue(), { proposalId: "p", advertiserId: ids.advertiser, title: "x", validUntil: "2026-12-01", lines: [], newId })).rejects.toThrow(/at least one/);
  });
});

describe("advertiser status", () => {
  it("accepts only the known statuses, whatever a form posts", async () => {
    const data = seededData();
    await updateAdvertiser(localContext(), permissions, audit(), data, ids.advertiser, { status: "paused" });
    expect(data.advertisers.find((a) => a.id === ids.advertiser)?.status).toBe("paused");
    await expect(updateAdvertiser(localContext(), permissions, audit(), data, ids.advertiser, { status: "fulfilled" })).rejects.toThrow(/not a valid advertiser status/);
    expect(data.advertisers.find((a) => a.id === ids.advertiser)?.status).toBe("paused");
  });
});

describe("derived advertiser metrics", () => {
  const booking = (id: string, bookedOn: string, totalValueMinor: number, status = "booked") => ({
    id, proposalId: `p_${id}`, advertiserId: ids.advertiser, territoryId: ids.territories.own, status, bookedOn, totalValueMinor, currency: "GBP", metadata: {}
  });
  const withBookings = (bookings: ReturnType<typeof booking>[]) => ({ ...seededData(), bookings: bookings as never });

  it("has no history until something is booked", () => {
    expect(deriveAdvertiserMetrics(withBookings([]), ids.advertiser, "2026-08-11")).toMatchObject({ relationshipState: "new", averageSaleValueMinor: 0, annualAdvertiserValueMinor: 0, lastBookedOn: null });
  });

  it("is new after one booking and retained once they buy again", () => {
    const one = deriveAdvertiserMetrics(withBookings([booking("a", "2026-06-01", 100000)]), ids.advertiser, "2026-08-11");
    expect(one).toMatchObject({ relationshipState: "new", firstBookedOn: "2026-06-01", annualAdvertiserValueMinor: 100000 });

    const two = deriveAdvertiserMetrics(withBookings([booking("a", "2026-01-10", 100000), booking("b", "2026-06-01", 50000)]), ids.advertiser, "2026-08-11");
    expect(two).toMatchObject({ relationshipState: "retained", averageSaleValueMinor: 75000, annualAdvertiserValueMinor: 150000, lastBookedOn: "2026-06-01" });
  });

  it("counts only the last 365 days as annual value, and ignores cancelled bookings", () => {
    const metrics = deriveAdvertiserMetrics(withBookings([booking("old", "2025-01-01", 900000), booking("new", "2026-07-01", 20000), booking("x", "2026-07-02", 777777, "cancelled")]), ids.advertiser, "2026-08-11");
    expect(metrics.annualAdvertiserValueMinor).toBe(20000);
    expect(metrics.averageSaleValueMinor).toBe(460000);
  });

  it("flags at risk after nine months and lapsed after twelve, recording the lapse date", () => {
    expect(deriveAdvertiserMetrics(withBookings([booking("a", "2025-10-01", 1000)]), ids.advertiser, "2026-08-11").relationshipState).toBe("at_risk");
    const lapsed = deriveAdvertiserMetrics(withBookings([booking("a", "2025-01-01", 1000)]), ids.advertiser, "2026-08-11");
    expect(lapsed).toMatchObject({ relationshipState: "lapsed", lapsedOn: "2026-01-01", annualAdvertiserValueMinor: 0 });
  });

  it("refreshing writes the derived values with an audit record, and is a no-op when nothing changed", async () => {
    const data = withBookings([booking("a", "2026-01-10", 100000), booking("b", "2026-06-01", 50000)]);
    const recorder = audit();
    const first = await refreshAdvertiserMetrics(localContext(), permissions, recorder, data, ids.advertiser, "2026-08-11");
    expect(first.changed.length).toBeGreaterThan(0);
    expect(data.advertisers.find((a) => a.id === ids.advertiser)).toMatchObject({ averageSaleValueMinor: 75000, annualAdvertiserValueMinor: 150000 });
    expect(recorder.events.map((event) => event.action)).toEqual([auditActions.advertiserUpdate]);

    const again = await refreshAdvertiserMetrics(localContext(), permissions, recorder, data, ids.advertiser, "2026-08-11");
    expect(again.changed).toEqual([]);
    expect(recorder.events).toHaveLength(1);
  });

  it("is refused without edit permission", async () => {
    await expect(refreshAdvertiserMetrics({ userId: "nobody", organisationId: ids.organisations.franchise }, permissions, audit(), seededData(), ids.advertiser)).rejects.toThrow();
  });
});

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

  it("stamps records with the current date, not a fixed one", async () => {
    vi.setSystemTime(new Date("2031-03-04T09:00:00.000Z"));
    try {
      const data = seededData();
      const opportunity = await createOpportunity(localContext(), permissions, audit(), data, { ...baseOpportunity(), id: "opportunity_clock", stageId: ids.stages.lead, probability: 0, estimatedValueMinor: 100 });
      await changeOpportunityStage(localContext(), permissions, audit(), data, opportunity.id, { stageId: ids.stages.won });
      expect(opportunity.closedAt).toBe("2031-03-04");
    } finally {
      vi.setSystemTime(new Date("2026-08-11T09:00:00.000Z"));
    }
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

  it("will not book a proposal after its valid-until date", async () => {
    const data = seededData();
    seedProposal(data);
    const proposal = data.proposals.find((candidate) => candidate.id === "proposal_autumn")!;
    proposal.validUntil = "2026-08-10";
    await expect(acceptProposalAsBooking(localContext(), permissions, audit(), data, {
      proposalId: proposal.id, bookingId: "booking_late", bookingItemIdPrefix: "bi", reservationIdPrefix: "r", productionRequestIdPrefix: "p", acceptedOn: "2026-08-11"
    })).rejects.toThrow(/Expired/);
    expect(data.bookings).toHaveLength(0);
    expect(data.inventoryReservations).toHaveLength(0);
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
    expect(data.domainEvents.map((event) => event.eventType).sort()).toEqual([
      "advertiser.artwork.requested",
      "advertiser.booking.confirmed",
      "advertiser.proposal.accepted"
    ]);
    // Booking hands off to production straight away: artwork is requested, placed on the slot's edition page.
    expect(data.artworkRequirements).toHaveLength(1);
    expect(data.artworkRequirements[0]).toMatchObject({ status: "requested", sourceType: "advertiser_supplied", bookingItemId: data.bookingItems[0]!.id });
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

  it("tracks artwork handoff, preflight-linked submissions and production readiness", async () => {
    const data = seededData();
    seedAcceptedBooking(data);
    data.productionRequests.push({
      id: "production_1",
      bookingId: "booking_autumn",
      bookingItemId: "booking_item_autumn_1",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      requestType: "artwork",
      status: "requested",
      dueOn: "2026-08-20",
      metadata: {}
    });
    const recorder = audit();
    const requirement = await createArtworkRequirement(localContext(), permissions, recorder, data, {
      id: "artwork_1",
      productionRequestId: "production_1",
      bookingItemId: "booking_item_autumn_1",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      territoryEditionId: "edition_autumn",
      editionPageId: "page_3",
      inventorySlotId: ids.slot,
      sourceType: "advertiser_supplied",
      status: "requested",
      specification: { format: "print_pdf" },
      dimensions: { widthMm: 210, heightMm: 297 },
      contentFields: { headline: "Autumn offer" },
      deadline: "2026-08-20",
      approvedVersionId: null,
      proofReference: {},
      advertiserApprovedAt: null,
      productionApprovedAt: null
    }, "event_artwork_requested");
    await submitArtworkVersion(localContext(), permissions, recorder, data, requirement.id, {
      id: "artwork_version_1",
      artworkRequirementId: requirement.id,
      versionNumber: 1,
      submittedByUserId: ids.users.local,
      assetReference: { storageKey: "artwork/example.pdf" },
      status: "submitted",
      preflightResultId: "preflight_1",
      notes: "Initial upload",
      submittedAt: "2026-08-12"
    }, "event_artwork_submitted");
    await updateArtworkStatus(localContext(), permissions, recorder, data, requirement.id, {
      status: "changes_requested",
      actorDate: "2026-08-13",
      domainEventId: "event_changes"
    });
    await updateArtworkStatus(localContext(), permissions, recorder, data, requirement.id, {
      status: "approved",
      approvedVersionId: "artwork_version_1",
      proofReference: { proofKey: "proof/example-v1.pdf" },
      actorDate: "2026-08-14",
      domainEventId: "event_proof_approved"
    });
    await updateArtworkStatus(localContext(), permissions, recorder, data, requirement.id, {
      status: "production_ready",
      actorDate: "2026-08-15",
      domainEventId: "event_ready",
      pageReadiness: "ready"
    });

    expect(requirement).toMatchObject({
      status: "production_ready",
      approvedVersionId: "artwork_version_1",
      advertiserApprovedAt: "2026-08-14",
      productionApprovedAt: "2026-08-15"
    });
    expect(getAdvertiser360(localContext(), permissions, data, ids.advertiser).artworkRequirements).toHaveLength(1);
    expect(data.domainEvents.map((event) => event.eventType)).toContain("advertiser.artwork.production_ready");
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.advertiserArtworkRequest,
      auditActions.advertiserArtworkSubmit,
      auditActions.advertiserArtworkChangesRequest,
      auditActions.advertiserArtworkProofApprove,
      auditActions.advertiserArtworkProductionReady
    ]);
  });

  it("records campaign fulfilment, immutable proof packs and renewal prompts", async () => {
    const data = seededData();
    seedAcceptedBooking(data);
    data.productionRequests.push({
      id: "production_1",
      bookingId: "booking_autumn",
      bookingItemId: "booking_item_autumn_1",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      requestType: "artwork",
      status: "ready",
      dueOn: "2026-08-20",
      metadata: {}
    });
    data.artworkRequirements.push({
      id: "artwork_1",
      productionRequestId: "production_1",
      bookingItemId: "booking_item_autumn_1",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      territoryEditionId: "edition_autumn",
      editionPageId: "page_3",
      inventorySlotId: ids.slot,
      sourceType: "advertiser_supplied",
      status: "production_ready",
      specification: {},
      dimensions: {},
      contentFields: {},
      deadline: "2026-08-20",
      approvedVersionId: "artwork_version_1",
      proofReference: { proofKey: "proof/example-v1.pdf" },
      advertiserApprovedAt: "2026-08-14",
      productionApprovedAt: "2026-08-15"
    });
    data.artworkVersions.push({
      id: "artwork_version_1",
      artworkRequirementId: "artwork_1",
      versionNumber: 1,
      submittedByUserId: ids.users.local,
      assetReference: { storageKey: "artwork/example.pdf" },
      status: "approved",
      preflightResultId: "preflight_1",
      notes: null,
      submittedAt: "2026-08-12"
    });
    const recorder = audit();

    const fulfilment = await recordCampaignFulfilment(localContext(), permissions, recorder, data, {
      id: "fulfilment_1",
      bookingId: "booking_autumn",
      bookingItemId: "booking_item_autumn_1",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      artworkRequirementId: "artwork_1",
      territoryEditionId: "edition_autumn",
      editionPageId: "page_3",
      status: "fulfilled",
      channel: "print",
      scheduledOn: "2026-09-01",
      fulfilledOn: "2026-09-10",
      placementReference: { page: 3, slot: "full-page" },
      performanceReference: { outputId: "publication_output_1" },
      metadata: {}
    }, "event_fulfilment", { publishedEvidence: { territoryEditionId: "edition_autumn", editionPageId: "page_3", outputId: "publication_output_1", publishedOn: "2026-09-10" } });
    const proofPack = await createProofPack(localContext(), permissions, recorder, data, {
      id: "proof_pack_1",
      fulfilmentId: fulfilment.id,
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      status: "delivered",
      issuedAt: "2026-09-12",
      deliveredAt: "2026-09-12",
      artefactReference: { storageKey: "proof-packs/example.pdf" },
      metricsSnapshot: { impressions: null },
      renewalPromptId: null
    }, "event_proof");
    fulfilment.placementReference = { page: 99 };
    await createRenewalPromptFromProofPack(localContext(), permissions, recorder, data, {
      id: "renewal_1",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      sourceBookingId: "booking_autumn",
      sourceProofPackId: proofPack.id,
      status: "open",
      dueOn: "2026-10-01",
      assignedToUserId: ids.users.local,
      opportunityId: null,
      renewalSnapshot: { previousBookingValueMinor: 52500, recommendedAction: "renew" },
      metadata: {}
    }, "event_renewal");

    expect(proofPack.proofSnapshot).toMatchObject({
      fulfilment: {
        placementReference: { page: 3, slot: "full-page" }
      },
      artwork: {
        approvedVersionId: "artwork_version_1",
        assetReference: { storageKey: "artwork/example.pdf" }
      }
    });
    expect(data.proofPacks[0]?.proofSnapshot).not.toMatchObject({
      fulfilment: {
        placementReference: { page: 99 }
      }
    });
    expect(getAdvertiser360(localContext(), permissions, data, ids.advertiser)).toMatchObject({
      campaignFulfilments: [{ id: "fulfilment_1" }],
      proofPacks: [{ id: "proof_pack_1", renewalPromptId: "renewal_1" }],
      renewalPrompts: [{ id: "renewal_1" }]
    });
    expect(data.domainEvents.map((event) => event.eventType)).toEqual([
      "advertiser.campaign.fulfilment_recorded",
      "advertiser.proof_pack.created",
      "advertiser.renewal.prompt_created"
    ]);
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.advertiserFulfilmentRecord,
      auditActions.advertiserProofPackCreate,
      auditActions.advertiserProofPackDeliver,
      auditActions.advertiserRenewalPromptCreate
    ]);
  });

  it("denies campaign fulfilment across territories and without capability", async () => {
    const data = seededData();
    seedAcceptedBooking(data);
    const noFulfilmentPermission: PermissionData = {
      ...permissions,
      rolePermissions: permissions.rolePermissions.filter((grant) => grant.permission.module !== "advertiser.fulfilment")
    };

    await expect(recordCampaignFulfilment(localContext(), noFulfilmentPermission, audit(), data, {
      id: "fulfilment_1",
      bookingId: "booking_autumn",
      bookingItemId: "booking_item_autumn_1",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      status: "scheduled",
      channel: "print",
      scheduledOn: "2026-09-01",
      fulfilledOn: null,
      placementReference: {},
      performanceReference: {},
      metadata: {}
    }, "event_fulfilment")).rejects.toThrow("No permission grant");

    await expect(recordCampaignFulfilment(localContext(), permissions, audit(), data, {
      id: "fulfilment_cross",
      bookingId: "booking_autumn",
      bookingItemId: "booking_item_autumn_1",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.other,
      status: "scheduled",
      channel: "print",
      scheduledOn: "2026-09-01",
      fulfilledOn: null,
      placementReference: {},
      performanceReference: {},
      metadata: {}
    }, "event_cross")).rejects.toThrow("territory");
  });

  it("builds a permission-scoped commercial command centre and territory benchmarks", () => {
    const data = seededData();
    seedAcceptedBooking(data);
    data.bookings.push({
      id: "booking_other",
      proposalId: "proposal_other",
      advertiserId: ids.otherAdvertiser,
      opportunityId: null,
      territoryId: ids.territories.other,
      status: "booked",
      bookedOn: "2026-08-11",
      totalValueMinor: 90000,
      currency: "GBP",
      metadata: {}
    });
    data.invoices.push({
      id: "invoice_overdue",
      issuerOrganisationId: ids.organisations.franchise,
      advertiserId: ids.advertiser,
      customerOrganisationId: ids.organisations.advertiser,
      territoryId: ids.territories.own,
      bookingId: "booking_autumn",
      invoiceNumber: "R2G-00001",
      status: "issued",
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      voidedAt: null,
      currency: "GBP",
      subtotalMinor: 52500,
      taxMinor: 10500,
      totalMinor: 63000,
      amountPaidMinor: 0,
      balanceMinor: 63000,
      billingSnapshot: {},
      paymentTermsSnapshot: {},
      issuedSnapshot: {}
    });
    data.payments.push({
      id: "payment_1",
      issuerOrganisationId: ids.organisations.franchise,
      advertiserId: ids.advertiser,
      payerOrganisationId: ids.organisations.advertiser,
      amountMinor: 21000,
      allocatedMinor: 21000,
      unallocatedMinor: 0,
      currency: "GBP",
      receivedDate: "2026-08-01",
      method: "bank_transfer",
      providerKey: null,
      externalReference: null,
      providerEventId: null,
      status: "received",
      metadata: {}
    });
    data.artworkRequirements.push({
      id: "artwork_open",
      productionRequestId: "production_missing",
      bookingItemId: "booking_item_autumn_1",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      territoryEditionId: null,
      editionPageId: null,
      inventorySlotId: null,
      sourceType: "advertiser_supplied",
      status: "requested",
      specification: {},
      dimensions: {},
      contentFields: {},
      deadline: null,
      approvedVersionId: null,
      proofReference: {},
      advertiserApprovedAt: null,
      productionApprovedAt: null
    });
    data.campaignFulfilments.push({
      id: "fulfilment_open",
      bookingId: "booking_autumn",
      bookingItemId: "booking_item_autumn_1",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      status: "scheduled",
      channel: "print",
      scheduledOn: "2026-09-01",
      fulfilledOn: null,
      placementReference: {},
      performanceReference: {},
      metadata: {}
    });
    data.renewalPrompts.push({
      id: "renewal_open",
      advertiserId: ids.advertiser,
      territoryId: ids.territories.own,
      sourceBookingId: "booking_autumn",
      sourceProofPackId: null,
      status: "open",
      dueOn: "2026-10-01",
      assignedToUserId: ids.users.local,
      opportunityId: null,
      renewalSnapshot: {},
      metadata: {}
    });

    const network = getCommercialCommandCentre(hqContext(), permissions, data);
    const local = getCommercialCommandCentre(localContext(), permissions, data);
    const noAnalyticsPermission: PermissionData = {
      ...permissions,
      rolePermissions: permissions.rolePermissions.filter((grant) => grant.permission.module !== "advertiser.analytics")
    };

    expect(network).toMatchObject({
      scope: "network",
      totals: {
        advertisers: 2,
        bookedValueMinor: 142500,
        overdueDebtMinor: 63000,
        paidMinor: 21000,
        openArtwork: 1,
        openFulfilments: 1,
        openRenewals: 1
      }
    });
    expect(network.territoryBenchmarks).toHaveLength(2);
    expect(local).toMatchObject({
      scope: "territory",
      totals: {
        advertisers: 1,
        bookedValueMinor: 52500
      },
      attention: {
        overdueDebtAdvertiserIds: [ids.advertiser],
        artworkAdvertiserIds: [ids.advertiser],
        fulfilmentAdvertiserIds: [ids.advertiser],
        renewalAdvertiserIds: [ids.advertiser]
      }
    });
    expect(local.territoryBenchmarks).toHaveLength(1);
    expect(() => getCommercialCommandCentre(localContext(), noAnalyticsPermission, data)).toThrow("No permission grant");
  });
});

describe("advertiser churn and sales mix", () => {
  const advertiser = (id: string, firstBookedOn: string | null, lapsedOn: string | null) => ({ id, firstBookedOn, lapsedOn } as unknown as Parameters<typeof advertiserChurn>[0][number]);

  it("counts churn against the base a year ago, ignoring newcomers and those already lapsed", () => {
    const asOf = "2026-10-09";
    const result = advertiserChurn([
      advertiser("a", "2024-01-01", null),
      advertiser("b", "2024-01-01", "2026-03-01"),
      advertiser("c", "2024-01-01", "2025-01-01"),
      advertiser("d", "2026-06-01", null),
      advertiser("e", null, null)
    ], asOf);
    expect(result).toEqual({ baseAYearAgo: 2, lost: 1, ratePercent: 50 });
    expect(advertiserChurn([], asOf).ratePercent).toBeNull();
  });

  it("splits the last 90 days of sold value into package and digital, and has no share when nothing sold", () => {
    const data = {
      bookingItems: [
        { id: "i1", bookingId: "b1", proposalItemId: "p1", productId: "print", totalPriceMinor: 60_000 },
        { id: "i2", bookingId: "b1", proposalItemId: "p2", productId: "web", totalPriceMinor: 30_000 },
        { id: "i3", bookingId: "b2", proposalItemId: "p3", productId: "web", totalPriceMinor: 10_000 },
        { id: "i4", bookingId: "old", proposalItemId: "p3", productId: "web", totalPriceMinor: 999_999 }
      ],
      proposalItems: [{ id: "p1", packageId: "pk" }, { id: "p2", packageId: "pk" }, { id: "p3", packageId: null }],
      products: [{ id: "print", channel: "magazine" }, { id: "web", channel: "website" }]
    } as unknown as AdvertisingData;
    const bookings = [
      { id: "b1", status: "booked", bookedOn: "2026-09-01" },
      { id: "b2", status: "booked", bookedOn: "2026-10-01" },
      { id: "old", status: "booked", bookedOn: "2025-01-01" },
      { id: "x", status: "cancelled", bookedOn: "2026-10-01" }
    ] as unknown as Parameters<typeof commercialMix>[1];
    expect(commercialMix(data, bookings, "2026-10-09")).toEqual({ soldMinor: 100_000, packageMinor: 90_000, digitalMinor: 40_000, packageSharePercent: 90, digitalSharePercent: 40 });
    expect(commercialMix(data, [], "2026-10-09")).toMatchObject({ soldMinor: 0, packageSharePercent: null, digitalSharePercent: null });
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
    taxRates: [
      { id: "rate_std", code: "standard_vat", description: "Standard", rateBps: 2000, effectiveFrom: "2011-01-04", effectiveTo: null },
      { id: "rate_zero", code: "zero_rated", description: "Zero", rateBps: 0, effectiveFrom: "2011-01-04", effectiveTo: null }
    ],
    invoices: [],
    invoiceLines: [],
    creditNotes: [],
    creditNoteLines: [],
    payments: [],
    paymentAllocations: [],
    providerSyncReferences: [],
    artworkRequirements: [],
    artworkVersions: [],
    campaignFulfilments: [],
    proofPacks: [],
    renewalPrompts: [],
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

describe("edition inventory slots", () => {
  const product = () => ({ id: "prod_full", key: "full-page-ad", name: "Full page", channel: "magazine", status: "active", requiresInventory: true, requiresArtwork: true, taxCode: "standard_vat", metadata: { inventoryClass: "full_page" } });
  const edition = (over: Partial<import("./service").EditionInventoryTarget> = {}) => ({
    id: "ed1", territoryId: ids.territories.own, status: "localising",
    pages: [
      { id: "aaaaaaaa-1", pageNumber: 1, locked: true, ownerType: "hq", hasContent: false },
      { id: "bbbbbbbb-2", pageNumber: 2, locked: false, ownerType: "hq", hasContent: false },
      { id: "cccccccc-3", pageNumber: 3, locked: false, ownerType: "local", hasContent: false },
      { id: "dddddddd-4", pageNumber: 4, locked: false, ownerType: "local", hasContent: true },
      { id: "eeeeeeee-5", pageNumber: 5, locked: false, ownerType: "local", hasContent: false }
    ],
    ...over
  });
  const withProduct = () => { const data = emptyData(); data.products.push(product() as never); return data; };

  it("creates slots on chosen pages once, restores a retired one, and audits", async () => {
    const data = withProduct();
    const rec = audit();
    expect(await createEditionInventorySlots(localContext(), permissions, rec, data, { edition: edition(), productId: "prod_full", pageIds: ["cccccccc-3", "eeeeeeee-5"] })).toEqual({ created: 2, restored: 0, skipped: 0 });
    expect(data.inventorySlots).toHaveLength(2);
    expect(data.inventorySlots[0]).toMatchObject({ territoryEditionId: "ed1", editionPageId: "cccccccc-3", status: "available", inventoryClass: "full_page", exclusive: true });
    expect(await createEditionInventorySlots(localContext(), permissions, rec, data, { edition: edition(), productId: "prod_full", pageIds: ["cccccccc-3"] })).toEqual({ created: 0, restored: 0, skipped: 1 });
    await retireInventorySlot(localContext(), permissions, rec, data, data.inventorySlots[0]!.id);
    expect(data.inventorySlots[0]!.deletedAt).toBeInstanceOf(Date);
    expect(await createEditionInventorySlots(localContext(), permissions, rec, data, { edition: edition(), productId: "prod_full", pageIds: ["cccccccc-3"] })).toEqual({ created: 0, restored: 1, skipped: 0 });
    expect(data.inventorySlots).toHaveLength(2);
    expect(data.inventorySlots[0]!.deletedAt).toBeNull();
    expect(rec.events.every((event) => event.action === auditActions.advertiserInventoryManage)).toBe(true);
  });

  it("refuses locked, HQ-owned (for a territory), editorial and wrong-kind pages, bad products and published editions", async () => {
    const data = withProduct();
    const create = (pageIds: string[], over = {}, productId = "prod_full", context: ReturnType<typeof localContext> | ReturnType<typeof hqContext> = localContext()) =>
      createEditionInventorySlots(context, permissions, audit(), data, { edition: edition(over), productId, pageIds });
    await expect(create(["aaaaaaaa-1"])).rejects.toThrow(/locked/);
    await expect(create(["bbbbbbbb-2"])).rejects.toThrow(/belongs to HQ/);
    await expect(create(["dddddddd-4"])).rejects.toThrow(/editorial content/);
    await expect(create(["nope"])).rejects.toThrow(/not in this edition/);
    await expect(create([])).rejects.toThrow(/at least one/);
    await expect(create(["cccccccc-3"], { status: "published" })).rejects.toThrow(/published/);
    await expect(create(["cccccccc-3"], {}, "missing")).rejects.toThrow(/does not sell/);
    data.products[0]!.requiresInventory = false;
    await expect(create(["cccccccc-3"])).rejects.toThrow(/does not sell/);
    data.products[0]!.requiresInventory = true;
    expect(await create(["bbbbbbbb-2"], {}, "prod_full", hqContext())).toMatchObject({ created: 1 });
    data.inventorySlots.push({ ...data.inventorySlots[0]!, id: "other", editionPageId: "eeeeeeee-5", slotKey: "half-x", inventoryClass: "half_page" });
    await expect(create(["eeeeeeee-5"])).rejects.toThrow(/different kind/);
  });

  it("keeps other territories out and will not retire a sold slot", async () => {
    const data = withProduct();
    await expect(createEditionInventorySlots(localContext(), permissions, audit(), data, { edition: edition({ territoryId: ids.territories.other }), productId: "prod_full", pageIds: ["cccccccc-3"] })).rejects.toThrow(/outside/);
    await createEditionInventorySlots(hqContext(), permissions, audit(), data, { edition: edition(), productId: "prod_full", pageIds: ["cccccccc-3"] });
    const slot = data.inventorySlots[0]!;
    await expect(retireInventorySlot(otherLocal(), permissions, audit(), data, slot.id)).rejects.toThrow(/outside|permission/);
    slot.status = "reserved";
    await expect(retireInventorySlot(hqContext(), permissions, audit(), data, slot.id)).rejects.toThrow(/unsold/);
  });
});

function otherLocal() {
  return { ...localContext(), territoryId: ids.territories.other };
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
