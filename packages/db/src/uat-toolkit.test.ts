import { describe, expect, it } from "vitest";
import type { StorageProvider } from "@raring2go/storage";
import { verifyR2Storage } from "./uat-toolkit";

const safeSource = {
  APP_ENV: "preview",
  DATABASE_URL: "postgres://user:pass@ep-uatrehearsal.neon.tech/raring2go?branch=uat",
  STORAGE_PROVIDER: "r2",
  R2_ACCOUNT_ID: "account_123",
  R2_BUCKET: "raring2go-uat",
  R2_ACCESS_KEY_ID: "access_key_123",
  R2_SECRET_ACCESS_KEY: "secret_key_123",
  STORAGE_URL_TTL_SECONDS: "60"
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
