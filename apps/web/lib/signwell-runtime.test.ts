import { randomUUID } from "node:crypto";
import {
  agreementSignatureEvents, agreementSignatureRequests, agreementSigners, createDb, fileReferences, fixtureIds, franchiseAgreements, franchiseArtifactReferences, franchiseDocumentVersions, franchiseDocuments, franchiseDomainEvents, webhookEventClaims
} from "@raring2go/db";
import { signSignWellEvent } from "@raring2go/integrations";
import { createMemoryScannerProvider } from "@raring2go/storage";
import type { StorageProvider } from "@raring2go/storage";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agreementContentFrom, renderAgreementPdf, toLatin1 } from "./agreement-pdf";
import type { FileProviders } from "./franchise-files";
import { approveCurrentAgreement, generateAgreementForFranchise, sendCurrentAgreementForSignature, submitCurrentAgreement } from "./franchise-runtime";
import { SignWellNotReadyError, SignWellWebhookAuthError, SignWellWebhookMalformedError, processSignWellWebhook, signWellProvider } from "./signwell-runtime";

describe("agreement PDF", () => {
  it("renders a readable PDF from a title, body and sections, across pages, with the reference in the footer", async () => {
    const content = agreementContentFrom({ title: "Raring2go Franchise Agreement", body: "Paragraph one.\n\nParagraph two.", sections: [{ heading: "Term", body: "word ".repeat(2000) }] }, "Agreement ag-1");
    expect(content.paragraphs).toHaveLength(2);
    const bytes = await renderAgreementPdf(content);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it("never fails on awkward text: smart punctuation, symbols outside Latin-1, very long words, empty content", async () => {
    expect(toLatin1("“Quoted” – it’s … £50 ☃ \u0007")).toBe('"Quoted" - it\'s ... £50 ? ');
    const bytes = await renderAgreementPdf({ title: "T’s ☃", reference: "r", paragraphs: [{ text: "x".repeat(500) }, { heading: "H", text: "" }] });
    expect(bytes.length).toBeGreaterThan(500);
    expect((await renderAgreementPdf(agreementContentFrom({}, "empty"))).length).toBeGreaterThan(300);
  });
});

/** Real database: SignWell sends the agreement and its callbacks are confirmed, then applied once. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("SignWell e-signature (postgres)", () => {
  const { db, sql } = createDb();
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const franchiseId = "00000000-0000-4000-8000-000000000901";
  const tag = randomUUID().slice(0, 8);
  const DOC = `doc-${tag}`;
  const HOOK = `hook-${tag}`;
  const now = Math.floor(Date.now() / 1000);
  let agreementId = "";
  let requestId = "";
  let franchiseeEmail = "";
  let hqEmail = "";
  let docStatus = "Sent";
  // The pretend SignWell reads whatever JSON the code under test sends, so this is deliberately loose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createBody: any;
  const apiCalls: string[] = [];
  const objects = new Map<string, Uint8Array>();
  const PDF = (label: string) => new TextEncoder().encode(`%PDF-1.4\n${label}\n%%EOF`);

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

  /** A pretend SignWell: the API, and the host the completed PDFs are downloaded from. */
  const fakeSignWell = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname.startsWith("/signed/")) return new Response(PDF(url.pathname), { status: 200 });
    apiCalls.push(`${method} ${url.pathname}${url.search}`);
    if (method === "POST" && url.pathname === "/api/v1/documents") {
      createBody = JSON.parse(String(init?.body));
      return json({ id: DOC, status: "Sent", metadata: createBody.metadata, recipients: createBody.recipients.map((recipient: { id: string; email: string; name: string }) => ({ ...recipient, status: "sent" })) }, 201);
    }
    if (method === "GET" && url.pathname === `/api/v1/documents/${DOC}`) {
      return json({ id: DOC, status: docStatus, metadata: { agreement_id: agreementId }, recipients: [{ id: "1", email: franchiseeEmail, name: "F", status: "sent" }, { id: "2", email: hqEmail, name: "H", status: "sent" }] });
    }
    if (url.pathname === `/api/v1/documents/${DOC}/completed_pdf`) return json({ file_url: `https://www.signwell.com/signed/${tag}-${url.searchParams.get("audit_page") === "true" ? "certificate" : "signed"}.pdf` });
    return json({ error: "record_not_found" }, 404);
  }) as unknown as typeof fetch;

  const event = (type: string, extra: Record<string, unknown> = {}, time = String(now), id = DOC, hook = HOOK) =>
    JSON.stringify({ event: { type, time, hash: signSignWellEvent(hook, type, time), ...extra }, data: { object: { id } } });
  const send = (raw: string, nowSeconds = now) => processSignWellWebhook(raw, { fetch: fakeSignWell, providers, hosts: ["www.signwell.com"], webhookIds: [HOOK], nowSeconds });
  const agreement = async () => (await db.select().from(franchiseAgreements).where(eq(franchiseAgreements.id, agreementId)))[0]!;
  const signers = () => db.select().from(agreementSigners).where(eq(agreementSigners.signatureRequestId, requestId));

  beforeAll(async () => {
    vi.stubEnv("SIGNWELL_API_KEY", "sw_key");
    vi.stubEnv("ESIGN_WEBHOOK_SECRET", `secret-${tag}`);
    vi.stubEnv("ESIGN_ARTIFACT_HOSTS", "www.signwell.com");
    vi.stubGlobal("fetch", fakeSignWell);
    agreementId = randomUUID();
    await generateAgreementForFranchise(hq, franchiseId, agreementId);
    await submitCurrentAgreement(hq, franchiseId);
    await approveCurrentAgreement(hq, franchiseId);
    requestId = randomUUID();
    await sendCurrentAgreementForSignature(hq, franchiseId, requestId);
    const all = await signers();
    franchiseeEmail = all.find((signer) => signer.role === "franchisee")!.email;
    hqEmail = all.find((signer) => signer.role === "franchisor")!.email;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    const events = await db.select({ id: agreementSignatureEvents.id }).from(agreementSignatureEvents).where(eq(agreementSignatureEvents.signatureRequestId, requestId));
    const [row] = await db.select().from(franchiseAgreements).where(eq(franchiseAgreements.id, agreementId));
    const artifactIds = [row?.signedAgreementArtifactId, row?.completionCertificateArtifactId].filter((id): id is string => Boolean(id));
    const versions = artifactIds.length ? await db.select().from(franchiseDocumentVersions).where(inArray(franchiseDocumentVersions.artifactReferenceId, artifactIds)) : [];
    const artifacts = artifactIds.length ? await db.select().from(franchiseArtifactReferences).where(inArray(franchiseArtifactReferences.id, artifactIds)) : [];
    const fileIds = artifacts.map((artifact) => (artifact.providerMetadata as { fileId?: string }).fileId).filter((id): id is string => Boolean(id));
    if (versions.length) {
      const docIds = versions.map((version) => version.documentId);
      await db.update(franchiseDocuments).set({ currentVersionId: null }).where(inArray(franchiseDocuments.id, docIds));
      await db.delete(franchiseDocumentVersions).where(inArray(franchiseDocumentVersions.documentId, docIds));
      await db.delete(franchiseDocuments).where(inArray(franchiseDocuments.id, docIds));
    }
    await db.update(franchiseAgreements).set({ signedAgreementArtifactId: null, completionCertificateArtifactId: null }).where(eq(franchiseAgreements.id, agreementId));
    if (events.length) await db.delete(agreementSignatureEvents).where(inArray(agreementSignatureEvents.id, events.map((entry) => entry.id)));
    await db.delete(agreementSigners).where(eq(agreementSigners.signatureRequestId, requestId));
    await db.delete(agreementSignatureRequests).where(eq(agreementSignatureRequests.id, requestId));
    if (artifactIds.length) await db.delete(franchiseArtifactReferences).where(inArray(franchiseArtifactReferences.id, artifactIds));
    if (fileIds.length) await db.delete(fileReferences).where(inArray(fileReferences.id, fileIds));
    await db.delete(franchiseDomainEvents).where(like(franchiseDomainEvents.idempotencyKey, `%:${agreementId}`));
    await db.delete(franchiseAgreements).where(eq(franchiseAgreements.id, agreementId));
    await db.delete(webhookEventClaims).where(like(webhookEventClaims.eventId, `${DOC}:%`));
    await sql.end();
  });

  it("sends the agreement to SignWell as a PDF with an ordered signature page, in test mode, and remembers the document", async () => {
    expect(createBody).toMatchObject({ test_mode: true, with_signature_page: true, apply_signing_order: true, allow_reassign: false, metadata: { agreement_id: agreementId } });
    expect(createBody.recipients.map((recipient: { id: string; email: string }) => [recipient.id, recipient.email])).toEqual([["1", franchiseeEmail], ["2", hqEmail]]);
    expect(new TextDecoder().decode(Buffer.from(createBody.files[0].file_base64, "base64").subarray(0, 5))).toBe("%PDF-");
    const [request] = await db.select().from(agreementSignatureRequests).where(eq(agreementSignatureRequests.id, requestId));
    expect(request).toMatchObject({ providerRequestId: DOC });
  });

  it("refuses a wrong, changed, stale or malformed event before touching anything", async () => {
    await expect(send(event("document_completed", {}, String(now), DOC, "wrong-hook"))).rejects.toBeInstanceOf(SignWellWebhookAuthError);
    const tampered = JSON.parse(event("document_completed"));
    tampered.event.type = "document_signed";
    await expect(send(JSON.stringify(tampered))).rejects.toBeInstanceOf(SignWellWebhookAuthError);
    await expect(send(event("document_completed", {}, String(now - 5 * 86_400)))).rejects.toBeInstanceOf(SignWellWebhookAuthError);
    await expect(send("not json")).rejects.toBeInstanceOf(SignWellWebhookMalformedError);
    expect(apiCalls.filter((call) => call.startsWith("GET"))).toHaveLength(0);
    expect((await agreement()).status).not.toBe("executed");
  });

  it("ignores events we do not act on and documents that are not ours", async () => {
    await expect(send(event("document_viewed"))).resolves.toMatchObject({ outcome: "ignored" });
    await expect(send(event("document_signed", { related_signer: { email: franchiseeEmail } }, String(now), "someone-elses-doc"))).resolves.toMatchObject({ outcome: "ignored", reason: "unknown_document" });
  });

  it("confirms a signer against SignWell's recipients, applies it once, and refuses a person who is not a recipient", async () => {
    await expect(send(event("document_signed", { related_signer: { email: "stranger@example.test" } }))).resolves.toMatchObject({ outcome: "ignored", reason: "unconfirmed" });
    const signed = event("document_signed", { related_signer: { email: franchiseeEmail.toUpperCase() } }, String(now));
    await expect(send(signed)).resolves.toMatchObject({ outcome: "processed" });
    await expect(send(signed)).resolves.toMatchObject({ outcome: "duplicate" });
    expect((await signers()).find((signer) => signer.role === "franchisee")!.status).toBe("completed");
    expect((await signers()).find((signer) => signer.role === "franchisor")!.status).not.toBe("completed");
  });

  it("does not execute on an unconfirmed completion: a still-open document retries, a different status is ignored", async () => {
    docStatus = "Sent";
    await expect(send(event("document_completed", {}, String(now + 1)))).rejects.toBeInstanceOf(SignWellNotReadyError);
    docStatus = "Declined";
    await expect(send(event("document_completed", {}, String(now + 2)))).resolves.toMatchObject({ outcome: "ignored", reason: "unconfirmed" });
    expect((await agreement()).status).not.toBe("executed");
  });

  it("executes once SignWell says the document is completed, filling in the signer it did not hear about, and storing both documents safely", async () => {
    docStatus = "Completed";
    const completed = event("document_completed", {}, String(now + 3));
    await expect(send(completed)).resolves.toMatchObject({ outcome: "processed" });
    await expect(send(completed)).resolves.toMatchObject({ outcome: "duplicate" });

    const row = await agreement();
    expect(row.status).toBe("executed");
    expect((await signers()).every((signer) => signer.status === "completed")).toBe(true);
    const artifacts = await db.select().from(franchiseArtifactReferences).where(inArray(franchiseArtifactReferences.id, [row.signedAgreementArtifactId!, row.completionCertificateArtifactId!]));
    expect(artifacts).toHaveLength(2);
    for (const artifact of artifacts) {
      expect(artifact.lockedAt).toBeTruthy();
      expect(objects.has(artifact.storageKey)).toBe(true);
    }
    expect(apiCalls.some((call) => call.includes("completed_pdf") && call.includes("audit_page=true"))).toBe(true);
    expect(apiCalls.some((call) => call.includes("completed_pdf") && call.includes("audit_page=false"))).toBe(true);
    const executed = await db.select().from(franchiseDomainEvents).where(eq(franchiseDomainEvents.idempotencyKey, `franchise.agreement.executed:${agreementId}`));
    expect(executed).toHaveLength(1);
  });

  it("reminds and cancels through the provider port", async () => {
    const calls: string[] = [];
    const provider = signWellProvider({ apiKey: "k", testMode: true, fetch: (async (url: string | URL, init?: RequestInit) => { calls.push(`${init?.method} ${new URL(String(url)).pathname}`); return new Response(null, { status: init?.method === "DELETE" ? 204 : 201 }); }) as unknown as typeof fetch });
    await provider.resend({ providerRequestId: "d1" });
    await provider.cancel({ providerRequestId: "d1" });
    await provider.cancel({ providerRequestId: null });
    expect(calls).toEqual(["POST /api/v1/documents/d1/remind", "DELETE /api/v1/documents/d1"]);
    await expect(provider.resend({ providerRequestId: "" })).rejects.toThrow(/no signing request/);
  });
});
