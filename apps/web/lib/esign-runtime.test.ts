import { randomUUID } from "node:crypto";
import {
  agreementSignatureEvents, agreementSignatureRequests, agreementSigners, createDb, fileReferences, fixtureIds, franchiseAgreements, franchiseArtifactReferences,
  franchiseDocumentVersions, franchiseDocuments, franchiseDomainEvents, users, webhookEventClaims
} from "@raring2go/db";
import { signESignBody } from "@raring2go/franchise";
import { createMemoryScannerProvider } from "@raring2go/storage";
import type { StorageProvider } from "@raring2go/storage";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ESignArtifactError, assertArtifactUrlAllowed, fetchSignedArtifact } from "./esign-artifacts";
import { ESignAuthError, ESignEventError, processESignWebhook } from "./esign-runtime";
import type { FileProviders } from "./franchise-files";
import { approveCurrentAgreement, generateAgreementForFranchise, sendCurrentAgreementForSignature, submitCurrentAgreement } from "./franchise-runtime";

const pdf = (label: string) => new TextEncoder().encode(`%PDF-1.4\n${label}\n%%EOF`);
const HOST = "files.provider.example";

describe("signed artefact fetching", () => {
  const hosts = [HOST];
  it("only ever fetches plain https from trusted host names", () => {
    expect(() => assertArtifactUrlAllowed(`https://${HOST}/a.pdf`, hosts)).not.toThrow();
    for (const url of ["http://files.provider.example/a.pdf", "https://evil.example/a.pdf", "https://127.0.0.1/a.pdf", "https://169.254.169.254/latest/meta-data", "https://[::1]/a.pdf", "https://user:pw@files.provider.example/a.pdf", "file:///etc/passwd", "not a url", "https://files.provider.example.evil.example/a.pdf"]) {
      expect(() => assertArtifactUrlAllowed(url, hosts), url).toThrow(ESignArtifactError);
    }
    expect(() => assertArtifactUrlAllowed(`https://${HOST}/a.pdf`, [])).toThrow(/No e-signature document hosts/);
  });

  it("refuses redirects, oversized bodies (even with a lying length), empty bodies and non-PDFs", async () => {
    const respond = (body: BodyInit | null, init?: ResponseInit) => (async () => new Response(body, init)) as unknown as typeof fetch;
    await expect(fetchSignedArtifact(`https://${HOST}/a.pdf`, { hosts, fetch: respond(pdf("ok")) })).resolves.toBeInstanceOf(Uint8Array);
    await expect(fetchSignedArtifact(`https://${HOST}/a.pdf`, { hosts, fetch: respond(new Uint8Array(200), { headers: { "content-length": "50" } }), maxBytes: 100 })).rejects.toThrow(/larger/);
    await expect(fetchSignedArtifact(`https://${HOST}/a.pdf`, { hosts, fetch: respond(pdf("x"), { headers: { "content-length": "9999999" } }), maxBytes: 100 })).rejects.toThrow(/larger/);
    await expect(fetchSignedArtifact(`https://${HOST}/a.pdf`, { hosts, fetch: respond(new Uint8Array(0)) })).rejects.toThrow(/empty|no content/);
    await expect(fetchSignedArtifact(`https://${HOST}/a.pdf`, { hosts, fetch: respond(new TextEncoder().encode("<html>not a pdf</html>")) })).rejects.toThrow(/not a PDF/);
    const gone = await fetchSignedArtifact(`https://${HOST}/a.pdf`, { hosts, fetch: respond("x", { status: 404 }) }).catch((error) => error);
    expect(gone).toMatchObject({ permanent: false });
    const down = await fetchSignedArtifact(`https://${HOST}/a.pdf`, { hosts, fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch }).catch((error) => error);
    expect(down).toMatchObject({ permanent: false });
  });
});

/** Real database: the provider-neutral webhook verifies, claims once, fetches and stores signed documents safely, and executes the agreement once. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("e-signature webhook (postgres)", () => {
  const { db, sql } = createDb();
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const franchiseId = "00000000-0000-4000-8000-000000000901";
  const SECRET = `secret-${randomUUID()}`;
  const tag = randomUUID().slice(0, 8);
  const now = Math.floor(Date.now() / 1000);
  let agreementId = "";
  let providerRequestId = "";
  let requestId = "";
  let franchiseeEmail = "";
  let hqEmail = "";
  const fetched: string[] = [];
  const objects = new Map<string, Uint8Array>();

  const storage: StorageProvider = {
    key: "memory",
    async createUploadIntent(reference) {
      return { reference: { ...reference, providerKey: "memory" }, uploadUrl: `memory://upload/${reference.storageKey}`, headers: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    },
    async createDownloadIntent(reference, input) {
      return { reference, downloadUrl: `memory://download/${reference.storageKey}`, expiresAt: new Date(Date.now() + 300_000).toISOString(), disposition: input?.disposition ?? "attachment" };
    },
    async deleteObject(reference) {
      objects.delete(reference.storageKey);
      return reference;
    }
  };
  const providers = (scan: "clean" | "infected" = "clean"): FileProviders => ({
    storage,
    scanner: createMemoryScannerProvider({ status: scan }),
    fetch: (async (url: string | URL, init?: RequestInit) => {
      objects.set(String(url).replace("memory://upload/", ""), new Uint8Array(init?.body as Buffer));
      return new Response(null, { status: 200 });
    }) as typeof fetch
  });
  const hostFetch = (overrides: Record<string, () => Response> = {}) =>
    (async (url: string | URL) => {
      const key = String(url);
      fetched.push(key);
      return overrides[key]?.() ?? new Response(pdf(key), { status: 200 });
    }) as unknown as typeof fetch;

  const body = (event: Record<string, unknown>) => JSON.stringify({ providerRequestId, ...event });
  const send = (rawBody: string, options: { secret?: string; at?: number } = {}, deps: Parameters<typeof processESignWebhook>[1] = {}) =>
    processESignWebhook({ rawBody, signatureHeader: signESignBody(options.secret ?? SECRET, rawBody, options.at ?? now), nowSeconds: now }, { secrets: [SECRET], hosts: [HOST], providers: providers(), fetch: hostFetch(), ...deps });
  const completedEvent = (eventId: string, extra: Record<string, unknown> = {}) =>
    body({ eventId, type: "completed", artifacts: [{ kind: "signed_agreement", url: `https://${HOST}/${tag}/signed.pdf` }, { kind: "completion_certificate", url: `https://${HOST}/${tag}/certificate.pdf` }], ...extra });
  const statusOf = async () => (await db.select().from(franchiseAgreements).where(eq(franchiseAgreements.id, agreementId)))[0]!;

  beforeAll(async () => {
    agreementId = randomUUID();
    await generateAgreementForFranchise(hq, franchiseId, agreementId);
    await submitCurrentAgreement(hq, franchiseId);
    await approveCurrentAgreement(hq, franchiseId);
    requestId = randomUUID();
    await sendCurrentAgreementForSignature(hq, franchiseId, requestId);
    const [request] = await db.select().from(agreementSignatureRequests).where(eq(agreementSignatureRequests.id, requestId));
    providerRequestId = request!.providerRequestId!;
    const signers = await db.select().from(agreementSigners).where(eq(agreementSigners.signatureRequestId, requestId));
    franchiseeEmail = signers.find((signer) => signer.role === "franchisee")!.email;
    hqEmail = signers.find((signer) => signer.role === "franchisor")!.email;
  });

  afterAll(async () => {
    const events = await db.select({ id: agreementSignatureEvents.id }).from(agreementSignatureEvents).where(eq(agreementSignatureEvents.signatureRequestId, requestId));
    const [agreement] = await db.select().from(franchiseAgreements).where(eq(franchiseAgreements.id, agreementId));
    const artifactIds = [agreement?.signedAgreementArtifactId, agreement?.completionCertificateArtifactId].filter((id): id is string => Boolean(id));
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
    if (events.length) await db.delete(agreementSignatureEvents).where(inArray(agreementSignatureEvents.id, events.map((event) => event.id)));
    await db.delete(agreementSigners).where(eq(agreementSigners.signatureRequestId, requestId));
    await db.delete(agreementSignatureRequests).where(eq(agreementSignatureRequests.id, requestId));
    if (artifactIds.length) await db.delete(franchiseArtifactReferences).where(inArray(franchiseArtifactReferences.id, artifactIds));
    if (fileIds.length) await db.delete(fileReferences).where(inArray(fileReferences.id, fileIds));
    await db.delete(franchiseDomainEvents).where(like(franchiseDomainEvents.idempotencyKey, `%:${agreementId}`));
    await db.delete(franchiseAgreements).where(eq(franchiseAgreements.id, agreementId));
    await db.delete(webhookEventClaims).where(like(webhookEventClaims.eventId, `${providerRequestId}:%`));
    void users;
    await sql.end();
  });

  it("refuses an unsigned, wrongly signed or stale event before reading anything", async () => {
    const raw = body({ eventId: `unsigned-${tag}`, type: "declined" });
    await expect(processESignWebhook({ rawBody: raw, signatureHeader: null, nowSeconds: now }, { secrets: [SECRET] })).rejects.toBeInstanceOf(ESignAuthError);
    await expect(send(raw, { secret: "wrong" })).rejects.toBeInstanceOf(ESignAuthError);
    await expect(send(raw, { at: now - 3600 })).rejects.toBeInstanceOf(ESignAuthError);
    await expect(processESignWebhook({ rawBody: raw, signatureHeader: signESignBody(SECRET, raw, now), nowSeconds: now }, { secrets: [] })).rejects.toBeInstanceOf(ESignAuthError);
    expect((await statusOf()).status).not.toBe("declined");
  });

  it("ignores an unknown request and rejects malformed events and strangers", async () => {
    await expect(send(JSON.stringify({ eventId: "e", type: "declined", providerRequestId: "no-such-request" }))).resolves.toEqual({ outcome: "ignored", reason: "unknown_request" });
    await expect(send(body({ eventId: "e", type: "bogus" }))).rejects.toBeInstanceOf(ESignEventError);
    await expect(send(body({ eventId: `stranger-${tag}`, type: "signer.completed", signerEmail: "stranger@example.test" }))).rejects.toThrow(/not one we asked/);
  });

  it("applies each signer once and never twice, in the order the agreement requires", async () => {
    await expect(send(body({ eventId: `order-${tag}`, type: "signer.completed", signerEmail: hqEmail }))).rejects.toThrow(/Signer order/);
    const event = body({ eventId: `s1-${tag}`, type: "signer.completed", signerEmail: franchiseeEmail.toUpperCase() });
    await expect(send(event)).resolves.toEqual({ outcome: "processed" });
    await expect(send(event)).resolves.toEqual({ outcome: "duplicate" });

    const signers = await db.select().from(agreementSigners).where(eq(agreementSigners.signatureRequestId, requestId));
    expect(signers.find((signer) => signer.role === "franchisee")!.status).toBe("completed");
    expect(signers.find((signer) => signer.role === "franchisor")!.status).not.toBe("completed");
    const rows = await db.select().from(agreementSignatureEvents).where(eq(agreementSignatureEvents.signatureRequestId, requestId));
    expect(rows.filter((row) => row.providerEventId === `s1-${tag}`)).toHaveLength(1);
    // Our row ids are ours: the provider's event id is only ever a key, never a primary key.
    expect(rows.every((row) => /^[0-9a-f-]{36}$/.test(row.id))).toBe(true);
  });

  it("refuses signed documents from an untrusted host, with a bad checksum, that are not PDFs, or that fail the scan, recording nothing", async () => {
    await expect(send(completedEvent(`c-before-${tag}`))).rejects.toThrow(/Every required signer/);
    await send(body({ eventId: `s2-${tag}`, type: "signer.completed", signerEmail: hqEmail }));
    const claimsBefore = (await db.select().from(webhookEventClaims).where(like(webhookEventClaims.eventId, `${providerRequestId}:%`))).length;

    const bad: [() => Promise<unknown>, RegExp][] = [
      [() => send(completedEvent(`bad-host-${tag}`, { artifacts: [{ kind: "signed_agreement", url: "https://evil.example/s.pdf" }, { kind: "completion_certificate", url: `https://${HOST}/c.pdf` }] })), /trusted host/],
      [() => send(completedEvent(`bad-sum-${tag}`, { artifacts: [{ kind: "signed_agreement", url: `https://${HOST}/s.pdf`, sha256: "0".repeat(64) }, { kind: "completion_certificate", url: `https://${HOST}/c.pdf` }] })), /checksum/],
      [() => send(completedEvent(`not-pdf-${tag}`), {}, { fetch: hostFetch({ [`https://${HOST}/${tag}/signed.pdf`]: () => new Response("<html></html>") }) }), /not a PDF/],
      [() => send(completedEvent(`infected-${tag}`), {}, { providers: providers("infected") }), /security scan/]
    ];
    for (const [attempt, pattern] of bad) await expect(attempt()).rejects.toThrow(pattern);

    expect((await statusOf()).status).not.toBe("executed");
    expect((await db.select().from(webhookEventClaims).where(like(webhookEventClaims.eventId, `${providerRequestId}:%`))).length).toBe(claimsBefore);
  });

  it("survives a passing fault: the failed delivery leaves no claim, so the provider's retry is processed", async () => {
    const event = completedEvent(`retry-${tag}`);
    const flaky = hostFetch({ [`https://${HOST}/${tag}/certificate.pdf`]: () => { throw new TypeError("network down"); } });
    const failure = await send(event, {}, { fetch: flaky }).catch((error) => error);
    expect(failure).toBeInstanceOf(ESignArtifactError);
    expect(failure.permanent).toBe(false);
    expect((await statusOf()).status).not.toBe("executed");

    await expect(send(event)).resolves.toEqual({ outcome: "processed" });
    expect((await statusOf()).status).toBe("executed");
  });

  it("executes the agreement with real, scanned, locked artefacts, adopts them into the vault once, and ignores a redelivery without fetching again", async () => {
    const agreement = await statusOf();
    expect(agreement.executedAt).toBeTruthy();
    const artifacts = await db.select().from(franchiseArtifactReferences).where(inArray(franchiseArtifactReferences.id, [agreement.signedAgreementArtifactId!, agreement.completionCertificateArtifactId!]));
    expect(artifacts).toHaveLength(2);
    for (const artifact of artifacts) {
      expect(artifact.lockedAt).toBeTruthy();
      expect(artifact.storageKey).not.toMatch(/^development\//);
      expect(objects.has(artifact.storageKey)).toBe(true);
      expect(artifact.checksum).toMatch(/^[0-9a-f]{64}$/);
      const [reference] = await db.select().from(fileReferences).where(eq(fileReferences.id, (artifact.providerMetadata as { fileId: string }).fileId));
      expect(reference).toMatchObject({ virusScanStatus: "clean", accessScope: "territory", checksum: artifact.checksum });
    }

    const adoptedVersions = await db.select().from(franchiseDocumentVersions).where(inArray(franchiseDocumentVersions.artifactReferenceId, artifacts.map((artifact) => artifact.id)));
    expect(adoptedVersions).toHaveLength(2);
    const executedEvents = await db.select().from(franchiseDomainEvents).where(eq(franchiseDomainEvents.idempotencyKey, `franchise.agreement.executed:${agreementId}`));
    expect(executedEvents).toHaveLength(1);

    const fetchesBefore = fetched.length;
    await expect(send(completedEvent(`retry-${tag}`))).resolves.toEqual({ outcome: "duplicate" });
    await expect(send(completedEvent(`another-${tag}`))).resolves.toEqual({ outcome: "ignored", reason: "already_executed" });
    expect(fetched.length).toBe(fetchesBefore);
    expect(await db.select().from(franchiseDocumentVersions).where(inArray(franchiseDocumentVersions.artifactReferenceId, artifacts.map((artifact) => artifact.id)))).toHaveLength(2);
  });
});
