import { describe, expect, it } from "vitest";
import type { FileScannerProvider, StorageProvider } from "@raring2go/storage";
import { verifyClamAvScan, verifyR2Storage } from "./uat-toolkit";

const safeSource = {
  APP_ENV: "preview",
  DATABASE_URL: "postgres://user:pass@ep-uatrehearsal.neon.tech/raring2go?branch=uat",
  STORAGE_PROVIDER: "r2",
  R2_ACCOUNT_ID: "account_123",
  R2_BUCKET: "raring2go-uat",
  R2_ACCESS_KEY_ID: "access_key_123",
  R2_SECRET_ACCESS_KEY: "secret_key_123",
  STORAGE_URL_TTL_SECONDS: "60",
  SCANNER_PROVIDER: "clamav-http",
  CLAMAV_SCANNER_ENDPOINT: "https://scanner.test/scan",
  CLAMAV_SCANNER_API_KEY: "scanner_secret_123"
} as NodeJS.ProcessEnv;

describe("UAT storage verification", () => {
  it("fails closed without UAT confirmation", async () => {
    const checks = await verifyR2Storage({
      source: {
        ...safeSource,
        APP_ENV: "production",
        UAT_CONFIRMATION: undefined
      },
      provider: successfulProvider()
    });

    expect(checks).toContainEqual(expect.objectContaining({
      status: "RED",
      label: "UAT confirmation"
    }));
  });

  it("fails closed when R2 configuration is missing", async () => {
    const checks = await verifyR2Storage({
      source: {
        ...safeSource,
        R2_SECRET_ACCESS_KEY: undefined
      },
      provider: successfulProvider()
    });

    expect(checks).toContainEqual(expect.objectContaining({
      status: "RED",
      label: "R2_SECRET_ACCESS_KEY"
    }));
  });

  it("reports provider failures without leaking secrets or signed URLs", async () => {
    const secret = "secret_key_123";
    const checks = await verifyR2Storage({
      source: safeSource,
      provider: {
        ...successfulProvider(),
        async createUploadIntent(reference) {
          return {
            reference,
            uploadUrl: `https://r2.test/private?X-Amz-Signature=${secret}`,
            headers: {},
            expiresAt: "2026-08-11T12:01:00.000Z"
          };
        }
      },
      fetcher: async () => new Response("forbidden", { status: 403 })
    });
    const serialized = JSON.stringify(checks);

    expect(checks).toContainEqual(expect.objectContaining({
      status: "RED",
      label: "R2 verification"
    }));
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("https://r2.test/private");
  });

  it("surfaces safe R2 XML error diagnostics for 403 responses", async () => {
    const checks = await verifyR2Storage({
      source: safeSource,
      provider: successfulProvider(),
      fetcher: async (_url, init) => {
        if (init?.method === "PUT") {
          return new Response(null, { status: 200 });
        }

        return new Response(
          "<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match.</Message></Error>",
          { status: 403 }
        );
      }
    });

    expect(checks).toContainEqual(expect.objectContaining({
      status: "RED",
      label: "R2 verification",
      detail: expect.stringContaining("SignatureDoesNotMatch")
    }));
  });

  it("fails when downloaded content does not match the uploaded checksum", async () => {
    const checks = await verifyR2Storage({
      source: safeSource,
      provider: successfulProvider(),
      fetcher: async (url, init) => {
        if (init?.method === "PUT") {
          return new Response(null, { status: 200 });
        }

        return new Response(`tampered:${String(url)}`, { status: 200 });
      },
      id: "checksum-test",
      now: () => new Date("2026-08-11T12:00:00.000Z")
    });

    expect(checks).toContainEqual(expect.objectContaining({
      status: "RED",
      label: "R2 verification",
      detail: expect.stringContaining("checksum")
    }));
  });

  it("verifies content and cleans up the temporary R2 object", async () => {
    let uploaded = "";
    let deleted = false;

    const checks = await verifyR2Storage({
      source: safeSource,
      provider: successfulProvider({
        deleteObject: async (reference) => {
          deleted = true;
          return {
            ...reference,
            deletedAt: "2026-08-11T12:00:10.000Z"
          };
        }
      }),
      fetcher: async (_url, init) => {
        if (init?.method === "PUT") {
          uploaded = String(init.body);
          return new Response(null, { status: 200 });
        }

        return new Response(uploaded, { status: 200 });
      },
      id: "cleanup-test",
      now: () => new Date("2026-08-11T12:00:00.000Z")
    });

    expect(deleted).toBe(true);
    expect(checks).toContainEqual(expect.objectContaining({
      status: "GREEN",
      label: "Content verification"
    }));
    expect(checks).toContainEqual(expect.objectContaining({
      status: "GREEN",
      label: "Cleanup"
    }));
  });
});

describe("UAT ClamAV scanner verification", () => {
  it("fails closed without UAT confirmation", async () => {
    const checks = await verifyClamAvScan({
      source: {
        ...safeSource,
        APP_ENV: "production",
        UAT_CONFIRMATION: undefined
      },
      storageProvider: successfulProvider(),
      scannerProvider: successfulScanner()
    });

    expect(checks).toContainEqual(expect.objectContaining({
      status: "RED",
      label: "UAT confirmation"
    }));
  });

  it("verifies clean and EICAR rejection results", async () => {
    let uploadedBodies: string[] = [];

    const checks = await verifyClamAvScan({
      source: safeSource,
      storageProvider: successfulProvider(),
      scannerProvider: successfulScanner(),
      fetcher: async (_url, init) => {
        uploadedBodies.push(String(init?.body ?? ""));
        return new Response(null, { status: 200 });
      },
      id: "scan-success",
      now: () => new Date("2026-08-11T12:00:00.000Z")
    });

    expect(uploadedBodies).toHaveLength(2);
    expect(checks).toContainEqual(expect.objectContaining({
      status: "GREEN",
      label: "SCAN-001 clean file"
    }));
    expect(checks).toContainEqual(expect.objectContaining({
      status: "GREEN",
      label: "SCAN-002 EICAR rejection"
    }));
    expect(checks).toContainEqual(expect.objectContaining({
      status: "GREEN",
      label: "Infected download blocked"
    }));
  });

  it("fails closed when the scanner is unavailable", async () => {
    const checks = await verifyClamAvScan({
      source: safeSource,
      storageProvider: successfulProvider(),
      scannerProvider: successfulScanner({
        async scan(reference) {
          return {
            fileId: reference.id,
            status: "failed",
            providerKey: "clamav-http",
            scannedAt: "2026-08-11T12:00:00.000Z",
            findings: ["scanner_unavailable"]
          };
        }
      }),
      fetcher: async () => new Response(null, { status: 200 })
    });

    expect(checks).toContainEqual(expect.objectContaining({
      status: "RED",
      label: "ClamAV verification",
      detail: expect.stringContaining("scanner_unavailable")
    }));
  });

  it("fails closed when scanner credentials are invalid", async () => {
    const checks = await verifyClamAvScan({
      source: safeSource,
      storageProvider: successfulProvider(),
      scannerProvider: successfulScanner({
        async scan() {
          throw new Error("HTTP 401 invalid API key scanner_secret_123");
        }
      }),
      fetcher: async () => new Response(null, { status: 200 })
    });
    const serialized = JSON.stringify(checks);

    expect(checks).toContainEqual(expect.objectContaining({
      status: "RED",
      label: "ClamAV verification"
    }));
    expect(serialized).not.toContain("scanner_secret_123");
  });

  it("fails closed on R2 upload failure", async () => {
    const checks = await verifyClamAvScan({
      source: safeSource,
      storageProvider: successfulProvider(),
      scannerProvider: successfulScanner(),
      fetcher: async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 })
    });

    expect(checks).toContainEqual(expect.objectContaining({
      status: "RED",
      label: "ClamAV verification",
      detail: expect.stringContaining("AccessDenied")
    }));
  });

  it("cleans up both scan verification objects", async () => {
    const deleted: string[] = [];

    const checks = await verifyClamAvScan({
      source: safeSource,
      storageProvider: successfulProvider({
        async deleteObject(reference) {
          deleted.push(reference.storageKey);
          return {
            ...reference,
            deletedAt: "2026-08-11T12:00:10.000Z"
          };
        }
      }),
      scannerProvider: successfulScanner(),
      fetcher: async () => new Response(null, { status: 200 }),
      id: "cleanup-scan"
    });

    expect(deleted).toHaveLength(2);
    expect(deleted.every((key) => key.startsWith("uat/verification/scan/cleanup-scan/"))).toBe(true);
    expect(checks).toContainEqual(expect.objectContaining({
      status: "GREEN",
      label: "Cleanup"
    }));
  });

  it("redacts R2 secrets and file bodies from diagnostics", async () => {
    const checks = await verifyClamAvScan({
      source: safeSource,
      storageProvider: successfulProvider({
        async createUploadIntent(reference) {
          return {
            reference,
            uploadUrl: "https://signed-upload.test?X-Amz-Signature=secret_key_123",
            headers: {},
            expiresAt: "2026-08-11T12:01:00.000Z"
          };
        }
      }),
      scannerProvider: successfulScanner(),
      fetcher: async () => new Response("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", { status: 403 })
    });
    const serialized = JSON.stringify(checks);

    expect(serialized).not.toContain("secret_key_123");
    expect(serialized).not.toContain("EICAR-STANDARD");
    expect(serialized).not.toContain("signed-upload.test");
  });
});

function successfulProvider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    key: "r2",
    async createUploadIntent(reference) {
      return {
        reference,
        uploadUrl: "https://signed-upload.test",
        headers: {
          "content-type": reference.contentType
        },
        expiresAt: "2026-08-11T12:01:00.000Z"
      };
    },
    async createDownloadIntent(reference) {
      if (!["clean", "not_required"].includes(reference.virusScanStatus)) {
        throw new Error("Files must pass security scanning before download.");
      }

      return {
        reference,
        downloadUrl: "https://signed-download.test",
        disposition: "attachment",
        expiresAt: "2026-08-11T12:01:00.000Z"
      };
    },
    async deleteObject(reference) {
      return {
        ...reference,
        deletedAt: "2026-08-11T12:00:10.000Z"
      };
    },
    ...overrides
  };
}

function successfulScanner(overrides: Partial<FileScannerProvider> = {}): FileScannerProvider {
  return {
    key: "clamav-http",
    async scan(reference) {
      const isEicar = reference.storageKey.includes("eicar");

      return {
        fileId: reference.id,
        status: isEicar ? "infected" : "clean",
        providerKey: "clamav-http",
        scannedAt: "2026-08-11T12:00:00.000Z",
        signature: isEicar ? "Eicar-Test-Signature" : null,
        findings: isEicar ? ["malware_detected"] : []
      };
    },
    ...overrides
  };
}
