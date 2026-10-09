import { createHash } from "node:crypto";

/**
 * The seam between the Edition Factory and whatever turns HTML into a PDF. Production uses the Chromium +
 * Ghostscript service in `services/pdf-render`; development and tests use a deterministic stand-in that is
 * explicitly marked as not press-ready, so a stand-in file can never be mistaken for one that is.
 */

export type RenderKind = "print" | "digital";

export type RenderRequest = {
  kind: RenderKind;
  html: string;
  /** Sheet size in millimetres, including bleed for print. */
  sheetWidthMm: number;
  sheetHeightMm: number;
  bleedMm: number;
  pageCount: number;
  /** Lets the service de-duplicate a retried request. */
  idempotencyKey: string;
};

export type RenderReport = {
  provider: string;
  /** True only when the file passed a real PDF/X conversion and verification. */
  pressReady: boolean;
  pdfx: "PDF/X-1a:2003" | "PDF/X-4" | "none";
  colourSpace: "cmyk" | "rgb" | "unknown";
  outputIntent: string | null;
  fontsEmbedded: boolean;
  pageCount: number;
  bleedMm: number;
  warnings: string[];
};

export type RenderResult = { pdf: Uint8Array; sha256: string; report: RenderReport };

export type RenderProvider = {
  key: string;
  render(request: RenderRequest): Promise<RenderResult>;
};

export class RenderProviderError extends Error {
  constructor(message: string, readonly code: "unavailable" | "rejected" | "invalid_response" | "timeout" | "not_configured", readonly retryable: boolean) {
    super(message);
    this.name = "RenderProviderError";
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** A returned file is only accepted if it looks like a PDF and matches what the provider claims about it. */
export function verifyRenderResult(request: RenderRequest, result: RenderResult): string[] {
  const problems: string[] = [];
  const head = result.pdf.slice(0, 5);
  if (head.length < 5 || PDF_MAGIC.some((byte, index) => head[index] !== byte)) problems.push("The returned file is not a PDF.");
  if (result.sha256 !== sha256Hex(result.pdf)) problems.push("The returned file does not match its checksum.");
  if (result.report.pageCount !== request.pageCount) problems.push(`Expected ${request.pageCount} pages but the file has ${result.report.pageCount}.`);
  if (request.kind === "print") {
    if (!result.report.fontsEmbedded) problems.push("Fonts are not embedded.");
    if (result.report.pdfx === "none") problems.push("The file is not PDF/X.");
    if (result.report.colourSpace !== "cmyk") problems.push("The file is not CMYK.");
    if (result.report.bleedMm + 0.001 < request.bleedMm) problems.push("Bleed is smaller than the template requires.");
  }
  return problems;
}

type Fetch = typeof fetch;

/**
 * Calls the render service over HTTPS with a bearer secret. The service address is operator configuration, never
 * user input, but plain http is still refused outside localhost so a misconfiguration cannot send content in the clear.
 */
export function createHttpRenderProvider(input: { baseUrl: string; secret: string; timeoutMs?: number; fetch?: Fetch }): RenderProvider {
  const base = new URL(input.baseUrl);
  const local = base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "[::1]";
  if (base.protocol !== "https:" && !local) throw new RenderProviderError("The render service must use https.", "not_configured", false);
  if (!input.secret) throw new RenderProviderError("The render service secret is not set.", "not_configured", false);
  return {
    key: "chromium-ghostscript",
    async render(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 240_000);
      let response: Response;
      try {
        response = await (input.fetch ?? fetch)(new URL("/render", base), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${input.secret}`, "idempotency-key": request.idempotencyKey },
          body: JSON.stringify(request),
          signal: controller.signal
        });
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        throw new RenderProviderError(aborted ? "The render service timed out." : "The render service could not be reached.", aborted ? "timeout" : "unavailable", true);
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 400 || response.status === 422) {
        const detail = await response.text().catch(() => "");
        throw new RenderProviderError(`The render service rejected the job: ${detail.slice(0, 300)}`, "rejected", false);
      }
      if (!response.ok) throw new RenderProviderError(`The render service answered HTTP ${response.status}.`, "unavailable", response.status >= 500 || response.status === 429);
      let body: { pdfBase64?: unknown; report?: unknown };
      try {
        body = (await response.json()) as typeof body;
      } catch {
        throw new RenderProviderError("The render service returned an unreadable response.", "invalid_response", true);
      }
      if (typeof body.pdfBase64 !== "string" || typeof body.report !== "object" || body.report === null) {
        throw new RenderProviderError("The render service returned an incomplete response.", "invalid_response", true);
      }
      const pdf = new Uint8Array(Buffer.from(body.pdfBase64, "base64"));
      const result: RenderResult = { pdf, sha256: sha256Hex(pdf), report: body.report as RenderReport };
      const problems = verifyRenderResult(request, result);
      if (problems.length > 0) throw new RenderProviderError(`The render result failed verification: ${problems.join(" ")}`, "invalid_response", false);
      return result;
    }
  };
}
