import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { chromiumArgs, ghostscriptArgs, inspectPdf, pdfxDefinition, renderPdf, validateRequest } from "./pipeline.js";
import type { PipelineConfig, Runner } from "./pipeline.js";
import { createRenderServer } from "./server.js";

const config: PipelineConfig = { chromiumPath: "chromium", ghostscriptPath: "gs", outputIntentIcc: "/icc/fogra39.icc", outputIntentName: "FOGRA39", timeoutMs: 1000, maxHtmlBytes: 1_000_000 };
const request = { kind: "print", html: "<p>x</p>", sheetWidthMm: 216, sheetHeightMm: 303, bleedMm: 3, pageCount: 2, idempotencyKey: "k1" } as const;

const pressPdf = "%PDF-1.3\n/GTS_PDFXVersion (PDF/X-1:2001) /GTS_PDFXConformance (PDF/X-1a:2001)\n/OutputIntents [1 0 R]\n/FontDescriptor /FontFile\n";

function fakeRunner(pdfText: string, pages = "2"): Runner & { calls: string[][] } {
  const calls: string[][] = [];
  const runner = ((async (command: string, args: string[]) => {
    calls.push([command, ...args]);
    const out = args.find((a) => a.startsWith("--print-to-pdf=") || a.startsWith("-sOutputFile="));
    if (out) {
      const path = out.slice(out.indexOf("=") + 1);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, command === "gs" ? pdfText : "%PDF-1.4 raw");
    }
    return { code: 0, stdout: args.includes("-c") ? `${pages}\n` : "", stderr: "" };
  }) as unknown) as Runner & { calls: string[][] };
  runner.calls = calls;
  return runner;
}

describe("pipeline", () => {
  it("validates requests", () => {
    expect(() => validateRequest({ ...request, kind: "x" }, config)).toThrow();
    expect(() => validateRequest({ ...request, pageCount: 0 }, config)).toThrow();
    expect(() => validateRequest({ ...request, sheetWidthMm: 5000 }, config)).toThrow();
    expect(() => validateRequest({ ...request, html: "x".repeat(2_000_000) }, config)).toThrow(/large/);
    expect(validateRequest(request, config).pageCount).toBe(2);
  });
  it("builds arguments and the PDF/X definition", () => {
    expect(chromiumArgs("/a.html", "/a.pdf")).toContain("--print-to-pdf=/a.pdf");
    expect(ghostscriptArgs({ defPath: "d", inPath: "i", outPath: "o" })).toEqual(expect.arrayContaining(["-dPDFX", "-sColorConversionStrategy=CMYK", "-dSAFER"]));
    expect(pdfxDefinition({ iccPath: "/x (1).icc", title: "T", outputCondition: "FOGRA39" })).toContain("/x \\(1\\).icc");
  });
  it("renders a press-ready print file and reports facts from the file", async () => {
    const run = fakeRunner(pressPdf);
    const result = await renderPdf(request, config, run);
    expect(result.report).toMatchObject({ pressReady: true, pdfx: "PDF/X-1a:2003", colourSpace: "cmyk", pageCount: 2, fontsEmbedded: true });
    expect(run.calls.some((call) => call[0] === "gs" && call.includes("-dPDFX"))).toBe(true);
  });
  it("does not claim press-ready when RGB remains or no profile is set", async () => {
    const rgb = await renderPdf(request, config, fakeRunner(`${pressPdf}/DeviceRGB`));
    expect(rgb.report.pressReady).toBe(false);
    expect(rgb.report.colourSpace).toBe("rgb");
    await expect(renderPdf(request, { ...config, outputIntentIcc: null }, fakeRunner(pressPdf))).rejects.toThrow(/output intent/);
  });
  it("digital skips Ghostscript conversion and is never press-ready", async () => {
    const run = fakeRunner(pressPdf);
    const result = await renderPdf({ ...request, kind: "digital" }, config, run);
    expect(result.report.pressReady).toBe(false);
    expect(run.calls.some((call) => call.includes("-dPDFX"))).toBe(false);
  });
  it("inspects bytes", () => {
    expect(inspectPdf(Buffer.from("/FontDescriptor /FontDescriptor /FontFile2")).fontsEmbedded).toBe(false);
  });
});

describe("server", () => {
  it("authenticates, validates, renders and de-duplicates", async () => {
    const run = fakeRunner(pressPdf);
    const server = createRenderServer({ secret: "s3cret", config, run });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/render`, { method: "POST", body: "{}" })).status).toBe(401);
      const headers = { authorization: "Bearer s3cret", "content-type": "application/json" };
      expect((await fetch(`${base}/render`, { method: "POST", headers, body: "{}" })).status).toBe(422);
      const ok = await fetch(`${base}/render`, { method: "POST", headers, body: JSON.stringify(request) });
      expect(ok.status).toBe(200);
      const first = (await ok.json()) as { report: { pressReady: boolean } };
      expect(first.report.pressReady).toBe(true);
      const callsAfterFirst = run.calls.length;
      expect((await fetch(`${base}/render`, { method: "POST", headers, body: JSON.stringify(request) })).status).toBe(200);
      expect(run.calls.length).toBe(callsAfterFirst);
    } finally {
      server.close();
    }
  });
});
