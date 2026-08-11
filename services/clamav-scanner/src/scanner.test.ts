import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import {
  parseClamdResponse,
  scanFile,
  scanStreamWithClamd,
  validateScanRequest,
  waitForClamd,
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
    expect(parseClamdResponse("stream: OK\0")).toEqual({ status: "clean" });

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
    expect(parseClamdResponse("stream: Eicar-Test-Signature FOUND\0")).toEqual({
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

  it("classifies unexpected clamd responses with safe failure reasons", () => {
    expect(parseClamdResponse("\0")).toEqual({
      status: "failed",
      reason: "clamd_empty_response"
    });
    expect(parseClamdResponse("stream: Size limit exceeded. ERROR\0")).toEqual({
      status: "failed",
      reason: "clamd_error"
    });
    expect(parseClamdResponse("UNKNOWN COMMAND\0")).toEqual({
      status: "failed",
      reason: "clamd_unexpected_response"
    });
  });

  it("sends INSTREAM before framed chunks and parses clamd responses", async () => {
    const clean = await runFakeClamdScan({
      body: Readable.from(["hello", " world"]),
      responseChunks: [Buffer.from("stream: OK\0")]
    });

    expect(clean.outcome).toEqual({ status: "clean" });
    expect(parseClamdFrames(clean.received)).toEqual({
      command: "zINSTREAM\0",
      chunks: [Buffer.from("hello"), Buffer.from(" world")],
      hasTerminator: true
    });

    const infected = await runFakeClamdScan({
      body: Readable.from(["eicar"]),
      responseChunks: [
        Buffer.from("stream: Eicar-"),
        Buffer.from("Test-Signature FOUND\0")
      ]
    });

    expect(infected.outcome).toEqual({
      status: "infected",
      signature: "Eicar-Test-Signature"
    });
    expect(parseClamdFrames(infected.received)).toMatchObject({
      command: "zINSTREAM\0",
      chunks: [Buffer.from("eicar")],
      hasTerminator: true
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

  it("reports healthy only when clamd is ready", async () => {
    const server = createScannerServer(config, {
      pingClamd: async () => true
    }).listen(0);
    servers.push(server);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      clamd: "ready"
    });
  });

  it("reports unhealthy when clamd is unavailable", async () => {
    const server = createScannerServer(config, {
      pingClamd: async () => false
    }).listen(0);
    servers.push(server);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      clamd: "unavailable"
    });
  });

  it("waits for clamd readiness before startup proceeds", async () => {
    let attempts = 0;
    const ready = await waitForClamd({
      host: "127.0.0.1",
      port: 3310,
      timeoutMs: 50,
      intervalMs: 1,
      ping: async () => {
        attempts += 1;
        return attempts === 2;
      }
    });

    expect(ready).toBe(true);
  });

  it("times out when clamd never becomes ready", async () => {
    const ready = await waitForClamd({
      host: "127.0.0.1",
      port: 3310,
      timeoutMs: 5,
      intervalMs: 1,
      ping: async () => false
    });

    expect(ready).toBe(false);
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

async function runFakeClamdScan(input: {
  body: Readable;
  responseChunks: Buffer[];
}) {
  let received = Buffer.alloc(0);
  let connectionEnded: (() => void) | null = null;
  const closed = new Promise<void>((resolve) => {
    connectionEnded = resolve;
  });
  const server = createServer((socket) => {
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

      if (hasInstreamTerminator(received)) {
        for (const responseChunk of input.responseChunks) {
          socket.write(responseChunk);
        }

        socket.end();
      }
    });
    socket.on("close", () => {
      connectionEnded?.();
    });
  }).listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const outcome = await scanStreamWithClamd(input.body, {
    host: "127.0.0.1",
    port,
    maxFileBytes: 1024,
    timeoutMs: 1_000
  });

  await closed;
  server.close();

  return { outcome, received };
}

function hasInstreamTerminator(value: Buffer) {
  try {
    return parseClamdFrames(value).hasTerminator;
  } catch {
    return false;
  }
}

function parseClamdFrames(value: Buffer) {
  const command = "zINSTREAM\0";
  const commandBytes = Buffer.from(command);

  expect(value.subarray(0, commandBytes.length)).toEqual(commandBytes);

  const chunks: Buffer[] = [];
  let offset = commandBytes.length;
  let hasTerminator = false;

  while (offset + 4 <= value.length) {
    const size = value.readUInt32BE(offset);
    offset += 4;

    if (size === 0) {
      hasTerminator = true;
      break;
    }

    expect(offset + size).toBeLessThanOrEqual(value.length);
    chunks.push(value.subarray(offset, offset + size));
    offset += size;
  }

  return {
    command,
    chunks,
    hasTerminator
  };
}
