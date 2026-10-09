import { randomUUID } from "node:crypto";
import {
  advertiserDomainEvents, advertiserProposalAcceptances, artworkRequirements, artworkVersions, auditEvents, commercialBookingItems, commercialBookings, commercialProductionRequests, commercialProposals, createDb, fileReferences,
  fixtureIds, inventoryReservations, inventorySlots, webhookEventClaims
} from "@raring2go/db";
import { signSignWellEvent } from "@raring2go/integrations";
import { createMemoryScannerProvider } from "@raring2go/storage";
import type { StorageProvider } from "@raring2go/storage";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { acceptProposalForSignature, acceptanceContent, advertiserSigningEnabled } from "./advertiser-signing";
import { withFinanceGuardsDisabled } from "./finance-test-support";
import type { FileProviders } from "./franchise-files";
import { readPortal } from "./portal-runtime";
import { processSignWellWebhook } from "./signwell-runtime";

describe("advertiser signing content", () => {
  it("lays out who, what, the total and the terms, and is on only when SignWell is configured and not switched off", () => {
    const content = acceptanceContent({
      advertiserName: "Example Advertiser", contactName: "Alex Example", reference: "Acceptance a1", termsTitle: "Standard terms",
      snapshot: { proposal: { title: "Autumn campaign", totalValueMinor: 52500, currency: "GBP", validUntil: "2026-12-31", version: 2 }, items: [{ description: "Full page advert", quantity: 1, totalPriceMinor: 52500, currency: "GBP" }] },
      termsContent: { title: "Standard terms", body: "Payment within 30 days." }
    });
    const text = content.paragraphs.map((paragraph) => `${paragraph.heading ?? ""}\n${paragraph.text}`).join("\n");
    expect(content.title).toBe("Proposal acceptance: Autumn campaign");
    for (const expected of ["Example Advertiser", "Alex Example", "Full page advert", "GBP 525.00", "2026-12-31", "Payment within 30 days.", "booking is confirmed only once your signature"]) expect(text).toContain(expected);
    expect(advertiserSigningEnabled({})).toBe(false);
    expect(advertiserSigningEnabled({ SIGNWELL_API_KEY: "k" })).toBe(true);
    expect(advertiserSigningEnabled({ SIGNWELL_API_KEY: "k", SIGNWELL_ADVERTISER_ACCEPTANCE: "off" })).toBe(false);
  });
});

/** Real database: an advertiser signs a proposal with SignWell, and the booking is made only once SignWell confirms it. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("advertiser signing (postgres)", () => {
  const advertiser = { userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser };
  const PROPOSAL = "00000000-0000-4000-8000-000000000716";
  const SLOT = "00000000-0000-4000-8000-000000000715";
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const HOOK = `hook-${tag}`;
  const now = Math.floor(Date.now() / 1000);
  let originalValidUntil: Date | null = null;
  let docCounter = 0;
  let failCreate = false;
  const docs = new Map<string, { status: string; metadata: Record<string, string>; recipients: Array<{ id: string; email: string; name: string }> }>();
  const created: Array<{ id: string; body: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const objects = new Map<string, Uint8Array>();

  const storage: StorageProvider = {
    key: "memory",
    async createUploadIntent(reference) { return { reference: { ...reference, providerKey: "memory" }, uploadUrl: `memory://upload/${reference.storageKey}`, headers: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() }; },
    async createDownloadIntent(reference, input) { return { reference, downloadUrl: `memory://download/${reference.storageKey}`, expiresAt: new Date(Date.now() + 300_000).toISOString(), disposition: input?.disposition ?? "attachment" }; },
    async deleteObject(reference) { objects.delete(reference.storageKey); return reference; }
  };
  const providers: FileProviders = {
    storage,
    scanner: createMemoryScannerProvider({ status: "clean" }),
    fetch: (async (url: string | URL, init?: RequestInit) => { objects.set(String(url).replace("memory://upload/", ""), new Uint8Array(init?.body as Buffer)); return new Response(null, { status: 200 }); }) as typeof fetch
  };

  const fakeSignWell = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname.startsWith("/signed/")) return new Response(new TextEncoder().encode(`%PDF-1.4\n${url.pathname}\n%%EOF`), { status: 200 });
    if (method === "POST" && url.pathname === "/api/v1/documents") {
      if (failCreate) return json({ errors: { recipients: ["invalid"] } }, 422);
      docCounter += 1;
      const id = `doc-${tag}-${docCounter}`;
      const body = JSON.parse(String(init?.body));
      docs.set(id, { status: "Sent", metadata: body.metadata, recipients: body.recipients });
      created.push({ id, body });
      return json({ id, status: "Sent", metadata: body.metadata, recipients: body.recipients.map((recipient: { id: string }) => ({ ...recipient, status: "sent", signing_url: `https://www.signwell.com/sign/${id}/${recipient.id}` })) }, 201);
    }
    const match = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)(\/completed_pdf)?$/);
    const doc = match ? docs.get(match[1]!) : undefined;
    if (match && !doc) return json({ error: "record_not_found" }, 404);
    if (match && doc && match[2]) return json({ file_url: `https://www.signwell.com/signed/${match[1]}-${url.searchParams.get("audit_page")}.pdf` });
    if (match && doc) return json({ id: match[1], status: doc.status, metadata: doc.metadata, recipients: doc.recipients.map((recipient) => ({ ...recipient, status: "sent", signing_url: `https://www.signwell.com/sign/${match[1]}/${recipient.id}` })) });
    return json({ error: "record_not_found" }, 404);
  }) as unknown as typeof fetch;

  const event = (type: string, id: string, time = String(now), hook = HOOK) => JSON.stringify({ event: { type, time, hash: signSignWellEvent(hook, type, time) }, data: { object: { id } } });
  const send = (raw: string) => processSignWellWebhook(raw, { fetch: fakeSignWell, providers, hosts: ["www.signwell.com"], webhookIds: [HOOK], nowSeconds: now });
  const acceptances = () => db.select().from(advertiserProposalAcceptances).where(eq(advertiserProposalAcceptances.proposalId, PROPOSAL));
  const bookings = () => db.select().from(commercialBookings).where(eq(commercialBookings.proposalId, PROPOSAL));
  const portalProposal = async () => (await readPortal(advertiser)).view.proposals.find((entry) => entry.id === PROPOSAL)!;

  beforeAll(async () => {
    vi.stubEnv("SIGNWELL_API_KEY", "sw_key");
    vi.stubEnv("ESIGN_WEBHOOK_SECRET", `secret-${tag}`);
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubGlobal("fetch", fakeSignWell);
    const [row] = await db.select().from(commercialProposals).where(eq(commercialProposals.id, PROPOSAL));
    originalValidUntil = row!.validUntil;
    await db.update(commercialProposals).set({ validUntil: new Date("2099-12-31") }).where(eq(commercialProposals.id, PROPOSAL));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await withFinanceGuardsDisabled(db, async () => {
      const own = await bookings();
      const bookingIds = own.map((booking) => booking.id);
      const files = (await acceptances()).map((acceptance) => (acceptance.providerMetadata as { signedFileId?: string }).signedFileId).filter((id): id is string => Boolean(id));
      await db.delete(advertiserProposalAcceptances).where(eq(advertiserProposalAcceptances.proposalId, PROPOSAL));
      if (bookingIds.length > 0) {
        const requirements = await db.select({ id: artworkRequirements.id }).from(artworkRequirements).where(eq(artworkRequirements.advertiserId, fixtureIds.advertisers.example));
        if (requirements.length > 0) {
          await db.delete(artworkVersions).where(inArray(artworkVersions.artworkRequirementId, requirements.map((entry) => entry.id)));
          await db.delete(artworkRequirements).where(inArray(artworkRequirements.id, requirements.map((entry) => entry.id)));
        }
        await db.delete(commercialProductionRequests).where(inArray(commercialProductionRequests.bookingId, bookingIds));
        await db.delete(commercialBookingItems).where(inArray(commercialBookingItems.bookingId, bookingIds));
        await db.delete(commercialBookings).where(inArray(commercialBookings.id, bookingIds));
      }
      await db.delete(inventoryReservations).where(eq(inventoryReservations.inventorySlotId, SLOT));
      await db.delete(advertiserDomainEvents).where(inArray(advertiserDomainEvents.eventType, ["advertiser.proposal.accepted", "advertiser.booking.confirmed", "advertiser.artwork.requested"]));
      await db.update(commercialProposals).set({ status: "sent", acceptedOn: null, validUntil: originalValidUntil }).where(eq(commercialProposals.id, PROPOSAL));
      await db.update(inventorySlots).set({ status: "available" }).where(eq(inventorySlots.id, SLOT));
      await db.delete(webhookEventClaims).where(like(webhookEventClaims.eventId, `doc-${tag}%`));
      await db.delete(auditEvents).where(and(like(auditEvents.action, "advertiser.acceptance.%")));
      void files;
    });
    // Signed copies of acceptances are file references the test created.
    await db.delete(fileReferences).where(like(fileReferences.fileName, "signed-acceptance-%"));
    await sql.end();
  });

  it("holds the acceptance as pending a signature and sends the advertiser's contact a document, booking nothing yet; repeating resumes the same document", async () => {
    expect((await portalProposal()).canRespond).toBe(true);
    const first = await acceptProposalForSignature(advertiser, PROPOSAL, { fetch: fakeSignWell });
    expect(first).toMatchObject({ resumed: false, signingUrl: expect.stringContaining("https://www.signwell.com/sign/") });

    expect(created).toHaveLength(1);
    expect(created[0]!.body).toMatchObject({ with_signature_page: true, test_mode: true, metadata: { proposal_id: PROPOSAL, acceptance_id: first.acceptanceId }, redirect_url: "https://app.example.test/app/portal?result=signing_returned" });
    expect(created[0]!.body.recipients).toHaveLength(1);
    expect(new TextDecoder().decode(Buffer.from(created[0]!.body.files[0].file_base64, "base64").subarray(0, 5))).toBe("%PDF-");

    const [acceptance] = await acceptances();
    expect(acceptance).toMatchObject({ status: "pending_signature", method: "signature_required", bookingId: null, acceptedAt: null });
    expect((acceptance!.providerMetadata as { documentId: string }).documentId).toBe(created[0]!.id);
    expect(await bookings()).toHaveLength(0);
    expect((await portalProposal())).toMatchObject({ canRespond: false, awaitingSignature: true });

    const again = await acceptProposalForSignature(advertiser, PROPOSAL, { fetch: fakeSignWell });
    expect(again).toMatchObject({ resumed: true, acceptanceId: first.acceptanceId, signingUrl: first.signingUrl });
    expect(created).toHaveLength(1);
  });

  it("does not book on an unconfirmed completion, and an expired signing lapses so the advertiser can try again", async () => {
    const attempt1 = created[0]!.id;
    await expect(send(event("document_completed", attempt1, String(now)))).rejects.toThrow(/not completed yet/);
    expect(await bookings()).toHaveLength(0);

    docs.get(attempt1)!.status = "Expired";
    await expect(send(event("document_expired", attempt1, String(now + 1)))).resolves.toMatchObject({ outcome: "processed" });
    expect((await acceptances())[0]).toMatchObject({ status: "signature_lapsed" });
    expect(await portalProposal()).toMatchObject({ canRespond: true, awaitingSignature: false });
  });

  it("lapses an acceptance whose document could not be sent, so nothing is stuck waiting", async () => {
    failCreate = true;
    await expect(acceptProposalForSignature(advertiser, PROPOSAL, { fetch: fakeSignWell })).rejects.toThrow(/SignWell/);
    failCreate = false;
    const rows = await acceptances();
    expect(rows.filter((row) => row.status === "pending_signature")).toHaveLength(0);
    expect(await portalProposal()).toMatchObject({ canRespond: true });
  });

  it("records a signature it cannot book (proposal expired meanwhile) with the signed copy, for a person to follow up", async () => {
    await acceptProposalForSignature(advertiser, PROPOSAL, { fetch: fakeSignWell });
    const doc = created.at(-1)!.id;
    await db.update(commercialProposals).set({ validUntil: new Date("2000-01-01") }).where(eq(commercialProposals.id, PROPOSAL));
    docs.get(doc)!.status = "Completed";
    await expect(send(event("document_completed", doc, String(now + 2)))).resolves.toMatchObject({ outcome: "processed", reason: "signed_not_booked" });
    await db.update(commercialProposals).set({ validUntil: new Date("2099-12-31") }).where(eq(commercialProposals.id, PROPOSAL));

    const closed = (await acceptances()).find((row) => (row.providerMetadata as { documentId?: string }).documentId === doc)!;
    expect(closed).toMatchObject({ status: "signature_lapsed", bookingId: null });
    expect(closed.providerMetadata).toMatchObject({ signed: true, needsFollowUp: true, signedFileId: expect.any(String) });
    expect(await bookings()).toHaveLength(0);
  });

  it("books exactly once, files the signed copy, and ignores a replay, when SignWell confirms the signature", async () => {
    await acceptProposalForSignature(advertiser, PROPOSAL, { fetch: fakeSignWell });
    const doc = created.at(-1)!.id;
    docs.get(doc)!.status = "Completed";
    const completed = event("document_completed", doc, String(now + 3));
    await expect(send(completed)).resolves.toMatchObject({ outcome: "processed" });
    await expect(send(completed)).resolves.toMatchObject({ outcome: "duplicate" });

    const accepted = (await acceptances()).find((row) => row.status === "accepted")!;
    expect(accepted).toMatchObject({ method: "signature_required", acceptedByContactId: fixtureIds.advertiserContacts.examplePrimary });
    expect(accepted.bookingId).toBeTruthy();
    expect(accepted.acceptedAt).toBeTruthy();
    expect(await bookings()).toHaveLength(1);
    expect(accepted.providerMetadata).toMatchObject({ signed: true, signedFileId: expect.any(String), signedSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const [file] = await db.select().from(fileReferences).where(eq(fileReferences.id, (accepted.providerMetadata as { signedFileId: string }).signedFileId));
    expect(file).toMatchObject({ virusScanStatus: "clean", accessScope: "territory" });
    const [proposal] = await db.select().from(commercialProposals).where(eq(commercialProposals.id, PROPOSAL));
    expect(proposal).toMatchObject({ status: "accepted" });
    expect((await db.select().from(inventorySlots).where(eq(inventorySlots.id, SLOT)))[0]!.status).toBe("reserved");
    // The database already refuses to alter an accepted acceptance (migration 0049).
    expect((await portalProposal())).toMatchObject({ canRespond: false, awaitingSignature: false, response: "accepted" });
  });
});
