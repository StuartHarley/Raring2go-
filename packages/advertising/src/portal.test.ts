import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it, vi } from "vitest";
import { buildPortalView, portalRespondToProof, portalRespondToProposal, portalSubmitArtwork, PortalAccessError, PortalStateError, resolvePortalIdentity } from "./portal";
import { persistedCollections } from "./persist";
import { submitArtworkVersion } from "./service";
import type { AdvertisingData } from "./types";

const NOW = new Date("2026-03-10T09:00:00Z");
const A = { org: "org-a", adv: "adv-a", user: "user-a", contact: "contact-a" };
const B = { org: "org-b", adv: "adv-b", user: "user-b", contact: "contact-b" };

function blank(): AdvertisingData {
  const keys = [...persistedCollections.map(([key]) => key), "organisations", "territories"];
  return Object.fromEntries(keys.map((key) => [key, []])) as unknown as AdvertisingData;
}

const grant = (action: string, module: string) => ({ roleId: "adv-role", permission: { id: `${module}.${action}`, module, action }, scope: "own_organisation" });
const permissions: PermissionData = {
  roleAssignments: [
    { id: "a1", userId: A.user, roleId: "adv-role", organisationId: A.org },
    { id: "a2", userId: B.user, roleId: "adv-role", organisationId: B.org }
  ],
  rolePermissions: [
    grant("submit", "advertiser.artwork"), grant("approve", "advertiser.artwork"), grant("manage", "advertiser.artwork"),
    grant("accept", "advertiser.proposal"), grant("respond", "advertiser.proposal"), grant("accept", "advertiser.booking")
  ]
};
const noAudit = { record: async () => undefined };

function dataset(): AdvertisingData {
  const data = blank();
  for (const side of [A, B]) {
    data.organisations.push({ id: side.org, kind: "advertiser", name: side === A ? "Acme Ltd" : "Beta Ltd" } as never);
    data.advertisers.push({ id: side.adv, advertiserOrganisationId: side.org, owningTerritoryId: "t-1", accountOwnerUserId: "staff-secret", status: "active", relationshipState: "retained", source: "referral", averageSaleValueMinor: 111111, annualAdvertiserValueMinor: 999999, currency: "GBP", tags: ["INTERNAL-TAG"], commercialMetadata: { marginNote: "INTERNAL" } } as never);
    data.contacts.push({ id: side.contact, advertiserId: side.adv, userId: side.user, label: "Main", name: "Pat", email: "pat@example.test", role: "contact", isPrimary: true } as never);
  }
  data.organisations.push({ id: "org-hq", kind: "hq", name: "HQ" } as never);
  data.territories.push({ id: "t-1", franchiseOrganisationId: "org-f", code: "T1", name: "Sutton" } as never);
  data.products.push({ id: "prod-1", key: "full-page", name: "Full page", channel: "print", status: "active", requiresInventory: false, requiresArtwork: true, taxCode: "S", metadata: {} } as never);
  data.terms.push({ id: "terms-1", key: "std", version: "1", status: "approved", title: "Terms", contentHash: "h", contentSnapshot: {}, approvedAt: "2026-01-01" } as never);

  const proposal = (id: string, advertiserId: string, status: string, extra: Record<string, unknown> = {}) => ({ id, advertiserId, territoryId: "t-1", status, version: 1, title: `Proposal ${id}`, totalValueMinor: 50000, currency: "GBP", validUntil: "2026-12-31", sentOn: "2026-03-01", metadata: { internalNote: "INTERNAL-PROPOSAL-NOTE" }, ...extra });
  data.proposals.push(proposal("prop-a1", A.adv, "sent"), proposal("prop-a-draft", A.adv, "draft"), proposal("prop-a-expired", A.adv, "sent", { validUntil: "2026-01-01" }), proposal("prop-b1", B.adv, "sent") as never);
  for (const id of ["prop-a1", "prop-a-expired", "prop-b1"]) {
    data.proposalItems.push({ id: `${id}-item`, proposalId: id, productId: "prod-1", description: "Full page advert", quantity: 1, unitPriceMinor: 50000, totalPriceMinor: 50000, currency: "GBP", metadata: {} } as never);
  }

  // Advertiser A has a live booking with artwork in each interesting state; B has one too.
  for (const side of [A, B]) {
    data.bookings.push({ id: `book-${side.adv}`, proposalId: "x", advertiserId: side.adv, territoryId: "t-1", status: "booked", bookedOn: "2026-03-02", totalValueMinor: 50000, currency: "GBP", metadata: {} } as never);
    data.bookingItems.push({ id: `bi-${side.adv}`, bookingId: `book-${side.adv}`, proposalItemId: "p", productId: "prod-1", description: "Full page advert", quantity: 1, totalPriceMinor: 50000, currency: "GBP", metadata: {} } as never);
    data.artworkRequirements.push({ id: `req-${side.adv}`, productionRequestId: "pr", bookingItemId: `bi-${side.adv}`, advertiserId: side.adv, territoryId: "t-1", sourceType: "advertiser_supplied", status: "requested", specification: {}, dimensions: { width: 210 }, contentFields: {}, deadline: "2026-03-20", proofReference: {} } as never);
    data.campaignFulfilments.push({ id: `ful-${side.adv}`, bookingId: `book-${side.adv}`, bookingItemId: `bi-${side.adv}`, advertiserId: side.adv, territoryId: "t-1", status: "scheduled", channel: "print", placementReference: {}, performanceReference: {}, metadata: {} } as never);
    data.proofPacks.push(
      { id: `pack-${side.adv}`, fulfilmentId: `ful-${side.adv}`, advertiserId: side.adv, territoryId: "t-1", status: "issued", issuedAt: "2026-03-05", proofSnapshot: { secret: "INTERNAL-PROOF" }, artefactReference: {}, metricsSnapshot: { reach: 1200, clicks: 40, label: "x" } } as never,
      { id: `pack-draft-${side.adv}`, fulfilmentId: `ful-${side.adv}`, advertiserId: side.adv, territoryId: "t-1", status: "draft", proofSnapshot: {}, artefactReference: {}, metricsSnapshot: { reach: 99999 } } as never
    );
    data.invoices.push(
      { id: `inv-${side.adv}`, issuerOrganisationId: "org-f", advertiserId: side.adv, customerOrganisationId: side.org, territoryId: "t-1", invoiceNumber: `INV-${side.adv}`, status: "issued", issueDate: "2026-02-01", dueDate: "2026-02-15", currency: "GBP", subtotalMinor: 50000, taxMinor: 10000, totalMinor: 60000, amountPaidMinor: 10000, balanceMinor: 50000, billingSnapshot: {}, paymentTermsSnapshot: {}, issuedSnapshot: {} } as never,
      { id: `inv-draft-${side.adv}`, issuerOrganisationId: "org-f", advertiserId: side.adv, customerOrganisationId: side.org, territoryId: "t-1", invoiceNumber: `DRAFT-${side.adv}`, status: "draft", currency: "GBP", subtotalMinor: 1, taxMinor: 0, totalMinor: 1, amountPaidMinor: 0, balanceMinor: 1, billingSnapshot: {}, paymentTermsSnapshot: {}, issuedSnapshot: {} } as never
    );
    data.invoiceLines.push({ id: `line-${side.adv}`, invoiceId: `inv-${side.adv}`, description: "Full page advert", quantity: 1, netMinor: 50000, taxRateBps: 2000, taxMinor: 10000, grossMinor: 60000, taxCode: "S" } as never);
    data.payments.push({ id: `pay-${side.adv}`, issuerOrganisationId: "org-f", advertiserId: side.adv, payerOrganisationId: side.org, amountMinor: 10000, allocatedMinor: 10000, unallocatedMinor: 0, currency: "GBP", receivedDate: "2026-02-10", method: "bank_transfer", status: "received", metadata: {} } as never);
    data.paymentAllocations.push({ id: `alloc-${side.adv}`, paymentId: `pay-${side.adv}`, invoiceId: `inv-${side.adv}`, amountMinor: 10000, allocatedAt: "2026-02-10", status: "allocated", metadata: {} } as never);
    data.renewalPrompts.push({ id: `ren-${side.adv}`, advertiserId: side.adv, territoryId: "t-1", status: "open", dueOn: "2026-04-01", renewalSnapshot: { summary: "Renew your spring advert", internalScore: 98 }, metadata: {} } as never);
  }
  return data;
}

const idA = () => resolvePortalIdentity(dataset(), { userId: A.user, organisationId: A.org });

describe("resolvePortalIdentity", () => {
  it("derives the closed set of advertiser ids from the account's organisation", () => {
    expect(idA()).toEqual({ userId: A.user, organisationId: A.org, advertiserIds: [A.adv] });
  });

  it("refuses accounts whose organisation is not an advertiser, or has none", () => {
    expect(() => resolvePortalIdentity(dataset(), { userId: "staff", organisationId: "org-hq" })).toThrow(PortalAccessError);
    expect(() => resolvePortalIdentity(dataset(), { userId: "x", organisationId: "nope" })).toThrow(PortalAccessError);
    const empty = dataset();
    empty.advertisers = [];
    expect(() => resolvePortalIdentity(empty, { userId: A.user, organisationId: A.org })).toThrow(PortalAccessError);
  });
});

describe("buildPortalView", () => {
  const view = () => buildPortalView(idA(), dataset(), NOW);

  it("shows only the account's own records, never another advertiser's", () => {
    const json = JSON.stringify(view());
    expect(json).toContain(A.adv.replace("adv-", "INV-adv-"));
    for (const other of ["adv-b", "prop-b1", "Beta Ltd", "req-adv-b", "book-adv-b", "INV-adv-b"]) expect(json).not.toContain(other);
    expect(view().advertisers).toEqual([{ id: A.adv, name: "Acme Ltd" }]);
  });

  it("never exposes internal fields, drafts or staff-only data", () => {
    const json = JSON.stringify(view());
    for (const secret of ["INTERNAL", "staff-secret", "marginNote", "INTERNAL-PROOF", "internalScore", "999999", "DRAFT-", "99999", "pat@example.test"]) expect(json).not.toContain(secret);
    expect(view().proposals.some((proposal) => proposal.id === "prop-a-draft")).toBe(false);
  });

  it("flags what needs the advertiser's action", () => {
    const { needsAction, proposals, campaigns } = view();
    expect(proposals.find((proposal) => proposal.id === "prop-a1")!.canRespond).toBe(true);
    expect(proposals.find((proposal) => proposal.id === "prop-a-expired")!.canRespond).toBe(false);
    expect(campaigns[0]!.artwork[0]).toMatchObject({ canSubmit: true, awaitingProofApproval: false });
    expect(needsAction.map((entry) => entry.kind).sort()).toEqual(["artwork", "invoice", "proposal"]);
  });

  it("reports invoices, payments, balances and issued proof metrics, summing outstanding and overdue", () => {
    const { invoices, summary, campaigns } = view();
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ totalMinor: 60000, balanceMinor: 50000, overdue: true, payments: [{ amountMinor: 10000, method: "bank_transfer" }] });
    expect(summary).toMatchObject({ outstandingMinor: 50000, overdueMinor: 50000, metrics: { reach: 1200, clicks: 40 } });
    expect(campaigns[0]!.proofPacks).toHaveLength(1);
    expect(view().renewals).toEqual([{ id: "ren-adv-a", status: "open", dueOn: "2026-04-01", summary: "Renew your spring advert" }]);
  });

  it("marks a proof as awaiting approval only when one has actually been issued", () => {
    const data = dataset();
    const requirement = data.artworkRequirements.find((entry) => entry.advertiserId === A.adv)!;
    requirement.status = "in_review";
    expect(buildPortalView(idA(), data, NOW).campaigns[0]!.artwork[0]!.awaitingProofApproval).toBe(false);
    requirement.proofReference = { proofId: "p1" };
    expect(buildPortalView(idA(), data, NOW).campaigns[0]!.artwork[0]).toMatchObject({ awaitingProofApproval: true, canSubmit: false });
  });
});

describe("portalSubmitArtwork", () => {
  const input = { requirementId: "req-adv-a", versionId: "ver-1", domainEventId: "evt-1", file: { fileId: "f1", fileName: "ad.pdf", contentType: "application/pdf", virusScanStatus: "clean" }, notes: " first draft ", submittedAt: "2026-03-10" };

  it("records a numbered version, moves the requirement to submitted, and emits an event", async () => {
    const data = dataset();
    const version = await portalSubmitArtwork(idA(), permissions, noAudit, data, input);
    expect(version).toMatchObject({ versionNumber: 1, status: "received", submittedByUserId: A.user, notes: "first draft", assetReference: { fileId: "f1", fileName: "ad.pdf" } });
    expect(data.artworkRequirements.find((entry) => entry.id === "req-adv-a")!.status).toBe("submitted");
    expect(data.domainEvents.map((event) => event.eventType)).toContain("advertiser.artwork.submitted");
    // Not resubmittable while it is being reviewed.
    await expect(portalSubmitArtwork(idA(), permissions, noAudit, data, { ...input, versionId: "ver-2", domainEventId: "evt-2" })).rejects.toBeInstanceOf(PortalStateError);
  });

  it("numbers revisions after changes were requested", async () => {
    const data = dataset();
    await portalSubmitArtwork(idA(), permissions, noAudit, data, input);
    data.artworkRequirements.find((entry) => entry.id === "req-adv-a")!.status = "changes_requested";
    expect((await portalSubmitArtwork(idA(), permissions, noAudit, data, { ...input, versionId: "ver-2", domainEventId: "evt-2" })).versionNumber).toBe(2);
  });

  it("refuses files that have not passed the scan, and another advertiser's requirement (same error as a missing one)", async () => {
    await expect(portalSubmitArtwork(idA(), permissions, noAudit, dataset(), { ...input, file: { ...input.file, virusScanStatus: "pending" } })).rejects.toThrow(/security scan/);
    await expect(portalSubmitArtwork(idA(), permissions, noAudit, dataset(), { ...input, requirementId: "req-adv-b" })).rejects.toThrow("Artwork requirement not found.");
    await expect(portalSubmitArtwork(idA(), permissions, noAudit, dataset(), { ...input, requirementId: "nope" })).rejects.toThrow("Artwork requirement not found.");
  });

  it("the domain itself now refuses an advertiser-organisation actor on another advertiser's records", async () => {
    const data = dataset();
    const version = { id: "v", artworkRequirementId: "req-adv-b", versionNumber: 1, assetReference: {}, status: "received" } as never;
    await expect(submitArtworkVersion({ userId: A.user, organisationId: A.org }, permissions, noAudit, data, "req-adv-b", version, "e")).rejects.toThrow(/outside your organisation/);
  });
});

describe("portalRespondToProof", () => {
  function inReview() {
    const data = dataset();
    const requirement = data.artworkRequirements.find((entry) => entry.advertiserId === A.adv)!;
    requirement.status = "in_review";
    requirement.proofReference = { proofId: "p1" };
    return { data, requirement };
  }
  const base = { requirementId: "req-adv-a", actorDate: "2026-03-10", domainEventId: "evt-p" };

  it("approves or requests changes, stamping the advertiser's approval", async () => {
    const approved = inReview();
    await portalRespondToProof(idA(), permissions, noAudit, approved.data, { ...base, decision: "approved" });
    expect(approved.requirement).toMatchObject({ status: "approved", advertiserApprovedAt: "2026-03-10" });

    const changes = inReview();
    await portalRespondToProof(idA(), permissions, noAudit, changes.data, { ...base, decision: "changes_requested" });
    expect(changes.requirement.status).toBe("changes_requested");
  });

  it("can never grant production approval, only the two advertiser outcomes", async () => {
    const { data, requirement } = inReview();
    await expect(portalRespondToProof(idA(), permissions, noAudit, data, { ...base, decision: "production_ready" as never })).rejects.toBeInstanceOf(PortalStateError);
    expect(requirement.status).toBe("in_review");
    expect(requirement.productionApprovedAt).toBeUndefined();
  });

  it("requires an issued proof, and refuses other advertisers' requirements", async () => {
    await expect(portalRespondToProof(idA(), permissions, noAudit, dataset(), { ...base, decision: "approved" })).rejects.toThrow(/no proof waiting/);
    const { data } = inReview();
    await expect(portalRespondToProof(idA(), permissions, noAudit, data, { ...base, requirementId: "req-adv-b", decision: "approved" })).rejects.toThrow("Artwork requirement not found.");
  });
});

describe("portalRespondToProposal", () => {
  const ids = () => ({ acceptanceId: crypto.randomUUID(), bookingId: crypto.randomUUID(), domainEventId: crypto.randomUUID() });
  const base = { proposalId: "prop-a1", respondedAt: "2026-03-10", requestMetadata: { ip: "203.0.113.9" } };

  it("accepting creates the booking, items and production requests with real UUIDs, once", async () => {
    const data = dataset();
    const first = await portalRespondToProposal(idA(), permissions, noAudit, data, { ...base, response: "accepted", ids: ids() });
    expect(first).toMatchObject({ status: "accepted", acceptedByContactId: A.contact, requestMetadata: { via: "advertiser_portal" } });
    const booking = data.bookings.find((entry) => entry.proposalId === "prop-a1")!;
    expect(booking).toMatchObject({ status: "booked", advertiserId: A.adv });
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const newItems = data.bookingItems.filter((entry) => entry.bookingId === booking.id);
    expect(newItems).toHaveLength(1);
    expect(newItems.every((entry) => uuid.test(entry.id))).toBe(true);
    expect(data.productionRequests.filter((entry) => entry.bookingId === booking.id).every((entry) => uuid.test(entry.id))).toBe(true);
    expect(data.proposals.find((entry) => entry.id === "prop-a1")!.status).toBe("accepted");

    // Same response again is a no-op.
    const again = await portalRespondToProposal(idA(), permissions, noAudit, data, { ...base, response: "accepted", ids: ids() });
    expect(again.id).toBe(first.id);
    expect(data.bookings.filter((entry) => entry.proposalId === "prop-a1")).toHaveLength(1);
  });

  it("declining or asking for changes records the response without a booking", async () => {
    const declined = dataset();
    expect(await portalRespondToProposal(idA(), permissions, noAudit, declined, { ...base, response: "rejected", ids: ids() })).toMatchObject({ status: "rejected" });
    expect(declined.proposals.find((entry) => entry.id === "prop-a1")!.status).toBe("rejected");
    const changes = dataset();
    expect(await portalRespondToProposal(idA(), permissions, noAudit, changes, { ...base, response: "change_requested", ids: ids() })).toMatchObject({ status: "change_requested" });
    expect(changes.bookings.some((entry) => entry.proposalId === "prop-a1")).toBe(false);
  });

  it("refuses another advertiser's proposal, expired proposals, and logins not linked to a contact", async () => {
    await expect(portalRespondToProposal(idA(), permissions, noAudit, dataset(), { ...base, proposalId: "prop-b1", response: "accepted", ids: ids() })).rejects.toThrow("Proposal not found.");
    await expect(portalRespondToProposal(idA(), permissions, noAudit, dataset(), { ...base, proposalId: "prop-a-expired", response: "accepted", ids: ids() })).rejects.toThrow(/Expired/);
    const unlinked = dataset();
    unlinked.contacts.find((entry) => entry.id === A.contact)!.userId = null;
    await expect(portalRespondToProposal(idA(), permissions, noAudit, unlinked, { ...base, response: "accepted", ids: ids() })).rejects.toThrow(/not linked to a contact/);
    const noTerms = dataset();
    noTerms.terms = [];
    await expect(portalRespondToProposal(idA(), permissions, noAudit, noTerms, { ...base, response: "accepted", ids: ids() })).rejects.toThrow(/approved terms/);
  });

  it("is blocked at the permission layer for a user without the grants", async () => {
    const none: PermissionData = { roleAssignments: [], rolePermissions: [] };
    const spy = vi.fn();
    await expect(portalRespondToProposal(idA(), none, { record: spy as never }, dataset(), { ...base, response: "accepted", ids: ids() })).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
