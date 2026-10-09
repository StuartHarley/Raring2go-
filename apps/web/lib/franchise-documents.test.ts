import { randomUUID } from "node:crypto";
import {
  auditEvents, createDb, fileReferences, fixtureIds, franchiseArtifactReferences, franchiseDocumentVersions, franchiseDocuments
} from "@raring2go/db";
import { createMemoryScannerProvider } from "@raring2go/storage";
import type { StorageProvider } from "@raring2go/storage";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { DocumentFileError, sniffDocumentKind, validateDocumentFile } from "./franchise-files";
import type { FileProviders } from "./franchise-files";
import { addDocumentVersionForFranchise, downloadDocumentForFranchise, uploadDocumentForFranchise } from "./franchise-runtime";

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.4\n${extra}\n%%EOF`);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const docx = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

describe("document file validation", () => {
  it("identifies files by their bytes, not their claimed type", () => {
    expect(sniffDocumentKind(pdf())).toBe("pdf");
    expect(sniffDocumentKind(png)).toBe("png");
    expect(sniffDocumentKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffDocumentKind(docx)).toBe("docx");
    expect(sniffDocumentKind(new TextEncoder().encode("MZ executable"))).toBeUndefined();
  });

  it("refuses empty, oversized, unknown, mismatched and badly named files", () => {
    const ok = { fileName: "a.pdf", contentType: "application/pdf", bytes: pdf() };
    expect(validateDocumentFile(ok)).toMatchObject({ kind: "pdf" });
    expect(() => validateDocumentFile({ ...ok, bytes: new Uint8Array() })).toThrow(DocumentFileError);
    expect(() => validateDocumentFile({ ...ok, bytes: new Uint8Array(4 * 1024 * 1024 + 1).fill(1) })).toThrow(/4MB/);
    expect(() => validateDocumentFile({ ...ok, bytes: new TextEncoder().encode("MZ.exe") })).toThrow(/PDF, PNG/);
    expect(() => validateDocumentFile({ ...ok, contentType: "image/png" })).toThrow(/does not match/);
    expect(() => validateDocumentFile({ fileName: "report.docm", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: docx })).toThrow(/\.docx/);
    expect(validateDocumentFile({ fileName: "report.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: docx })).toMatchObject({ kind: "docx" });
  });
});

/** Real database + in-memory storage: uploads are scanned, scoped, versioned, downloadable by short-lived link, and audited. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("franchise document vault (postgres)", () => {
  const { db, sql } = createDb();
  const franchiseId = fixtureIds.franchises?.suttonColdfield ?? "00000000-0000-4000-8000-000000000901";
  const sutton = fixtureIds.territories.suttonColdfield;
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const franchisee = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: sutton };
  const elsewhere = { ...franchisee, territoryId: fixtureIds.territories.solihull };
  const tag = randomUUID().slice(0, 8);
  const documentIds: string[] = [];

  const objects = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const storage: StorageProvider = {
    key: "memory",
    async createUploadIntent(reference) {
      return { reference: { ...reference, providerKey: "memory" }, uploadUrl: `memory://upload/${reference.storageKey}`, headers: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    },
    async createDownloadIntent(reference, input) {
      return { reference, downloadUrl: `memory://download/${reference.storageKey}?expires=300`, expiresAt: new Date(Date.now() + 300_000).toISOString(), disposition: input?.disposition ?? "attachment" };
    },
    async deleteObject(reference) {
      objects.delete(reference.storageKey);
      deleted.push(reference.storageKey);
      return reference;
    }
  };
  const providers = (scan: "clean" | "infected" | "failed" = "clean"): FileProviders => ({
    storage,
    scanner: createMemoryScannerProvider({ status: scan }),
    fetch: (async (url: string | URL, init?: RequestInit) => {
      objects.set(String(url).replace("memory://upload/", ""), new Uint8Array(init?.body as Buffer));
      return new Response(null, { status: 200 });
    }) as typeof fetch
  });
  const meta = (title: string) => ({ category: "company_document", documentType: "general", title: `${title} ${tag}` });
  const file = (name = "doc.pdf", bytes = pdf(randomUUID())) => ({ fileName: name, contentType: "application/pdf", bytes });
  const docsWithTag = () => db.select().from(franchiseDocuments).where(eq(franchiseDocuments.franchiseId, franchiseId)).then((rows) => rows.filter((row) => row.title.endsWith(tag)));

  afterAll(async () => {
    const docs = await docsWithTag();
    const versions = docs.length ? await db.select().from(franchiseDocumentVersions).where(inArray(franchiseDocumentVersions.documentId, docs.map((doc) => doc.id))) : [];
    const artifactIds = versions.map((version) => version.artifactReferenceId);
    const artifacts = artifactIds.length ? await db.select().from(franchiseArtifactReferences).where(inArray(franchiseArtifactReferences.id, artifactIds)) : [];
    const fileIds = artifacts.map((artifact) => (artifact.providerMetadata as { fileId?: string }).fileId).filter((id): id is string => Boolean(id));
    if (docs.length) {
      await db.update(franchiseDocuments).set({ currentVersionId: null }).where(inArray(franchiseDocuments.id, docs.map((doc) => doc.id)));
      await db.delete(franchiseDocumentVersions).where(inArray(franchiseDocumentVersions.documentId, docs.map((doc) => doc.id)));
      await db.delete(franchiseDocuments).where(inArray(franchiseDocuments.id, docs.map((doc) => doc.id)));
    }
    if (artifactIds.length) await db.delete(franchiseArtifactReferences).where(inArray(franchiseArtifactReferences.id, artifactIds));
    if (fileIds.length) await db.delete(fileReferences).where(inArray(fileReferences.id, fileIds));
    await sql.end();
  });

  it("stores a scanned, checksummed file scoped to the territory and records the document, version and artefact against it", async () => {
    const bytes = pdf("hello");
    const before = objects.size;
    const document = await uploadDocumentForFranchise(hq, franchiseId, { ...meta("Insurance"), file: { fileName: "insurance certificate.pdf", contentType: "application/pdf", bytes } }, providers());
    documentIds.push(document.id);

    expect(objects.size).toBe(before + 1);
    const [version] = await db.select().from(franchiseDocumentVersions).where(eq(franchiseDocumentVersions.documentId, document.id));
    const [artifact] = await db.select().from(franchiseArtifactReferences).where(eq(franchiseArtifactReferences.id, version!.artifactReferenceId));
    const fileId = (artifact!.providerMetadata as { fileId: string }).fileId;
    const [reference] = await db.select().from(fileReferences).where(eq(fileReferences.id, fileId));

    expect(reference).toMatchObject({ virusScanStatus: "clean", accessScope: "territory", territoryId: sutton, contentType: "application/pdf", byteSize: bytes.byteLength });
    expect(reference!.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact).toMatchObject({ storageKey: reference!.storageKey, checksum: reference!.checksum });
    // No placeholder path any more: the key is the real stored object.
    expect(artifact!.storageKey).toMatch(/^franchises\/.+\/documents\/.+insurance_certificate\.pdf$/);
    expect(objects.has(artifact!.storageKey)).toBe(true);

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityId, document.id));
    expect(audit.map((event) => event.action)).toContain("franchise.document.upload");
  });

  it("stores nothing when the file is refused: bad type, infected, or the uploader may not upload", async () => {
    const stored = objects.size;
    const docsBefore = (await docsWithTag()).length;

    await expect(uploadDocumentForFranchise(hq, franchiseId, { ...meta("Bad type"), file: { fileName: "x.exe", contentType: "application/pdf", bytes: new TextEncoder().encode("MZ") } }, providers())).rejects.toBeInstanceOf(DocumentFileError);

    await expect(uploadDocumentForFranchise(hq, franchiseId, { ...meta("Infected"), file: file() }, providers("infected"))).rejects.toThrow(/failed the security scan/);
    await expect(uploadDocumentForFranchise(hq, franchiseId, { ...meta("Unscanned"), file: file() }, providers("failed"))).rejects.toThrow(/could not be security-scanned/);
    expect(deleted.length).toBe(2);

    // The franchisee can view and download documents but not upload them, and is refused before any bytes are stored.
    await expect(uploadDocumentForFranchise(franchisee, franchiseId, { ...meta("Not allowed"), file: file() }, providers())).rejects.toThrow();

    expect(objects.size).toBe(stored);
    expect(await docsWithTag()).toHaveLength(docsBefore);
  });

  it("keeps every version, makes the newest current, and downloads any version by a short-lived, audited link", async () => {
    const first = file("v1.pdf", pdf("one"));
    const document = await uploadDocumentForFranchise(hq, franchiseId, { ...meta("Policy"), file: first }, providers());
    documentIds.push(document.id);
    await addDocumentVersionForFranchise(hq, franchiseId, document.id, { file: file("v2.pdf", pdf("two")) }, providers());

    const versions = await db.select().from(franchiseDocumentVersions).where(eq(franchiseDocumentVersions.documentId, document.id));
    expect(versions.map((version) => version.versionNumber).sort()).toEqual([1, 2]);
    const [current] = await db.select().from(franchiseDocuments).where(eq(franchiseDocuments.id, document.id));
    expect(current!.currentVersionId).toBe(versions.find((version) => version.versionNumber === 2)!.id);

    const latest = await downloadDocumentForFranchise(franchisee, franchiseId, document.id, undefined, { storage });
    const original = await downloadDocumentForFranchise(franchisee, franchiseId, document.id, 1, { storage });
    expect(latest.url).toMatch(/^memory:\/\/download\/franchises\/.+v2\.pdf\?expires=300$/);
    expect(original.url).toMatch(/v1\.pdf/);
    expect(new Date(latest.expiresAt).getTime()).toBeLessThan(Date.now() + 10 * 60_000);

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityId, document.id));
    expect(audit.filter((event) => event.action === "franchise.document.download")).toHaveLength(2);
    expect(audit.map((event) => event.action)).toContain("franchise.document.version.create");
    await expect(downloadDocumentForFranchise(franchisee, franchiseId, document.id, 9, { storage })).rejects.toThrow(/not found/i);
  });

  it("keeps territories apart on download, and refuses a file that was tampered with or never cleared its scan", async () => {
    const document = await uploadDocumentForFranchise(hq, franchiseId, { ...meta("Scoped"), file: file() }, providers());
    documentIds.push(document.id);

    // Staff acting in another territory cannot reach this franchise's document at all.
    await expect(downloadDocumentForFranchise(elsewhere, franchiseId, document.id, undefined, { storage })).rejects.toThrow();
    await expect(downloadDocumentForFranchise({ userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser }, franchiseId, document.id, undefined, { storage })).rejects.toThrow();
    // Another franchise's document id under this franchise's path is simply not found.
    await expect(downloadDocumentForFranchise(franchisee, franchiseId, randomUUID(), undefined, { storage })).rejects.toThrow(/not found/i);

    const [version] = await db.select().from(franchiseDocumentVersions).where(eq(franchiseDocumentVersions.documentId, document.id));
    const [artifact] = await db.select().from(franchiseArtifactReferences).where(eq(franchiseArtifactReferences.id, version!.artifactReferenceId));
    const fileId = (artifact!.providerMetadata as { fileId: string }).fileId;

    // A reference that was repointed at another territory's file is refused.
    await db.update(fileReferences).set({ territoryId: fixtureIds.territories.solihull }).where(eq(fileReferences.id, fileId));
    await expect(downloadDocumentForFranchise(franchisee, franchiseId, document.id, undefined, { storage })).rejects.toThrow(/could not be found/);
    await db.update(fileReferences).set({ territoryId: sutton }).where(eq(fileReferences.id, fileId));

    // A file that is not clean is never handed out.
    await db.update(fileReferences).set({ virusScanStatus: "pending" }).where(eq(fileReferences.id, fileId));
    await expect(downloadDocumentForFranchise(franchisee, franchiseId, document.id, undefined, { storage })).rejects.toThrow(/security scanning/);
    await db.update(fileReferences).set({ virusScanStatus: "clean" }).where(eq(fileReferences.id, fileId));
    await expect(downloadDocumentForFranchise(franchisee, franchiseId, document.id, undefined, { storage })).resolves.toMatchObject({ contentType: "application/pdf" });
  });
});
