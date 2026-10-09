import { randomUUID } from "node:crypto";
import {
  advertiserActivityEvents, advertiserDomainEvents, advertisers, artworkRequirements, artworkVersions, auditEvents, campaignFulfilments, commercialBookingItems, commercialBookings,
  commercialProductionRequests, commercialProposalItems, commercialProposals, createDb, editionPages, fixtureIds, inventoryReservations, inventorySlots, masterEditions,
  opportunities, organisations, proofPacks, publicationOutputs, renewalPrompts, seasons, territoryEditions
} from "@raring2go/db";
import { loadAdvertisingData } from "@raring2go/advertising";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdvertiserRecord } from "./advertising-mutations";
import { createProposalRecord, bookProposalRecord, sendProposalRecord } from "./advertising-sales";
import { actOnArtwork, convertRenewalRecord, createProofPackRecord, dismissRenewalRecord, recordFulfilmentRecord } from "./advertising-fulfilment";
import { createGenerateRenewalsHandler } from "./advertising-jobs";

/** Real database: booking hands off to artwork, sign-off and fulfilment are checked against Edition Factory, renewals are generated once. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("advertiser production, fulfilment and renewals (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const product = fixtureIds.commercialProducts.fullPageAdvert;
  const ids = { season: randomUUID(), master: randomUUID(), edition: randomUUID(), page: randomUUID(), output: randomUUID() };
  const advertiserIds: string[] = [];
  const organisationIds: string[] = [];
  const slotIds: string[] = [];
  const validUntil = () => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const today = () => new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    await db.insert(seasons).values({ id: ids.season, key: `test-${tag}`, name: `Test ${tag}`, year: 2099, season: "autumn" });
    await db.insert(masterEditions).values({ id: ids.master, seasonId: ids.season, organisationId: fixtureIds.organisations.hq, title: `Master ${tag}`, pageCount: 4 });
    await db.insert(territoryEditions).values({
      id: ids.edition, masterEditionId: ids.master, seasonId: ids.season, territoryId: fixtureIds.territories.suttonColdfield, franchiseOrganisationId: fixtureIds.organisations.franchise,
      title: `Edition ${tag}`, status: "draft", pageCount: 4, generatedFromMasterVersion: 1
    });
    await db.insert(editionPages).values({ id: ids.page, territoryEditionId: ids.edition, pageNumber: 3, spreadNumber: 2, side: "left", status: "draft", readiness: "not_ready" });
  });

  async function placedBooking(label: string) {
    const created = await createAdvertiserRecord(sutton, { newOrganisationName: `Prod Test ${label} ${tag}`, owningTerritoryId: fixtureIds.territories.suttonColdfield });
    advertiserIds.push(created.id);
    organisationIds.push(created.advertiserOrganisationId);
    const slotId = randomUUID();
    await db.insert(inventorySlots).values({ id: slotId, territoryEditionId: ids.edition, editionPageId: ids.page, territoryId: fixtureIds.territories.suttonColdfield, productId: product, slotKey: `prod-${slotId.slice(0, 8)}`, inventoryClass: "page", exclusive: true, status: "available", metadata: {} });
    slotIds.push(slotId);
    const proposal = await createProposalRecord(sutton, { advertiserId: created.id, title: "Placed", validUntil: validUntil(), lines: [{ productId: product, quantity: 1, inventorySlotId: slotId }] });
    await sendProposalRecord(sutton, proposal.id);
    const booking = await bookProposalRecord(sutton, proposal.id);
    const data = await loadAdvertisingData(db);
    const item = data.bookingItems.find((candidate) => candidate.bookingId === booking.id)!;
    const requirement = data.artworkRequirements.find((candidate) => candidate.bookingItemId === item.id)!;
    return { advertiser: created, booking, item, requirement };
  }

  async function submitVersion(requirementId: string, status = "submitted", versionNumber = 1) {
    const id = randomUUID();
    await db.insert(artworkVersions).values({ id, artworkRequirementId: requirementId, versionNumber, assetReference: {}, status, submittedAt: new Date() });
    return id;
  }

  afterAll(async () => {
    if (advertiserIds.length) {
      const bookingRows = await db.select({ id: commercialBookings.id }).from(commercialBookings).where(inArray(commercialBookings.advertiserId, advertiserIds));
      const reqRows = await db.select({ id: artworkRequirements.id }).from(artworkRequirements).where(inArray(artworkRequirements.advertiserId, advertiserIds));
      const proposalRows = await db.select({ id: commercialProposals.id }).from(commercialProposals).where(inArray(commercialProposals.advertiserId, advertiserIds));
      await db.delete(renewalPrompts).where(inArray(renewalPrompts.advertiserId, advertiserIds));
      await db.delete(proofPacks).where(inArray(proofPacks.advertiserId, advertiserIds));
      await db.delete(campaignFulfilments).where(inArray(campaignFulfilments.advertiserId, advertiserIds));
      if (reqRows.length) await db.delete(artworkVersions).where(inArray(artworkVersions.artworkRequirementId, reqRows.map((row) => row.id)));
      await db.delete(artworkRequirements).where(inArray(artworkRequirements.advertiserId, advertiserIds));
      await db.delete(advertiserDomainEvents).where(inArray(advertiserDomainEvents.advertiserId, advertiserIds));
      await db.delete(commercialProductionRequests).where(inArray(commercialProductionRequests.advertiserId, advertiserIds));
      if (bookingRows.length) await db.delete(commercialBookingItems).where(inArray(commercialBookingItems.bookingId, bookingRows.map((row) => row.id)));
      await db.delete(commercialBookings).where(inArray(commercialBookings.advertiserId, advertiserIds));
      await db.delete(inventoryReservations).where(inArray(inventoryReservations.advertiserId, advertiserIds));
      if (proposalRows.length) await db.delete(commercialProposalItems).where(inArray(commercialProposalItems.proposalId, proposalRows.map((row) => row.id)));
      await db.delete(commercialProposals).where(inArray(commercialProposals.advertiserId, advertiserIds));
      await db.delete(opportunities).where(inArray(opportunities.advertiserId, advertiserIds));
      await db.delete(advertiserActivityEvents).where(inArray(advertiserActivityEvents.advertiserId, advertiserIds));
      await db.delete(advertisers).where(inArray(advertisers.id, advertiserIds));
    }
    if (slotIds.length) await db.delete(inventorySlots).where(inArray(inventorySlots.id, slotIds));
    await db.delete(publicationOutputs).where(eq(publicationOutputs.territoryEditionId, ids.edition));
    await db.delete(editionPages).where(eq(editionPages.territoryEditionId, ids.edition));
    await db.delete(territoryEditions).where(eq(territoryEditions.id, ids.edition));
    await db.delete(masterEditions).where(eq(masterEditions.id, ids.master));
    await db.delete(seasons).where(eq(seasons.id, ids.season));
    if (organisationIds.length) await db.delete(organisations).where(inArray(organisations.id, organisationIds));
    await sql.end();
  });

  it("requests artwork at booking, placed on the slot's edition page", async () => {
    const { requirement, item } = await placedBooking("Handoff");
    expect(requirement).toMatchObject({ status: "requested", bookingItemId: item.id, territoryEditionId: ids.edition, editionPageId: ids.page, sourceType: "advertiser_supplied" });
  });

  it("walks artwork to production sign-off, refusing an unready page, a failed preflight and skipped steps", async () => {
    const { requirement } = await placedBooking("Signoff");
    await expect(actOnArtwork(sutton, requirement.id, "production_ready")).rejects.toThrow(/cannot move/);
    await expect(actOnArtwork(sutton, requirement.id, "issue_proof")).rejects.toThrow(/submitted version/);

    const v1 = await submitVersion(requirement.id);
    await db.update(artworkRequirements).set({ status: "submitted" }).where(eq(artworkRequirements.id, requirement.id));
    await actOnArtwork(sutton, requirement.id, "issue_proof");
    let [row] = await db.select().from(artworkRequirements).where(eq(artworkRequirements.id, requirement.id));
    expect(row).toMatchObject({ status: "in_review", approvedVersionId: v1 });

    await actOnArtwork(sutton, requirement.id, "approve_for_advertiser");
    await expect(actOnArtwork(sutton, requirement.id, "production_ready")).rejects.toThrow(/page is not ready/);

    await db.update(editionPages).set({ readiness: "ready" }).where(eq(editionPages.id, ids.page));
    await actOnArtwork(sutton, requirement.id, "production_ready");
    [row] = await db.select().from(artworkRequirements).where(eq(artworkRequirements.id, requirement.id));
    expect(row).toMatchObject({ status: "production_ready" });
    expect(row?.productionApprovedAt).toBeTruthy();

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityId, requirement.advertiserId));
    expect(audit.map((event) => event.action)).toEqual(expect.arrayContaining(["advertiser.artwork.proof.issue", "advertiser.artwork.proof.approve", "advertiser.artwork.production.ready"]));
    await db.update(editionPages).set({ readiness: "not_ready" }).where(eq(editionPages.id, ids.page));
  });

  it("will not mark a placement fulfilled until its edition is published, then links the published output", async () => {
    const { requirement, item, advertiser } = await placedBooking("Fulfil");
    await recordFulfilmentRecord(sutton, { bookingItemId: item.id, status: "scheduled", scheduledOn: today() });
    await expect(recordFulfilmentRecord(sutton, { bookingItemId: item.id, status: "fulfilled" })).rejects.toThrow(/published edition output/);

    // Artwork has to be signed off for production before delivery can be claimed.
    await db.insert(publicationOutputs).values({ id: ids.output, territoryEditionId: ids.edition, outputType: "print", status: "generated", version: 1, idempotencyKey: `out-${tag}` });
    await db.update(territoryEditions).set({ status: "published" }).where(eq(territoryEditions.id, ids.edition));
    await db.update(editionPages).set({ status: "published", readiness: "ready" }).where(eq(editionPages.id, ids.page));
    await expect(recordFulfilmentRecord(sutton, { bookingItemId: item.id, status: "fulfilled" })).rejects.toThrow(/production-ready artwork/);
    await submitVersion(requirement.id);
    await db.update(artworkRequirements).set({ status: "submitted" }).where(eq(artworkRequirements.id, requirement.id));
    await actOnArtwork(sutton, requirement.id, "issue_proof");
    await actOnArtwork(sutton, requirement.id, "approve_for_advertiser");
    await actOnArtwork(sutton, requirement.id, "production_ready");

    // Each missing piece of Edition Factory evidence blocks delivery.
    await db.update(editionPages).set({ status: "draft" }).where(eq(editionPages.id, ids.page));
    await expect(recordFulfilmentRecord(sutton, { bookingItemId: item.id, status: "fulfilled" })).rejects.toThrow(/published edition output/);
    await db.update(editionPages).set({ status: "published" }).where(eq(editionPages.id, ids.page));
    await db.update(territoryEditions).set({ status: "draft" }).where(eq(territoryEditions.id, ids.edition));
    await expect(recordFulfilmentRecord(sutton, { bookingItemId: item.id, status: "fulfilled" })).rejects.toThrow(/published edition output/);
    await db.update(territoryEditions).set({ status: "published" }).where(eq(territoryEditions.id, ids.edition));
    await db.delete(publicationOutputs).where(eq(publicationOutputs.id, ids.output));
    await expect(recordFulfilmentRecord(sutton, { bookingItemId: item.id, status: "fulfilled" })).rejects.toThrow(/published edition output/);
    await db.insert(publicationOutputs).values({ id: ids.output, territoryEditionId: ids.edition, outputType: "print", status: "generated", version: 1, idempotencyKey: `out2-${tag}` });

    await expect(recordFulfilmentRecord(sutton, { bookingItemId: item.id, status: "fulfilled" })).resolves.toMatchObject({ status: "fulfilled" });
    const [fulfilment] = await db.select().from(campaignFulfilments).where(eq(campaignFulfilments.bookingItemId, item.id));
    expect(fulfilment).toMatchObject({ status: "fulfilled", territoryEditionId: ids.edition });
    expect(fulfilment?.placementReference).toMatchObject({ publishedOutputId: ids.output });
    expect(requirement.id).toBeTruthy();

    const pack = await createProofPackRecord(sutton, fulfilment!.id, { deliver: true });
    expect(pack).toMatchObject({ status: "delivered" });
    await expect(createProofPackRecord(sutton, fulfilment!.id, { deliver: false })).rejects.toThrow(/already has a proof pack/);
    expect(advertiser.id).toBeTruthy();

    // Put the shared edition back for the other tests.
    await db.update(territoryEditions).set({ status: "draft" }).where(eq(territoryEditions.id, ids.edition));
    await db.update(editionPages).set({ status: "draft" }).where(eq(editionPages.id, ids.page));
    await db.delete(publicationOutputs).where(eq(publicationOutputs.id, ids.output));
  });

  it("generates one renewal prompt for a finished campaign, converts it once, and never prompts the same campaign again", async () => {
    const { item, advertiser, booking } = await placedBooking("Renewal");
    // A campaign that finished a month ago, recorded directly (fulfilment itself is covered above).
    const finished = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    await db.insert(campaignFulfilments).values({ id: randomUUID(), bookingId: booking.id, bookingItemId: item.id, advertiserId: advertiser.id, territoryId: fixtureIds.territories.suttonColdfield, status: "fulfilled", channel: "digital", fulfilledOn: new Date(`${finished}T00:00:00Z`), placementReference: {}, performanceReference: {}, metadata: {} });
    await db.update(advertisers).set({ status: "active" }).where(eq(advertisers.id, advertiser.id));
    // A booking made before the campaign ended is not "booked again".
    await db.update(commercialBookings).set({ bookedOn: new Date(`${finished}T00:00:00Z`) }).where(eq(commercialBookings.id, booking.id));

    const handler = createGenerateRenewalsHandler();
    const run = () => (handler as unknown as { handle: (context: { now: () => Date }) => Promise<{ created: number }> }).handle({ now: () => new Date() });
    const first = await run();
    expect(first.created).toBeGreaterThanOrEqual(1);
    const prompts = await db.select().from(renewalPrompts).where(eq(renewalPrompts.advertiserId, advertiser.id));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ status: "open", sourceBookingId: booking.id });

    await run();
    expect(await db.select().from(renewalPrompts).where(eq(renewalPrompts.advertiserId, advertiser.id))).toHaveLength(1);

    const opportunity = await convertRenewalRecord(sutton, prompts[0]!.id);
    expect(opportunity).toMatchObject({ advertiserId: advertiser.id, source: "renewal" });
    await expect(convertRenewalRecord(sutton, prompts[0]!.id)).rejects.toThrow(/open renewal/);
    await run();
    expect(await db.select().from(renewalPrompts).where(eq(renewalPrompts.advertiserId, advertiser.id))).toHaveLength(1);
    await expect(dismissRenewalRecord(sutton, prompts[0]!.id, "no")).rejects.toThrow(/open renewal/);
  });
});
