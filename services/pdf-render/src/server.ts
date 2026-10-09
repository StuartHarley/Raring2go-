import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { RenderRejected, renderPdf, validateRequest } from "./pipeline.js";
import type { PipelineConfig, RenderReport, RenderRequest, Runner } from "./pipeline.js";

export const spawnRunner: Runner = (command, args, { timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < 1_000_000) stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 1_000_000) stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
  });

function authorised(header: string | undefined, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new RenderRejected("Request body is too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RenderRejected("Body is not valid JSON.");
  }
}

export function createRenderServer(input: { secret: string; config: PipelineConfig; run?: Runner; maxConcurrent?: number }) {
  const run = input.run ?? spawnRunner;
  const limit = input.maxConcurrent ?? 1;
  let active = 0;
  const done = new Map<string, { pdfBase64: string; report: RenderReport }>();
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true });
    if (request.method !== "POST" || request.url !== "/render") return send(response, 404, { error: "not_found" });
    if (!authorised(request.headers.authorization, input.secret)) return send(response, 401, { error: "unauthorised" });
    // One Chromium at a time by default: a 28-page edition is memory hungry. The caller retries on 429.
    if (active >= limit) return send(response, 429, { error: "busy" });
    active += 1;
    try {
      const body: RenderRequest = validateRequest(await readJson(request, input.config.maxHtmlBytes + 4096), input.config);
      const cached = done.get(body.idempotencyKey);
      if (cached) return send(response, 200, cached);
      const result = await renderPdf(body, input.config, run);
      const payload = { pdfBase64: Buffer.from(result.pdf).toString("base64"), report: result.report };
      done.set(body.idempotencyKey, payload);
      if (done.size > 4) done.delete(done.keys().next().value as string);
      send(response, 200, payload);
    } catch (error) {
      if (error instanceof RenderRejected) return send(response, 422, { error: "rejected", message: error.message });
      console.error("render failed", error instanceof Error ? error.message : "unknown");
      send(response, 500, { error: "render_failed" });
    } finally {
      active -= 1;
    }
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const secret = process.env.RENDER_API_KEY;
  if (!secret) throw new Error("RENDER_API_KEY is required.");
  const config: PipelineConfig = {
    chromiumPath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    ghostscriptPath: process.env.GHOSTSCRIPT_PATH ?? "/usr/bin/gs",
    outputIntentIcc: process.env.OUTPUT_INTENT_ICC ?? null,
    outputIntentName: process.env.OUTPUT_INTENT_NAME ?? "FOGRA39",
    timeoutMs: Number(process.env.RENDER_TIMEOUT_MS ?? 180_000),
    maxHtmlBytes: Number(process.env.RENDER_MAX_HTML_BYTES ?? 20_000_000)
  };
  createRenderServer({ secret, config }).listen(Number(process.env.PORT ?? 3000));
}
