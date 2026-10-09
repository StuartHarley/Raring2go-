import { withFinanceGuardsDisabled } from "./finance-test-support";
import {
  advertiserDomainEvents, advertiserProposalAcceptances, artworkRequirements, artworkVersions, commercialBookingItems, commercialBookings, commercialProductionRequests,
  commercialProposals, createDb, fixtureIds, inventoryReservations, inventorySlots
} from "@raring2go/db";
import { loadAdvertisingData, persistAdvertisingChanges, snapshotAdvertisingData, updateArtworkStatus } from "@raring2go/advertising";
import type { PermissionData } from "@raring2go/permissions";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// File storage needs a running app for the development upload URL, so the upload step is
// stubbed; everything after it (domain rules, persistence, scoping) is real.
const uploads: Array<{ fileName: string }> = [];
vi.mock("./files-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./files-runtime")>()),
  uploadAdvertiserArtwork: vi.fn(async (_context: unknown, input: { fileName: string; contentType: string }) => {
    uploads.push({ fileName: input.fileName });
    return { fileId: crypto.randomUUID(), fileName: input.fileName, contentType: input.contentType, virusScanStatus: "clean" as const };
  })
}));

const { readPortal, respondToProofAsAdvertiser, respondToProposalAsAdvertiser, submitArtworkAsAdvertiser } = await import("./portal-runtime");

const advertiser = { userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser };
const staff = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const PROPOSAL = "00000000-0000-4000-8000-000000000716";
const SLOT = "00000000-0000-4000-8000-000000000715";

const staffPermissions: PermissionData = {
  roleAssignments: [{ id: "s1", userId: staff.userId, roleId: "r", organisationId: staff.organisationId }],
  rolePermissions: ["manage", "approve"].map((action) => ({ roleId: "r", permission: { id: action, module: "advertiser.artwork", action }, scope: "network" }))
};
const noAudit = { record: async () => undefined };

async function staffDo(work: (data: Awaited<ReturnType<typeof loadAdvertisingData>>) => Promise<unknown>) {
  const { db, sql } = createDb();
  try {
    await db.transaction(async (tx) => {
      const data = await loadAdvertisingData(tx);
      const before = snapshotAdvertisingData(data);
      await work(data);
      await persistAdvertisingChanges(tx, before, data);
    });
  } finally {
    await sql.end();
  }
}

describe("advertiser portal against the real database", () => {
  let originalValidUntil: Date | null = null;

  beforeAll(async () => {
    // The seeded proposal's validity date lapses with real time; keep it open for the test only.
    const { db, sql } = createDb();
    const [row] = await db.select().from(commercialProposals).where(eq(commercialProposals.id, PROPOSAL));
    originalValidUntil = row!.validUntil;
    await db.update(commercialProposals).set({ validUntil: new Date("2099-12-31") }).where(eq(commercialProposals.id, PROPOSAL));
    await sql.end();
  });

  afterAll(async () => {
    const { db, sql } = createDb();
    await withFinanceGuardsDisabled(db, async () => {

    const bookings = await db.select({ id: commercialBookings.id }).from(commercialBookings).where(eq(commercialBookings.proposalId, PROPOSAL));
    const bookingIds = bookings.map((booking) => booking.id);
    await db.delete(advertiserProposalAcceptances).where(eq(advertiserProposalAcceptances.proposalId, PROPOSAL));
    if (bookingIds.length > 0) {
      const requirements = await db.select({ id: artworkRequirements.id }).from(artworkRequirements).where(inArray(artworkRequirements.advertiserId, [fixtureIds.advertisers.example]));
      if (requirements.length > 0) {
        await db.delete(artworkVersions).where(inArray(artworkVersions.artworkRequirementId, requirements.map((entry) => entry.id)));
        await db.delete(artworkRequirements).where(inArray(artworkRequirements.id, requirements.map((entry) => entry.id)));
      }
      await db.delete(commercialProductionRequests).where(inArray(commercialProductionRequests.bookingId, bookingIds));
      await db.delete(commercialBookingItems).where(inArray(commercialBookingItems.bookingId, bookingIds));
      await db.delete(commercialBookings).where(inArray(commercialBookings.id, bookingIds));
    }
    await db.delete(inventoryReservations).where(eq(inventoryReservations.inventorySlotId, SLOT));
    await db.delete(advertiserProposalAcceptances).where(eq(advertiserProposalAcceptances.proposalId, PROPOSAL));
    await db.delete(advertiserDomainEvents).where(inArray(advertiserDomainEvents.eventType, ["advertiser.proposal.accepted", "advertiser.booking.confirmed", "advertiser.artwork.requested", "advertiser.artwork.submitted", "advertiser.artwork.proof_issued", "advertiser.artwork.proof_approved"]));
    await db.update(commercialProposals).set({ status: "sent", acceptedOn: null, validUntil: originalValidUntil }).where(eq(commercialProposals.id, PROPOSAL));
    await db.update(inventorySlots).set({ status: "available" }).where(eq(inventorySlots.id, SLOT));
    });
    await sql.end();
  });

  it("shows an advertiser only their own account, and refuses any other organisation outright", async () => {
    const { view, identity } = await readPortal(advertiser);
    expect(identity.advertiserIds).toEqual([fixtureIds.advertisers.example]);
    const proposal = view.proposals.find((entry) => entry.id === PROPOSAL)!;
    expect(proposal).toMatchObject({ status: "sent", canRespond: true });
    expect(view.campaigns).toEqual([]);
    expect(view.needsAction.map((entry) => entry.kind)).toContain("proposal");

    await expect(readPortal({ userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise })).rejects.toThrow(/No permission grant|not linked to an advertiser/);
    await expect(readPortal({ userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq })).rejects.toThrow(/No permission grant|not linked to an advertiser/);
  });

  it("accepting a proposal persists the acceptance, booking, items, reservation and production request, exactly once", async () => {
    const first = await respondToProposalAsAdvertiser(advertiser, { proposalId: PROPOSAL, response: "accepted" });
    expect(first).toMatchObject({ status: "accepted", acceptedByContactId: fixtureIds.advertiserContacts.examplePrimary });

    const { db, sql } = createDb();
    const [proposal] = await db.select().from(commercialProposals).where(eq(commercialProposals.id, PROPOSAL));
    const bookings = await db.select().from(commercialBookings).where(eq(commercialBookings.proposalId, PROPOSAL));
    const items = await db.select().from(commercialBookingItems).where(eq(commercialBookingItems.bookingId, bookings[0]!.id));
    const requests = await db.select().from(commercialProductionRequests).where(eq(commercialProductionRequests.bookingId, bookings[0]!.id));
    const [slot] = await db.select().from(inventorySlots).where(eq(inventorySlots.id, SLOT));
    await sql.end();
    expect(proposal).toMatchObject({ status: "accepted" });
    expect(bookings).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(slot!.status).toBe("reserved");

    // Repeating the same response (a double-click, a retry) returns the original and creates nothing more.
    expect((await respondToProposalAsAdvertiser(advertiser, { proposalId: PROPOSAL, response: "accepted" })).id).toBe(first.id);
    // A different answer to an already-answered proposal is refused.
    await expect(respondToProposalAsAdvertiser(advertiser, { proposalId: PROPOSAL, response: "rejected" })).rejects.toThrow(/already has an acceptance|Only sent proposals/);
    const view = (await readPortal(advertiser)).view;
    expect(view.campaigns).toHaveLength(1);
    expect(view.proposals.find((entry) => entry.id === PROPOSAL)).toMatchObject({ canRespond: false, response: "accepted" });
  });

  it("takes artwork through submission, a staff-issued proof, and the advertiser's approval", async () => {
    // Booking has already requested the artwork (the handoff to production); staff add the specification.
    await staffDo(async (data) => {
      const request = data.productionRequests.find((entry) => entry.advertiserId === fixtureIds.advertisers.example)!;
      const requirement = data.artworkRequirements.find((entry) => entry.productionRequestId === request.id)!;
      requirement.dimensions = { width: 210, height: 297 };
      requirement.deadline = "2099-01-01";
    });

    const requirementId = (await readPortal(advertiser)).view.campaigns[0]!.artwork[0]!.requirementId;
    expect((await readPortal(advertiser)).view.campaigns[0]!.artwork[0]).toMatchObject({ status: "requested", canSubmit: true });

    const version = await submitArtworkAsAdvertiser(advertiser, { requirementId, fileName: "advert.pdf", contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]), notes: "First draft" });
    expect(version).toMatchObject({ versionNumber: 1, status: "received", submittedByUserId: advertiser.userId });
    expect(uploads).toEqual([{ fileName: "advert.pdf" }]);
    const submitted = (await readPortal(advertiser)).view.campaigns[0]!.artwork[0]!;
    expect(submitted).toMatchObject({ status: "submitted", canSubmit: false });
    expect(submitted.versions[0]).toMatchObject({ fileName: "advert.pdf", notes: "First draft" });

    // A refused request must not store a file: another submission while under review is rejected before upload.
    await expect(submitArtworkAsAdvertiser(advertiser, { requirementId, fileName: "again.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) })).rejects.toThrow(/cannot be sent/);
    expect(uploads).toHaveLength(1);

    // Approving before any proof exists is refused.
    await expect(respondToProofAsAdvertiser(advertiser, { requirementId, decision: "approved" })).rejects.toThrow(/no proof waiting/);

    // Staff issue the proof; the advertiser approves it.
    await staffDo(async (data) => {
      await updateArtworkStatus(staff, staffPermissions, noAudit, data, requirementId, { status: "in_review", approvedVersionId: version.id, proofReference: { proofId: "proof-1" }, actorDate: "2026-03-10", domainEventId: crypto.randomUUID() });
    });
    expect((await readPortal(advertiser)).view.needsAction.map((entry) => entry.kind)).toContain("proof");
    await respondToProofAsAdvertiser(advertiser, { requirementId, decision: "approved" });

    const { db, sql } = createDb();
    const [requirement] = await db.select().from(artworkRequirements).where(eq(artworkRequirements.id, requirementId));
    await sql.end();
    expect(requirement).toMatchObject({ status: "approved" });
    expect(requirement!.advertiserApprovedAt).not.toBeNull();
    expect((await readPortal(advertiser)).view.campaigns[0]!.artwork[0]).toMatchObject({ status: "approved", awaitingProofApproval: false, canSubmit: false });
  });

  it("does not trust membership alone: a staff fixture that is a member of the advertiser organisation still has no portal access", async () => {
    const member = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.advertiser };
    await expect(readPortal(member)).rejects.toThrow();
    await expect(respondToProposalAsAdvertiser(member, { proposalId: PROPOSAL, response: "accepted" })).rejects.toThrow();
    await expect(respondToProofAsAdvertiser(member, { requirementId: crypto.randomUUID(), decision: "approved" })).rejects.toThrow();
    await expect(submitArtworkAsAdvertiser(member, { requirementId: crypto.randomUUID(), fileName: "x.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) })).rejects.toThrow();
    expect(uploads.length).toBeLessThanOrEqual(1);
  });

  it("refuses every action from a user who is not an advertiser", async () => {
    const outsider = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise };
    await expect(respondToProposalAsAdvertiser(outsider, { proposalId: PROPOSAL, response: "rejected" })).rejects.toThrow(/No permission grant|not linked to an advertiser/);
    await expect(respondToProofAsAdvertiser(outsider, { requirementId: crypto.randomUUID(), decision: "approved" })).rejects.toThrow(/No permission grant|not linked to an advertiser/);
    await expect(submitArtworkAsAdvertiser(outsider, { requirementId: crypto.randomUUID(), fileName: "x.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) })).rejects.toThrow(/No permission grant|not linked to an advertiser/);
  });
});
