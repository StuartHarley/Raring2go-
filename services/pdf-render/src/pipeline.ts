import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boxesMatch, imposeBooklet, setPageBoxes } from "./boxes.js";
import type { ImposedSheet, SheetGeometry } from "./boxes.js";

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
  /** Trim size and the room from trim to sheet edge. Required for print, where they become the PDF's TrimBox and BleedBox. */
  trimWidthMm?: number;
  trimHeightMm?: number;
  marginMm?: number;
  /** Also produce an imposed booklet file, laid out by these sheets (see the app's saddle-stitch ordering). */
  impose?: { sheets: ImposedSheet[] };
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
  /** TrimBox and BleedBox are present on every page and match the trim size that was asked for. */
  boxes: boolean;
  warnings: string[];
};

export type RenderOutput = { pdf: Uint8Array; sha256: string; report: RenderReport };
export type RenderResult = RenderOutput & { imposed?: RenderOutput };

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
  if (r.kind === "print") {
    for (const key of ["trimWidthMm", "trimHeightMm", "marginMm"] as const) {
      const n = r[key];
      if (typeof n !== "number" || !(n > 0 && n < MAX_SHEET_MM)) throw new RenderRejected(`${key} is required for print.`);
    }
    const margin = r.marginMm as number;
    if (Math.abs((r.trimWidthMm as number) + 2 * margin - (r.sheetWidthMm as number)) > 0.01 || Math.abs((r.trimHeightMm as number) + 2 * margin - (r.sheetHeightMm as number)) > 0.01) {
      throw new RenderRejected("The sheet size does not match the trim size and margin.");
    }
    if ((r.marginMm as number) < (r.bleedMm as number)) throw new RenderRejected("The margin must hold the bleed.");
  }
  if (r.impose !== undefined) {
    if (r.kind !== "print") throw new RenderRejected("Only print can be imposed.");
    const sheets = (r.impose as { sheets?: unknown }).sheets;
    if (!Array.isArray(sheets) || sheets.length === 0 || sheets.length > 125) throw new RenderRejected("impose.sheets is invalid.");
    const seen = new Set<number>();
    for (const sheet of sheets as Array<Record<string, Record<string, unknown>>>) {
      for (const side of [sheet?.front, sheet?.back]) {
        for (const value of [side?.left, side?.right]) {
          if (value === null) continue;
          if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > (r.pageCount as number) || seen.has(value as number)) throw new RenderRejected("impose.sheets refers to a page that is missing or used twice.");
          seen.add(value as number);
        }
      }
    }
    if (seen.size !== r.pageCount) throw new RenderRejected("impose.sheets must use every page exactly once.");
  }
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

/**
 * Reads the finished file and states only what is true of it. Boxes are set before the PDF/X conversion; if the
 * converter dropped them they are written back afterwards, and then the file is not called press-ready, because the
 * PDF library that writes them stamps a newer PDF version than PDF/X-1a allows.
 */
async function finish(bytes: Uint8Array, request: RenderRequest, geometry: SheetGeometry, expectedPages: number, config: PipelineConfig, warnings: string[]): Promise<RenderOutput> {
  let pdf = bytes;
  let boxes = await boxesMatch(pdf, geometry.trimWidthMm, expectedPages);
  let boxesRestored = false;
  if (!boxes) {
    pdf = await setPageBoxes(pdf, geometry);
    boxes = await boxesMatch(pdf, geometry.trimWidthMm, expectedPages);
    boxesRestored = true;
    warnings.push("The converter dropped the TrimBox and BleedBox, so they were written back afterwards; the PDF version is no longer 1.3. Verify PDF/X conformance before use.");
  }
  const facts = inspectPdf(pdf);
  if (!boxes) warnings.push("TrimBox and BleedBox could not be confirmed on every page.");
  if (facts.rgb) warnings.push("Some RGB colour remains in the file.");
  if (!facts.hasOutputIntent) warnings.push("No output intent was written.");
  return {
    pdf,
    sha256: createHash("sha256").update(pdf).digest("hex"),
    report: {
      provider: "chromium-ghostscript",
      pressReady: facts.pdfx !== "none" && facts.hasOutputIntent && !facts.rgb && facts.fontsEmbedded && boxes && !boxesRestored,
      pdfx: facts.pdfx,
      colourSpace: facts.rgb ? "rgb" : "cmyk",
      outputIntent: config.outputIntentName,
      fontsEmbedded: facts.fontsEmbedded,
      pageCount: expectedPages,
      bleedMm: request.bleedMm,
      boxes,
      warnings
    }
  };
}

async function toPdfx(run: Runner, config: PipelineConfig, dir: string, name: string, inPath: string): Promise<string> {
  const defPath = join(dir, `${name}.PDFX_def.ps`);
  const outPath = join(dir, `${name}.pdf`);
  await writeFile(defPath, pdfxDefinition({ iccPath: config.outputIntentIcc!, title: "Raring2go edition", outputCondition: config.outputIntentName }));
  const gs = await run(config.ghostscriptPath, ghostscriptArgs({ defPath, inPath, outPath }), { timeoutMs: config.timeoutMs });
  if (gs.code !== 0) throw new Error(`Ghostscript exited with ${gs.code}: ${gs.stderr.slice(0, 300)}`);
  return outPath;
}

async function countPages(run: Runner, config: PipelineConfig, path: string): Promise<number> {
  const counted = await run(config.ghostscriptPath, pageCountArgs(path), { timeoutMs: 30_000 });
  const pageCount = Number.parseInt(counted.stdout.trim(), 10);
  if (counted.code !== 0 || !Number.isInteger(pageCount)) throw new Error("The page count could not be read from the PDF.");
  return pageCount;
}

export async function renderPdf(request: RenderRequest, config: PipelineConfig, run: Runner): Promise<RenderResult> {
  const dir = await mkdtemp(join(tmpdir(), "render-"));
  const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  try {
    const htmlPath = join(dir, "edition.html");
    const rawPath = join(dir, "chromium.pdf");
    await writeFile(htmlPath, request.html, { mode: 0o600 });
    const chrome = await run(config.chromiumPath, chromiumArgs(htmlPath, rawPath), { timeoutMs: config.timeoutMs });
    if (chrome.code !== 0) throw new Error(`Chromium exited with ${chrome.code}: ${chrome.stderr.slice(0, 300)}`);

    if (request.kind === "digital") {
      const pageCount = await countPages(run, config, rawPath);
      const pdf = new Uint8Array(await readFile(rawPath));
      return { pdf, sha256: digest(pdf), report: { provider: "chromium-ghostscript", pressReady: false, pdfx: "none", colourSpace: "rgb", outputIntent: null, fontsEmbedded: inspectPdf(pdf).fontsEmbedded, pageCount, bleedMm: 0, boxes: false, warnings: [] } };
    }

    if (!config.outputIntentIcc) throw new RenderRejected("No CMYK output intent profile is configured, so press-ready output is not possible.");
    const geometry: SheetGeometry = { trimWidthMm: request.trimWidthMm!, trimHeightMm: request.trimHeightMm!, bleedMm: request.bleedMm, marginMm: request.marginMm! };

    // Boxes go on before the PDF/X conversion, which is asked to carry them through; `finish` checks that it did.
    const boxedRaw = join(dir, "boxed.pdf");
    await writeFile(boxedRaw, await setPageBoxes(new Uint8Array(await readFile(rawPath)), geometry));
    const pressPath = await toPdfx(run, config, dir, "press", boxedRaw);
    const press = await finish(new Uint8Array(await readFile(pressPath)), request, geometry, await countPages(run, config, pressPath), config, []);

    if (!request.impose) return press;

    const spreadGeometry: SheetGeometry = { ...geometry, trimWidthMm: geometry.trimWidthMm * 2 };
    const imposedRawPath = join(dir, "imposed-raw.pdf");
    await writeFile(imposedRawPath, await setPageBoxes(await imposeBooklet(press.pdf, geometry, request.impose.sheets), spreadGeometry));
    const imposedPath = await toPdfx(run, config, dir, "imposed", imposedRawPath);
    const imposed = await finish(new Uint8Array(await readFile(imposedPath)), request, spreadGeometry, await countPages(run, config, imposedPath), config, ["Simple saddle-stitch imposition: no creep, gripper margin or press-sheet size."]);
    return { ...press, imposed };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
