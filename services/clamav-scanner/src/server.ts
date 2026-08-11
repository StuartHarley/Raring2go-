import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { scanFile, validateScanRequest, type ScanDependencies, type ScannerConfig } from "./scanner.js";

export function createScannerServer(config: ScannerConfig, dependencies: ScanDependencies = {}) {
  return createServer(async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff");

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method !== "POST" || request.url !== "/scan") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    const auth = request.headers.authorization;

    if (auth !== `Bearer ${config.apiKey}`) {
      sendJson(response, 401, { error: "unauthorised" });
      return;
    }

    try {
      const body = await readJson(request, config.maxFileBytes);
      const scanRequest = validateScanRequest(body);
      const result = await scanFile(scanRequest, config, dependencies);
      sendJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid scan request.";
      sendJson(response, 400, {
        error: "bad_request",
        message: safeMessage(message)
      });
    }
  });
}

if (process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts")) {
  const config = loadConfigOrExit();
  const port = Number(process.env.PORT ?? 3000);
  const server = createScannerServer(config);

  server.listen(port, () => {
    console.info(`Raring2go ClamAV scanner listening on port ${port}.`);
  });
}

function loadConfigOrExit(): ScannerConfig {
  try {
    return {
      apiKey: requireEnv("SCANNER_API_KEY"),
      maxFileBytes: numberFromEnv(process.env.MAX_FILE_BYTES, 25 * 1024 * 1024),
      timeoutMs: numberFromEnv(process.env.SCAN_TIMEOUT_MS, 30_000),
      clamdHost: process.env.CLAMD_HOST ?? "127.0.0.1",
      clamdPort: numberFromEnv(process.env.CLAMD_PORT, 3310),
      r2AccountId: requireEnv("R2_ACCOUNT_ID"),
      r2Bucket: requireEnv("R2_BUCKET"),
      r2AccessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      r2SecretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY")
    };
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Scanner configuration failed.");
    process.exit(1);
  }
}

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }

  return value;
}

async function readJson(request: IncomingMessage, maxBytes: number) {
  let size = 0;
  let value = "";

  for await (const chunk of request) {
    size += chunk.length;

    if (size > Math.min(maxBytes, 1_000_000)) {
      throw new Error("Request body is too large.");
    }

    value += chunk.toString("utf8");
  }

  return JSON.parse(value);
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function safeMessage(value: string) {
  return value.replace(/Bearer\s+\S+/gi, "Bearer [hidden]");
}

function numberFromEnv(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
