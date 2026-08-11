import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  applyScanResult,
  assertSafeStorageKey,
  canAccessFile,
  createClamAvHttpScannerProvider,
  createDevelopmentStorageProvider,
  createFileReference,
  createMemoryScannerProvider,
  createR2StorageProvider,
  createScannerProviderFromEnv,
  createSignedUrlStorageProvider,
  createStorageProviderFromEnv,
  assertFileIsDownloadable,
  lockFileReference,
  nextFileVersion,
  verifySignedStorageUrl
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
      organisationId: "organisation_1",
      virusScanStatus: "clean"
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
      organisationId: "organisation_1",
      virusScanStatus: "clean"
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

  it("blocks downloads until scanning has cleared the file", () => {
    const pending = createFileReference({
      id: "file_1",
      storageKey: "private/file.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      accessScope: "territory",
      territoryId: "territory_1"
    });
    const infected = { ...pending, virusScanStatus: "infected" as const };
    const clean = { ...pending, virusScanStatus: "clean" as const };

    expect(() => assertFileIsDownloadable(pending)).toThrow("security scanning");
    expect(() => assertFileIsDownloadable(infected)).toThrow("security scanning");
    expect(() => assertFileIsDownloadable(clean)).not.toThrow();
  });

  it("creates time-limited signed upload and download URLs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
    const provider = createSignedUrlStorageProvider({
      baseUrl: "https://files.raring2go.test",
      secret: "storage-secret",
      expiresInSeconds: 60
    });
    const reference = createFileReference({
      id: "file_1",
      storageKey: "artwork/file.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      accessScope: "organisation",
      organisationId: "organisation_1",
      virusScanStatus: "clean"
    });

    const upload = await provider.createUploadIntent(reference);
    const download = await provider.createDownloadIntent(reference);
    const downloadUrl = new URL(download.downloadUrl);

    expect(upload.uploadUrl).toContain("/upload/artwork%2Ffile.pdf");
    expect(download.expiresAt).toBe("2026-08-11T12:01:00.000Z");
    expect(verifySignedStorageUrl({
      action: "download",
      storageKey: "artwork/file.pdf",
      expiresAt: downloadUrl.searchParams.get("expiresAt") ?? "",
      signature: downloadUrl.searchParams.get("signature") ?? ""
    }, "storage-secret", new Date("2026-08-11T12:00:30.000Z"))).toBe(true);
    expect(verifySignedStorageUrl({
      action: "download",
      storageKey: "artwork/file.pdf",
      expiresAt: downloadUrl.searchParams.get("expiresAt") ?? "",
      signature: downloadUrl.searchParams.get("signature") ?? ""
    }, "storage-secret", new Date("2026-08-11T12:02:00.000Z"))).toBe(false);
    vi.useRealTimers();
  });

  it("applies scanner results immutably and rejects mismatched scan events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
    const scanner = createMemoryScannerProvider({ status: "clean" });
    const reference = createFileReference({
      id: "file_1",
      storageKey: "private/file.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      accessScope: "territory",
      territoryId: "territory_1"
    });
    const result = await scanner.scan(reference);
    const scanned = applyScanResult(reference, result);

    expect(scanned.virusScanStatus).toBe("clean");
    expect(reference.virusScanStatus).toBe("pending");
    expect(scanned.metadata.scan).toMatchObject({
      providerKey: "memory-scanner",
      scannedAt: "2026-08-11T12:00:00.000Z"
    });
    expect(() => applyScanResult(reference, { ...result, fileId: "other" })).toThrow("does not match");
    vi.useRealTimers();
  });

  it("selects storage providers from environment without vendor lock-in", () => {
    expect(createStorageProviderFromEnv({ STORAGE_PROVIDER: "development" } as NodeJS.ProcessEnv).key).toBe("development");
    expect(createStorageProviderFromEnv({
      STORAGE_PROVIDER: "signed-url",
      STORAGE_BASE_URL: "https://files.raring2go.test",
      STORAGE_SIGNING_SECRET: "secret",
      STORAGE_PROVIDER_KEY: "pilot-files"
    } as NodeJS.ProcessEnv).key).toBe("pilot-files");
    expect(createStorageProviderFromEnv({
      STORAGE_PROVIDER: "r2",
      R2_ACCOUNT_ID: "account",
      R2_BUCKET: "raring2go-pilot",
      R2_ACCESS_KEY_ID: "access-key",
      R2_SECRET_ACCESS_KEY: "secret-key"
    } as NodeJS.ProcessEnv).key).toBe("r2");
  });

  it("creates private Cloudflare R2 signed upload and download URLs without exposing secret material", async () => {
    const provider = createR2StorageProvider({
      accountId: "account123",
      bucket: "raring2go-pilot",
      accessKeyId: "access-key-id",
      secretAccessKey: "super-secret-key",
      expiresInSeconds: 120,
      now: () => new Date("2026-08-11T12:00:00.000Z")
    });
    const reference = createFileReference({
      id: "file_1",
      storageKey: "territories/sutton/artwork/file.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      accessScope: "territory",
      territoryId: "territory_sutton",
      virusScanStatus: "clean"
    });

    const upload = await provider.createUploadIntent(reference);
    const download = await provider.createDownloadIntent(reference, { disposition: "inline" });

    expect(upload.reference.providerKey).toBe("r2");
    expect(upload.uploadUrl).toContain("https://account123.r2.cloudflarestorage.com/raring2go-pilot/territories/sutton/artwork/file.pdf");
    expect(upload.uploadUrl).toContain("X-Amz-Expires=120");
    expect(upload.headers).toEqual({ "content-type": "application/pdf" });
    expect(download.downloadUrl).toContain("response-content-disposition=");
    expect(download.expiresAt).toBe("2026-08-11T12:02:00.000Z");
    expect(upload.uploadUrl).not.toContain("super-secret-key");
    expect(download.downloadUrl).not.toContain("super-secret-key");
    expect(download.downloadUrl).not.toContain("raring2go.co.uk/");
  });

  it("deletes temporary Cloudflare R2 objects through a signed provider request", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createR2StorageProvider({
      accountId: "account123",
      bucket: "raring2go-pilot",
      accessKeyId: "access-key-id",
      secretAccessKey: "super-secret-key",
      expiresInSeconds: 120,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(null, { status: 204 });
      }
    });
    const reference = createFileReference({
      id: "file_1",
      storageKey: "uat/verification/file.txt",
      fileName: "file.txt",
      contentType: "text/plain",
      accessScope: "system",
      virusScanStatus: "not_required"
    });

    const deleted = await provider.deleteObject?.(reference);

    expect(deleted?.deletedAt).toBeTruthy();
    expect(requests[0]?.init?.method).toBe("DELETE");
    expect(requests[0]?.url).toContain("X-Amz-Expires=120");
    expect(requests[0]?.url).not.toContain("super-secret-key");
  });

  it("fails closed for missing R2 configuration", () => {
    expect(() => createStorageProviderFromEnv({
      STORAGE_PROVIDER: "r2",
      R2_ACCOUNT_ID: "account"
    } as NodeJS.ProcessEnv)).toThrow("R2_ACCOUNT_ID");
  });

  it("uses the ClamAV HTTP scanner boundary and does not pass scanner secrets into file references", async () => {
    const requests: RequestInit[] = [];
    const scanner = createClamAvHttpScannerProvider({
      endpoint: "https://scanner.internal/scan",
      apiKey: "scanner-secret",
      fetch: async (_url, init) => {
        requests.push(init ?? {});
        return new Response(JSON.stringify({
          status: "clean",
          scannedAt: "2026-08-11T12:00:00.000Z",
          findings: []
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });
    const reference = createFileReference({
      id: "file_1",
      storageKey: "private/file.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      accessScope: "organisation",
      organisationId: "organisation_1"
    });
    const result = await scanner.scan(reference);
    const scanned = applyScanResult(reference, result);

    expect(result).toMatchObject({
      providerKey: "clamav-http",
      status: "clean"
    });
    expect(requests[0]?.headers).toMatchObject({ authorization: "Bearer scanner-secret" });
    expect(JSON.stringify(scanned)).not.toContain("scanner-secret");
  });

  it("treats scanner outages as failed scans and blocks download", async () => {
    const scanner = createClamAvHttpScannerProvider({
      endpoint: "https://scanner.internal/scan",
      fetch: async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 })
    });
    const reference = createFileReference({
      id: "file_1",
      storageKey: "private/file.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      accessScope: "territory",
      territoryId: "territory_1"
    });
    const scanned = applyScanResult(reference, await scanner.scan(reference));

    expect(scanned.virusScanStatus).toBe("failed");
    expect(() => assertFileIsDownloadable(scanned)).toThrow("security scanning");
  });

  it("verifies scanner webhooks and selects scanner providers from environment", async () => {
    expect(createScannerProviderFromEnv({ SCANNER_PROVIDER: "memory" } as NodeJS.ProcessEnv).key).toBe("memory-scanner");
    expect(createScannerProviderFromEnv({
      SCANNER_PROVIDER: "clamav-http",
      CLAMAV_SCANNER_ENDPOINT: "https://scanner.internal/scan"
    } as NodeJS.ProcessEnv).key).toBe("clamav-http");
    expect(() => createScannerProviderFromEnv({
      SCANNER_PROVIDER: "clamav-http"
    } as NodeJS.ProcessEnv)).toThrow("CLAMAV_SCANNER_ENDPOINT");

    const scanner = createClamAvHttpScannerProvider({ endpoint: "https://scanner.internal/scan" });
    const body = JSON.stringify({
      fileId: "file_1",
      status: "infected",
      providerKey: "clamav-http",
      scannedAt: "2026-08-11T12:00:00.000Z",
      findings: ["Eicar-Test-Signature"]
    });
    const signature = createHmac("sha256", "scanner-webhook-secret").update(body).digest("hex");
    const event = await scanner.verifyScanEvent?.({
      headers: { "x-raring2go-scanner-signature": signature },
      body,
      secret: "scanner-webhook-secret"
    });

    expect(event).toMatchObject({
      fileId: "file_1",
      status: "infected",
      findings: ["Eicar-Test-Signature"]
    });
  });
});
