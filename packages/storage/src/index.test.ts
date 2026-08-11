import { describe, expect, it, vi } from "vitest";
import {
  assertSafeStorageKey,
  canAccessFile,
  createDevelopmentStorageProvider,
  createFileReference,
  lockFileReference,
  nextFileVersion
} from ".";

describe("@raring2go/storage", () => {
  it("creates provider-neutral file references with security scanning metadata", () => {
    const reference = createFileReference({
      id: "file_1",
      storageKey: "franchise/documents/file.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      accessScope: "territory",
      organisationId: "organisation_1",
      territoryId: "territory_1"
    });

    expect(reference).toMatchObject({
      providerKey: "development",
      version: 1,
      virusScanStatus: "pending"
    });
  });

  it("rejects unsafe storage keys", () => {
    expect(() => assertSafeStorageKey("../secret.pdf")).toThrow("normalised");
    expect(() => assertSafeStorageKey("/secret.pdf")).toThrow("normalised");
  });

  it("keeps versions and locks immutable references by returning new values", () => {
    const first = createFileReference({
      id: "file_1",
      storageKey: "artwork/file-v1.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      accessScope: "organisation",
      organisationId: "organisation_1"
    });
    const second = nextFileVersion(first, {
      id: "file_2",
      storageKey: "artwork/file-v2.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      accessScope: "organisation"
    });

    expect(second.version).toBe(2);
    expect(lockFileReference(second, "2026-08-11T00:00:00.000Z").lockedAt).toBe(
      "2026-08-11T00:00:00.000Z"
    );
    expect(second.lockedAt).toBeNull();
  });

  it("evaluates file access by scope", () => {
    const reference = createFileReference({
      id: "file_1",
      storageKey: "territory/file.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      accessScope: "territory",
      organisationId: "organisation_1",
      territoryId: "territory_1"
    });

    expect(canAccessFile(reference, { organisationId: "organisation_1", territoryId: "territory_1" })).toBe(true);
    expect(canAccessFile(reference, { organisationId: "organisation_1", territoryId: "territory_2" })).toBe(false);
    expect(canAccessFile(reference, { system: true })).toBe(true);
  });

  it("creates deterministic development upload and download intents", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
    const provider = createDevelopmentStorageProvider("http://files.test");
    const reference = createFileReference({
      id: "file_1",
      storageKey: "proofs/file.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      accessScope: "organisation",
      organisationId: "organisation_1"
    });

    await expect(provider.createUploadIntent(reference)).resolves.toMatchObject({
      uploadUrl: "http://files.test/upload/proofs%2Ffile.pdf",
      expiresAt: "2026-08-11T12:15:00.000Z"
    });
    await expect(provider.createDownloadIntent(reference, { disposition: "inline" })).resolves.toMatchObject({
      downloadUrl: "http://files.test/download/proofs%2Ffile.pdf",
      disposition: "inline"
    });
    vi.useRealTimers();
  });
});
