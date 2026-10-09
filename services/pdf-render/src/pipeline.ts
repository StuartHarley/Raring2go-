import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * HTML to PDF with Chromium, then (print only) to PDF/X-1a with Ghostscript. Both programs are run through an
 * injectable runner so the argument building, verification and cleanup are unit-tested without either installed.
 */

export type RenderRequest = {
  kind: "print" | "digital";
  html: string;
  sheetWidthMm: number;
  sheetHeightMm: number;
  bleedMm: number;
  pageCount: number;
  idempotencyKey: string;
};

export type RenderReport = {
  provider: string;
  pressReady: boolean;
  pdfx: "PDF/X-1a:2003" | "PDF/X-4" | "none";
  colourSpace: "cmyk" | "rgb" | "unknown";
  outputIntent: string | null;
  fontsEmbedded: boolean;
  pageCount: number;
  bleedMm: number;
  warnings: string[];
};

export type Runner = (command: string, args: string[], options: { timeoutMs: number }) => Promise<{ code: number; stdout: string; stderr: string }>;

export type PipelineConfig = {
  chromiumPath: string;
  ghostscriptPath: string;
  /** CMYK ICC profile (e.g. FOGRA39 or PSO Coated v3) used as the PDF/X output intent. Required for print. */
  outputIntentIcc: string | null;
  outputIntentName: string;
  timeoutMs: number;
  maxHtmlBytes: number;
};

export class RenderRejected extends Error {}

const MAX_SHEET_MM = 1000;

export function validateRequest(value: unknown, config: Pick<PipelineConfig, "maxHtmlBytes">): RenderRequest {
  if (typeof value !== "object" || value === null) throw new RenderRejected("Body must be an object.");
  const r = value as Record<string, unknown>;
  if (r.kind !== "print" && r.kind !== "digital") throw new RenderRejected("kind must be print or digital.");
  if (typeof r.html !== "string" || r.html.length === 0) throw new RenderRejected("html is required.");
  if (Buffer.byteLength(r.html) > config.maxHtmlBytes) throw new RenderRejected("html is too large.");
  for (const key of ["sheetWidthMm", "sheetHeightMm"] as const) {
    const n = r[key];
    if (typeof n !== "number" || !(n > 50 && n < MAX_SHEET_MM)) throw new RenderRejected(`${key} is out of range.`);
  }
  if (typeof r.bleedMm !== "number" || r.bleedMm < 0 || r.bleedMm > 20) throw new RenderRejected("bleedMm is out of range.");
  if (!Number.isInteger(r.pageCount) || (r.pageCount as number) < 1 || (r.pageCount as number) > 500) throw new RenderRejected("pageCount is out of range.");
  if (typeof r.idempotencyKey !== "string" || r.idempotencyKey.length === 0 || r.idempotencyKey.length > 200) throw new RenderRejected("idempotencyKey is required.");
  return r as unknown as RenderRequest;
}

export function chromiumArgs(htmlPath: string, pdfPath: string): string[] {
  return [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-pdf-header-footer",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=20000",
    // Only data: and https images are placed by the renderer; refuse everything else at the browser too.
    "--host-resolver-rules=MAP localhost 0.0.0.0, MAP 127.0.0.1 0.0.0.0",
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`
  ];
}

/** The PostScript prologue Ghostscript needs to write a PDF/X-1a file with an output intent. */
export function pdfxDefinition(input: { iccPath: string; title: string; outputCondition: string }): string {
  const ps = (value: string) => value.replace(/[\\()]/g, (c) => `\\${c}`);
  return `%!
/ICCProfile (${ps(input.iccPath)}) def
[ /_objdef {icc_PDFX} /type /stream /OBJ pdfmark
[ {icc_PDFX} << /N 4 >> /PUT pdfmark
[ {icc_PDFX} ICCProfile (r) file /PUT pdfmark
[ /GTS_PDFXVersion (PDF/X-1:2001) /GTS_PDFXConformance (PDF/X-1a:2001) /Title (${ps(input.title)}) /Trapped /False /DOCINFO pdfmark
[ /_objdef {OutputIntent_PDFX} /type /dict /OBJ pdfmark
[ {OutputIntent_PDFX} << /Type /OutputIntent /S /GTS_PDFX /OutputCondition (${ps(input.outputCondition)}) /OutputConditionIdentifier (${ps(input.outputCondition)}) /RegistryName (http://www.color.org) /Info (${ps(input.outputCondition)}) /DestOutputProfile {icc_PDFX} >> /PUT pdfmark
[ {Catalog} << /OutputIntents [ {OutputIntent_PDFX} ] >> /PUT pdfmark
`;
}

export function ghostscriptArgs(input: { defPath: string; inPath: string; outPath: string }): string[] {
  return [
    "-dBATCH", "-dNOPAUSE", "-dNOOUTERSAVE", "-dQUIET", "-dSAFER",
    "-dPDFX",
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.3",
    "-dPDFSETTINGS=/prepress",
    "-sColorConversionStrategy=CMYK",
    "-sProcessColorModel=DeviceCMYK",
    "-dEmbedAllFonts=true",
    "-dSubsetFonts=true",
    "-dAutoRotatePages=/None",
    `-sOutputFile=${input.outPath}`,
    input.defPath,
    input.inPath
  ];
}

export function pageCountArgs(path: string): string[] {
  return ["-q", "-dNODISPLAY", "-dNOSAFER", "-c", `(${path.replace(/[\\()]/g, (c) => `\\${c}`)}) (r) file runpdfbegin pdfpagecount = quit`];
}

/** Reads what can be established from the file's own bytes. Anything not proven is reported as not proven. */
export function inspectPdf(bytes: Uint8Array): { pdfx: RenderReport["pdfx"]; hasOutputIntent: boolean; rgb: boolean; fontsEmbedded: boolean } {
  const text = Buffer.from(bytes).toString("latin1");
  const pdfx = /GTS_PDFXVersion\s*\(PDF\/X-1/.test(text) ? "PDF/X-1a:2003" as const : "none" as const;
  const fontDescriptors = text.match(/\/FontDescriptor/g)?.length ?? 0;
  const embedded = text.match(/\/FontFile[23]?\b/g)?.length ?? 0;
  return {
    pdfx: /GTS_PDFXConformance\s*\(PDF\/X-1a/.test(text) ? pdfx : "none",
    hasOutputIntent: /\/OutputIntents/.test(text),
    rgb: /\/DeviceRGB/.test(text),
    fontsEmbedded: fontDescriptors === embedded
  };
}

export async function renderPdf(request: RenderRequest, config: PipelineConfig, run: Runner): Promise<{ pdf: Uint8Array; sha256: string; report: RenderReport }> {
  const dir = await mkdtemp(join(tmpdir(), "render-"));
  try {
    const htmlPath = join(dir, "edition.html");
    const rawPath = join(dir, "chromium.pdf");
    await writeFile(htmlPath, request.html, { mode: 0o600 });
    const chrome = await run(config.chromiumPath, chromiumArgs(htmlPath, rawPath), { timeoutMs: config.timeoutMs });
    if (chrome.code !== 0) throw new Error(`Chromium exited with ${chrome.code}: ${chrome.stderr.slice(0, 300)}`);

    let finalPath = rawPath;
    const warnings: string[] = [];
    if (request.kind === "print") {
      if (!config.outputIntentIcc) throw new RenderRejected("No CMYK output intent profile is configured, so press-ready output is not possible.");
      const defPath = join(dir, "PDFX_def.ps");
      finalPath = join(dir, "press.pdf");
      await writeFile(defPath, pdfxDefinition({ iccPath: config.outputIntentIcc, title: "Raring2go edition", outputCondition: config.outputIntentName }));
      const gs = await run(config.ghostscriptPath, ghostscriptArgs({ defPath, inPath: rawPath, outPath: finalPath }), { timeoutMs: config.timeoutMs });
      if (gs.code !== 0) throw new Error(`Ghostscript exited with ${gs.code}: ${gs.stderr.slice(0, 300)}`);
    }

    const counted = await run(config.ghostscriptPath, pageCountArgs(finalPath), { timeoutMs: 30_000 });
    const pageCount = Number.parseInt(counted.stdout.trim(), 10);
    if (counted.code !== 0 || !Number.isInteger(pageCount)) throw new Error("The page count could not be read from the PDF.");

    const pdf = new Uint8Array(await readFile(finalPath));
    const facts = inspectPdf(pdf);
    if (request.kind === "print") {
      if (facts.rgb) warnings.push("Some RGB colour remains in the file.");
      if (!facts.hasOutputIntent) warnings.push("No output intent was written.");
    }
    const report: RenderReport = {
      provider: "chromium-ghostscript",
      pressReady: request.kind === "print" && facts.pdfx !== "none" && facts.hasOutputIntent && !facts.rgb && facts.fontsEmbedded,
      pdfx: request.kind === "print" ? facts.pdfx : "none",
      colourSpace: request.kind === "print" ? (facts.rgb ? "rgb" : "cmyk") : "rgb",
      outputIntent: request.kind === "print" ? config.outputIntentName : null,
      fontsEmbedded: facts.fontsEmbedded,
      pageCount,
      bleedMm: request.bleedMm,
      warnings
    };
    return { pdf, sha256: createHash("sha256").update(pdf).digest("hex"), report };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
