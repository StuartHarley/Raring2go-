import { readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { pt, readPageBoxes } from "./boxes.js";
import { chromiumArgs, ghostscriptArgs, inspectPdf, pdfxDefinition, renderPdf, validateRequest } from "./pipeline.js";
import type { PipelineConfig, RenderRequest, Runner } from "./pipeline.js";
import { createRenderServer } from "./server.js";

const config: PipelineConfig = { chromiumPath: "chromium", ghostscriptPath: "gs", outputIntentIcc: "/icc/fogra39.icc", outputIntentName: "FOGRA39", timeoutMs: 1000, maxHtmlBytes: 1_000_000 };
const request: RenderRequest = { kind: "print", html: "<p>x</p>", sheetWidthMm: 228, sheetHeightMm: 315, bleedMm: 3, trimWidthMm: 210, trimHeightMm: 297, marginMm: 9, pageCount: 8, idempotencyKey: "k1" };
const sheets = [
  { sheet: 1, front: { left: 8, right: 1 }, back: { left: 2, right: 7 } },
  { sheet: 2, front: { left: 6, right: 3 }, back: { left: 4, right: 5 } }
];

/**
 * A stand-in for Chromium and Ghostscript that works on real PDFs: "chromium" writes pages of the requested size,
 * "gs" reads its input with pdf-lib and writes it back with the PDF/X markers, optionally dropping the page boxes
 * the way a converter might. Everything the pipeline does with the files in between is the real code.
 */
function fakeRunner(options: { pages?: number; dropBoxes?: boolean; rgb?: boolean } = {}): Runner & { calls: string[][] } {
  const calls: string[][] = [];
  const runner = (async (command: string, args: string[]) => {
    calls.push([command, ...args]);
    if (command === "chromium") {
      const out = args.find((a) => a.startsWith("--print-to-pdf="))!.slice("--print-to-pdf=".length);
      const doc = await PDFDocument.create();
      for (let i = 0; i < (options.pages ?? 8); i += 1) doc.addPage([pt(228), pt(315)]);
      await writeFile(out, await doc.save({ useObjectStreams: false }));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("-c")) {
      const path = /\((.*?)\) \(r\) file/.exec(args[args.length - 1]!)![1]!;
      const doc = await PDFDocument.load(await readFile(path));
      return { code: 0, stdout: `${doc.getPageCount()}\n`, stderr: "" };
    }
    const outPath = args.find((a) => a.startsWith("-sOutputFile="))!.slice("-sOutputFile=".length);
    const inPath = args[args.length - 1]!;
    const doc = await PDFDocument.load(await readFile(inPath));
    if (options.dropBoxes) {
      for (const page of doc.getPages()) {
        page.node.delete(PDFName.of("TrimBox"));
        page.node.delete(PDFName.of("BleedBox"));
      }
    }
    const info = doc.context.lookup(doc.context.trailerInfo.Info) as unknown as { set(key: PDFName, value: unknown): void };
    info.set(PDFName.of("GTS_PDFXVersion"), PDFString.of("PDF/X-1:2001"));
    info.set(PDFName.of("GTS_PDFXConformance"), PDFString.of("PDF/X-1a:2001"));
    doc.catalog.set(PDFName.of("OutputIntents"), doc.context.obj([]));
    if (options.rgb) doc.catalog.set(PDFName.of("Marker"), PDFName.of("DeviceRGB"));
    await writeFile(outPath, await doc.save({ useObjectStreams: false }));
    return { code: 0, stdout: "", stderr: "" };
  }) as unknown as Runner & { calls: string[][] };
  runner.calls = calls;
  return runner;
}

describe("pipeline", () => {
  it("validates requests", () => {
    expect(() => validateRequest({ ...request, kind: "x" }, config)).toThrow();
    expect(() => validateRequest({ ...request, pageCount: 0 }, config)).toThrow();
    expect(() => validateRequest({ ...request, sheetWidthMm: 5000 }, config)).toThrow();
    expect(() => validateRequest({ ...request, html: "x".repeat(2_000_000) }, config)).toThrow(/large/);
    expect(() => validateRequest({ ...request, trimWidthMm: undefined }, config)).toThrow(/required for print/);
    expect(() => validateRequest({ ...request, sheetWidthMm: 230 }, config)).toThrow(/does not match/);
    expect(() => validateRequest({ ...request, marginMm: 2, sheetWidthMm: 214, sheetHeightMm: 301 }, config)).toThrow(/hold the bleed/);
    expect(validateRequest(request, config).pageCount).toBe(8);
  });
  it("validates imposition requests", () => {
    expect(validateRequest({ ...request, impose: { sheets } }, config)).toBeTruthy();
    expect(() => validateRequest({ ...request, impose: { sheets: [] } }, config)).toThrow(/invalid/);
    expect(() => validateRequest({ ...request, impose: { sheets: [{ sheet: 1, front: { left: 8, right: 1 }, back: { left: 2, right: 2 } }] } }, config)).toThrow(/twice|missing/);
    expect(() => validateRequest({ ...request, impose: { sheets: [{ sheet: 1, front: { left: 8, right: 1 }, back: { left: 2, right: 7 } }] } }, config)).toThrow(/every page/);
    expect(() => validateRequest({ ...request, kind: "digital", impose: { sheets } }, config)).toThrow(/Only print/);
  });
  it("builds arguments and the PDF/X definition", () => {
    expect(chromiumArgs("/a.html", "/a.pdf")).toContain("--print-to-pdf=/a.pdf");
    expect(ghostscriptArgs({ defPath: "d", inPath: "i", outPath: "o" })).toEqual(expect.arrayContaining(["-dPDFX", "-sColorConversionStrategy=CMYK", "-dSAFER"]));
    expect(pdfxDefinition({ iccPath: "/x (1).icc", title: "T", outputCondition: "FOGRA39" })).toContain("/x \\(1\\).icc");
  });
  it("renders a press-ready print file with real trim and bleed boxes", async () => {
    const result = await renderPdf(request, config, fakeRunner());
    expect(result.report).toMatchObject({ pressReady: true, pdfx: "PDF/X-1a:2003", colourSpace: "cmyk", pageCount: 8, boxes: true, fontsEmbedded: true });
    const boxes = await readPageBoxes(result.pdf);
    expect(boxes).toHaveLength(8);
    expect(boxes[0]!.trim![2]).toBeCloseTo(210, 1);
    expect(boxes[0]!.bleed![2]).toBeCloseTo(216, 1);
    expect(result.imposed).toBeUndefined();
  });
  it("imposes a saddle-stitch booklet as a second press-ready file", async () => {
    const run = fakeRunner();
    const result = await renderPdf({ ...request, impose: { sheets } }, config, run);
    expect(result.imposed?.report).toMatchObject({ pressReady: true, pageCount: 4, boxes: true });
    const boxes = await readPageBoxes(result.imposed!.pdf);
    expect(boxes).toHaveLength(4);
    expect(boxes[0]!.trim![2]).toBeCloseTo(420, 1);
    expect(boxes[0]!.media[2]).toBeCloseTo(2 * 210 + 18, 1);
    expect(result.imposed!.report.warnings.join(" ")).toMatch(/creep/);
    expect(run.calls.filter((call) => call.includes("-dPDFX"))).toHaveLength(2);
  });
  it("does not call a file press-ready when the converter dropped the boxes, or RGB remains, or no profile is set", async () => {
    const dropped = await renderPdf(request, config, fakeRunner({ dropBoxes: true }));
    expect(dropped.report).toMatchObject({ pressReady: false, boxes: true });
    expect(dropped.report.warnings.join(" ")).toMatch(/dropped/);
    const rgb = await renderPdf(request, config, fakeRunner({ rgb: true }));
    expect(rgb.report).toMatchObject({ pressReady: false, colourSpace: "rgb" });
    await expect(renderPdf(request, { ...config, outputIntentIcc: null }, fakeRunner())).rejects.toThrow(/output intent/);
  });
  it("digital skips Ghostscript conversion and is never press-ready", async () => {
    const run = fakeRunner();
    const result = await renderPdf({ ...request, kind: "digital", bleedMm: 0, sheetWidthMm: 210, sheetHeightMm: 297, trimWidthMm: undefined, trimHeightMm: undefined, marginMm: undefined }, config, run);
    expect(result.report).toMatchObject({ pressReady: false, boxes: false });
    expect(run.calls.some((call) => call.includes("-dPDFX"))).toBe(false);
  });
  it("inspects bytes", () => {
    expect(inspectPdf(Buffer.from("/FontDescriptor /FontDescriptor /FontFile2")).fontsEmbedded).toBe(false);
  });
});

describe("server", () => {
  it("authenticates, validates, renders and de-duplicates", async () => {
    const run = fakeRunner();
    const server = createRenderServer({ secret: "s3cret", config, run });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/render`, { method: "POST", body: "{}" })).status).toBe(401);
      const headers = { authorization: "Bearer s3cret", "content-type": "application/json" };
      expect((await fetch(`${base}/render`, { method: "POST", headers, body: "{}" })).status).toBe(422);
      const ok = await fetch(`${base}/render`, { method: "POST", headers, body: JSON.stringify({ ...request, impose: { sheets } }) });
      expect(ok.status).toBe(200);
      const first = (await ok.json()) as { report: { pressReady: boolean }; imposed: { report: { pageCount: number } } };
      expect(first.report.pressReady).toBe(true);
      expect(first.imposed.report.pageCount).toBe(4);
      const callsAfterFirst = run.calls.length;
      expect((await fetch(`${base}/render`, { method: "POST", headers, body: JSON.stringify({ ...request, impose: { sheets } }) })).status).toBe(200);
      expect(run.calls.length).toBe(callsAfterFirst);
    } finally {
      server.close();
    }
  });
});
