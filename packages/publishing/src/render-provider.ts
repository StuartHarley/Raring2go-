import { createHash } from "node:crypto";
import type { ImposedSheet } from "./imposition";

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
  /** Print only: the trim size and the room from trim to sheet edge, which become the PDF's TrimBox and BleedBox. */
  trimWidthMm?: number;
  trimHeightMm?: number;
  marginMm?: number;
  /** Print only: also lay the pages out as an imposed saddle-stitch booklet. */
  impose?: { sheets: ImposedSheet[] };
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
  /** TrimBox and BleedBox are recorded on every page and match the trim size. */
  boxes: boolean;
  warnings: string[];
};

export type RenderOutput = { pdf: Uint8Array; sha256: string; report: RenderReport };
export type RenderResult = RenderOutput & { imposed?: RenderOutput };

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

function verifyPrintFile(label: string, output: RenderOutput, expectedPages: number, bleedMm: number): string[] {
  const problems: string[] = [];
  const head = output.pdf.slice(0, 5);
  if (head.length < 5 || PDF_MAGIC.some((byte, index) => head[index] !== byte)) problems.push(`${label} is not a PDF.`);
  if (output.sha256 !== sha256Hex(output.pdf)) problems.push(`${label} does not match its checksum.`);
  if (output.report.pageCount !== expectedPages) problems.push(`${label} should have ${expectedPages} pages but has ${output.report.pageCount}.`);
  if (!output.report.fontsEmbedded) problems.push(`${label} has fonts that are not embedded.`);
  if (output.report.pdfx === "none") problems.push(`${label} is not PDF/X.`);
  if (output.report.colourSpace !== "cmyk") problems.push(`${label} is not CMYK.`);
  if (!output.report.boxes) problems.push(`${label} has no confirmed trim and bleed boxes.`);
  if (output.report.bleedMm + 0.001 < bleedMm) problems.push(`${label} has less bleed than the template requires.`);
  return problems;
}

/** A returned file is only accepted if it looks like a PDF and matches what the provider claims about it. */
export function verifyRenderResult(request: RenderRequest, result: RenderResult): string[] {
  if (request.kind === "print") {
    const problems = verifyPrintFile("The print file", result, request.pageCount, request.bleedMm);
    if (request.impose) {
      if (!result.imposed) problems.push("The imposed booklet is missing.");
      else problems.push(...verifyPrintFile("The imposed booklet", result.imposed, request.impose.sheets.length * 2, request.bleedMm));
    }
    return problems;
  }
  const problems: string[] = [];
  const head = result.pdf.slice(0, 5);
  if (head.length < 5 || PDF_MAGIC.some((byte, index) => head[index] !== byte)) problems.push("The returned file is not a PDF.");
  if (result.sha256 !== sha256Hex(result.pdf)) problems.push("The returned file does not match its checksum.");
  if (result.report.pageCount !== request.pageCount) problems.push(`Expected ${request.pageCount} pages but the file has ${result.report.pageCount}.`);
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
      let body: { pdfBase64?: unknown; report?: unknown; imposed?: { pdfBase64?: unknown; report?: unknown } };
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
      if (body.imposed) {
        if (typeof body.imposed.pdfBase64 !== "string" || typeof body.imposed.report !== "object" || body.imposed.report === null) {
          throw new RenderProviderError("The render service returned an incomplete imposed file.", "invalid_response", true);
        }
        const imposedPdf = new Uint8Array(Buffer.from(body.imposed.pdfBase64, "base64"));
        result.imposed = { pdf: imposedPdf, sha256: sha256Hex(imposedPdf), report: body.imposed.report as RenderReport };
      }
      const problems = verifyRenderResult(request, result);
      if (problems.length > 0) throw new RenderProviderError(`The render result failed verification: ${problems.join(" ")}`, "invalid_response", false);
      return result;
    }
  };
}
