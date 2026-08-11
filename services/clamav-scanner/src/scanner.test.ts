import { afterEach, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import {
  parseClamdResponse,
  scanFile,
  validateScanRequest,
  type ScannerConfig
} from "./scanner.js";
import { createScannerServer } from "./server.js";

const config: ScannerConfig = {
  apiKey: "scanner-secret",
  maxFileBytes: 1024,
  timeoutMs: 100,
  clamdHost: "127.0.0.1",
  clamdPort: 3310,
  r2AccountId: "account",
  r2Bucket: "bucket",
  r2AccessKeyId: "access",
  r2SecretAccessKey: "secret"
};

const request = {
  fileId: "file_1",
  storageKey: "uat/clean.txt",
  contentType: "text/plain",
  checksum: null
};

describe("ClamAV scanner service", () => {
  const servers: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  it("returns clean for a clean file", async () => {
    const result = await scanFile(request, config, {
      fetchObject: async () => ({ body: Readable.from("hello"), byteSize: 5 }),
      scanStream: async () => ({ status: "clean" }),
      now: () => new Date("2026-08-11T12:00:00.000Z")
    });

    expect(result).toEqual({
      fileId: "file_1",
      status: "clean",
      providerKey: "clamav-http",
      scannedAt: "2026-08-11T12:00:00.000Z",
      signature: null,
      findings: []
    });
  });

  it("maps EICAR test signature detection to infected/rejected status", async () => {
    expect(parseClamdResponse("stream: Eicar-Test-Signature FOUND")).toEqual({
      status: "infected",
      signature: "Eicar-Test-Signature"
    });

    const result = await scanFile(request, config, {
      fetchObject: async () => ({ body: Readable.from("eicar"), byteSize: 5 }),
      scanStream: async () => ({ status: "infected", signature: "Eicar-Test-Signature" })
    });

    expect(result).toMatchObject({
      status: "infected",
      signature: "Eicar-Test-Signature",
      findings: ["malware_detected"]
    });
  });

  it("rejects missing or invalid API keys", async () => {
    const server = createScannerServer(config, {
      fetchObject: async () => ({ body: Readable.from("hello"), byteSize: 5 }),
      scanStream: async () => ({ status: "clean" })
    }).listen(0);
    servers.push(server);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const missing = await fetch(`http://127.0.0.1:${port}/scan`, {
      method: "POST",
      body: JSON.stringify(request)
    });
    const invalid = await fetch(`http://127.0.0.1:${port}/scan`, {
      method: "POST",
      headers: {
        authorization: "Bearer wrong",
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
  });

  it("fails closed when the scanner is unavailable", async () => {
    const result = await scanFile(request, config, {
      fetchObject: async () => ({ body: Readable.from("hello"), byteSize: 5 }),
      scanStream: async () => ({ status: "failed", reason: "scanner_unavailable" })
    });

    expect(result).toMatchObject({
      status: "failed",
      findings: ["scanner_unavailable"]
    });
  });

  it("fails closed for oversized files", async () => {
    const result = await scanFile(request, config, {
      fetchObject: async () => ({ body: Readable.from("hello"), byteSize: 2048 }),
      scanStream: async () => ({ status: "clean" })
    });

    expect(result).toMatchObject({
      status: "failed",
      findings: ["oversized_file"]
    });
  });

  it("fails closed for timeout/failure outcomes", async () => {
    const result = await scanFile(request, config, {
      fetchObject: async () => ({ body: Readable.from("hello"), byteSize: 5 }),
      scanStream: async () => ({ status: "failed", reason: "scan_timeout" })
    });

    expect(result).toMatchObject({
      status: "failed",
      findings: ["scan_timeout"]
    });
  });

  it("accepts only the expected provider-neutral request shape", () => {
    expect(() => validateScanRequest({
      fileId: "file_1",
      storageKey: "../secret",
      contentType: "text/plain"
    })).toThrow("storageKey");
  });
});
