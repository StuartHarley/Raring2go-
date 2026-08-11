import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { once } from "node:events";
import { Socket } from "node:net";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export type ScanStatus = "clean" | "infected" | "failed";

export type ScanRequest = {
  fileId: string;
  storageKey: string;
  contentType: string;
  checksum?: string | null;
};

export type ScanResult = {
  fileId: string;
  status: ScanStatus;
  providerKey: "clamav-http";
  scannedAt: string;
  signature?: string | null;
  findings: string[];
};

export type ScannerConfig = {
  apiKey: string;
  maxFileBytes: number;
  timeoutMs: number;
  clamdHost: string;
  clamdPort: number;
  r2AccountId: string;
  r2Bucket: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
};

export type ScanDependencies = {
  fetchObject?: (storageKey: string) => Promise<{ body: Readable; byteSize?: number | null }>;
  pingClamd?: (input: { host: string; port: number; timeoutMs: number }) => Promise<boolean>;
  scanStream?: (body: Readable, input: { maxFileBytes: number; timeoutMs: number }) => Promise<ClamScanOutcome>;
  now?: () => Date;
};

export type ClamScanOutcome =
  | { status: "clean" }
  | { status: "infected"; signature: string }
  | { status: "failed"; reason: string };

export function loadConfig(source: NodeJS.ProcessEnv = process.env): ScannerConfig {
  const required = [
    "SCANNER_API_KEY",
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY"
  ];
  const missing = required.filter((name) => !source[name]);

  if (missing.length) {
    throw new Error(`Missing scanner configuration: ${missing.join(", ")}.`);
  }

  return {
    apiKey: source.SCANNER_API_KEY ?? "",
    maxFileBytes: numberFromEnv(source.MAX_FILE_BYTES, 25 * 1024 * 1024),
    timeoutMs: numberFromEnv(source.SCAN_TIMEOUT_MS, 30_000),
    clamdHost: source.CLAMD_HOST ?? "127.0.0.1",
    clamdPort: numberFromEnv(source.CLAMD_PORT, 3310),
    r2AccountId: source.R2_ACCOUNT_ID ?? "",
    r2Bucket: source.R2_BUCKET ?? "",
    r2AccessKeyId: source.R2_ACCESS_KEY_ID ?? "",
    r2SecretAccessKey: source.R2_SECRET_ACCESS_KEY ?? ""
  };
}

export function validateScanRequest(value: unknown): ScanRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const candidate = value as Partial<ScanRequest>;

  if (!candidate.fileId || typeof candidate.fileId !== "string") {
    throw new Error("fileId is required.");
  }

  if (!candidate.storageKey || typeof candidate.storageKey !== "string" || !isSafeStorageKey(candidate.storageKey)) {
    throw new Error("storageKey is required and must be a safe relative object key.");
  }

  if (!candidate.contentType || typeof candidate.contentType !== "string") {
    throw new Error("contentType is required.");
  }

  if (candidate.checksum !== undefined && candidate.checksum !== null && typeof candidate.checksum !== "string") {
    throw new Error("checksum must be a string when supplied.");
  }

  return {
    fileId: candidate.fileId,
    storageKey: candidate.storageKey,
    contentType: candidate.contentType,
    checksum: candidate.checksum ?? null
  };
}

export async function scanFile(
  request: ScanRequest,
  config: ScannerConfig,
  dependencies: ScanDependencies = {}
): Promise<ScanResult> {
  const now = dependencies.now ?? (() => new Date());

  try {
    const object = await (dependencies.fetchObject ?? createR2ObjectFetcher(config))(request.storageKey);

    if (object.byteSize !== undefined && object.byteSize !== null && object.byteSize > config.maxFileBytes) {
      return result(request.fileId, "failed", now, null, ["oversized_file"]);
    }

    const scan = await (dependencies.scanStream ?? createClamdStreamScanner(config))(object.body, {
      maxFileBytes: config.maxFileBytes,
      timeoutMs: config.timeoutMs
    });

    if (scan.status === "clean") {
      return result(request.fileId, "clean", now, null, []);
    }

    if (scan.status === "infected") {
      return result(request.fileId, "infected", now, scan.signature, ["malware_detected"]);
    }

    return result(request.fileId, "failed", now, null, [scan.reason]);
  } catch {
    return result(request.fileId, "failed", now, null, ["scanner_unavailable"]);
  }
}

export function createR2ObjectFetcher(config: ScannerConfig) {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey
    }
  });

  return async (storageKey: string) => {
    const response = await client.send(new GetObjectCommand({
      Bucket: config.r2Bucket,
      Key: storageKey
    }));

    if (!response.Body) {
      throw new Error("R2 object body was unavailable.");
    }

    return {
      body: Readable.fromWeb(response.Body.transformToWebStream() as unknown as NodeReadableStream),
      byteSize: response.ContentLength ?? null
    };
  };
}

export function createClamdStreamScanner(config: Pick<ScannerConfig, "clamdHost" | "clamdPort">) {
  return (body: Readable, input: { maxFileBytes: number; timeoutMs: number }) => scanStreamWithClamd(
    body,
    {
      host: config.clamdHost,
      port: config.clamdPort,
      maxFileBytes: input.maxFileBytes,
      timeoutMs: input.timeoutMs
    }
  );
}

export async function pingClamd(input: { host: string; port: number; timeoutMs: number }): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const timeout = setTimeout(() => finish(false), input.timeoutMs);
    let settled = false;
    let response = "";

    function finish(value: boolean) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(value);
    }

    socket.on("error", () => finish(false));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");

      if (response.includes("PONG")) {
        finish(true);
      }
    });
    socket.on("close", () => finish(response.includes("PONG")));
    socket.connect(input.port, input.host, () => {
      socket.write("zPING\0");
    });
  });
}

export async function waitForClamd(input: {
  host: string;
  port: number;
  timeoutMs: number;
  intervalMs?: number;
  ping?: (input: { host: string; port: number; timeoutMs: number }) => Promise<boolean>;
}) {
  const startedAt = Date.now();
  const ping = input.ping ?? pingClamd;
  const intervalMs = input.intervalMs ?? 500;

  while (Date.now() - startedAt < input.timeoutMs) {
    if (await ping({ host: input.host, port: input.port, timeoutMs: Math.min(1_000, input.timeoutMs) })) {
      return true;
    }

    await delay(intervalMs);
  }

  return false;
}

export async function scanStreamWithClamd(
  body: Readable,
  input: { host: string; port: number; maxFileBytes: number; timeoutMs: number }
): Promise<ClamScanOutcome> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const timeout = setTimeout(() => finish({ status: "failed", reason: "scan_timeout" }), input.timeoutMs);
    let settled = false;
    let bytesSeen = 0;
    let response = "";

    body.pause();

    function finish(outcome: ClamScanOutcome) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      body.destroy();
      socket.destroy();
      resolve(outcome);
    }

    socket.on("error", () => finish({ status: "failed", reason: "scanner_unavailable" }));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("close", () => {
      if (settled) {
        return;
      }

      finish(parseClamdResponse(response));
    });

    socket.connect(input.port, input.host, () => {
      void streamBodyToClamd();
    });

    async function streamBodyToClamd() {
      try {
        await writeSocket(socket, Buffer.from("zINSTREAM\0"));

        for await (const chunk of body) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytesSeen += buffer.length;

          if (bytesSeen > input.maxFileBytes) {
            finish({ status: "failed", reason: "oversized_file" });
            return;
          }

          const size = Buffer.alloc(4);
          size.writeUInt32BE(buffer.length, 0);
          await writeSocket(socket, size);
          await writeSocket(socket, buffer);
        }

        await writeSocket(socket, Buffer.alloc(4));
      } catch {
        finish({ status: "failed", reason: "object_stream_failed" });
      }
    }
  });
}

async function writeSocket(socket: Socket, chunk: Buffer) {
  if (socket.destroyed) {
    throw new Error("Socket is closed.");
  }

  if (!socket.write(chunk)) {
    await once(socket, "drain");
  }
}

export function parseClamdResponse(value: string): ClamScanOutcome {
  const trimmed = value.replace(/\0/g, "").trim();

  if (!trimmed) {
    return {
      status: "failed",
      reason: "clamd_empty_response"
    };
  }

  if (trimmed.endsWith("OK")) {
    return { status: "clean" };
  }

  const found = trimmed.match(/: (.+) FOUND$/);

  if (found?.[1]) {
    return {
      status: "infected",
      signature: found[1]
    };
  }

  if (trimmed.endsWith("ERROR")) {
    return {
      status: "failed",
      reason: "clamd_error"
    };
  }

  return {
    status: "failed",
    reason: "clamd_unexpected_response"
  };
}

function result(
  fileId: string,
  status: ScanStatus,
  now: () => Date,
  signature: string | null,
  findings: string[]
): ScanResult {
  return {
    fileId,
    status,
    providerKey: "clamav-http",
    scannedAt: now().toISOString(),
    signature,
    findings
  };
}

function isSafeStorageKey(value: string) {
  return !value.startsWith("/") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    value.trim() === value &&
    value.length > 0;
}

function numberFromEnv(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
