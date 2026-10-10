import { describe, expect, it } from "vitest";
import { derivePageArtifact, cropMarks, printMarginMm, blockingRenderIssues, buildEditionRenderModel, escapeHtml, renderEditionHtml, safeImageUrl, validateZoneGeometry, zonesOf } from "./render";
import { createHttpRenderProvider, RenderProviderError, sha256Hex, verifyRenderResult } from "./render-provider";
import type { PublishingData } from "./types";

const version = {
  id: "v1", templateId: "t1", version: 1, status: "published",
  pageDimensions: {}, bleed: { top: 3, right: 3, bottom: 3, left: 3 }, trim: { width: 210, height: 297 }, margins: { top: 12, right: 12, bottom: 14, left: 12 },
  grid: {}, lockedElements: [{ id: "masthead" }],
  editableZones: [{ id: "picks", type: "highlight_list", maxItems: 2 }],
  imageZones: [{ id: "hero", x: 0, y: 0, width: 210, height: 100 }],
  copyZones: [{ id: "strap", maxWords: 3 }],
  headlineZones: [{ id: "head", maxCharacters: 10 }],
  advertiserZones: [], footerFurniture: { pageNumber: true, issueDate: true }, printRules: {}, digitalEnhancements: {}
} as never;

function data(content: Record<string, unknown>): PublishingData {
  return {
    seasons: [{ id: "s", accent: "#c04000" }],
    territoryEditions: [], magazineTemplateVersions: [version],
    editionPages: [{ id: "p1", territoryEditionId: "e1", pageNumber: 1, side: "single", templateVersionId: "v1", assignedContentId: "c1", status: "in_progress", readiness: "ready", issues: [], comments: [] }],
    territoryEditionContent: [{ id: "c1", territoryEditionId: "e1", sourceContentItemId: "i1", effectiveContent: content }],
    editionContentItems: [{ id: "i1", title: "Cover story" }],
    editionPageRevisions: []
  } as unknown as PublishingData;
}
const edition = { id: "e1", seasonId: "s", territoryId: "t", title: "Autumn <2026>", publicationDate: "2026-10-01" } as never;

describe("edition render model", () => {
  it("fills zones from effective content and escapes output", () => {
    const model = buildEditionRenderModel(data({ zones: { head: "Hi <b>", strap: "one two" }, images: { hero: { url: "https://x.test/a.jpg", alt: "A" } } }), edition);
    const html = renderEditionHtml(model, "print");
    expect(html).toContain("Hi &lt;b&gt;");
    expect(html).toContain("Autumn &lt;2026&gt;");
    expect(html).toContain("size: 228mm 315mm");
    expect(html.match(/class="mark"/g)).toHaveLength(8);
    expect(model.pages[0]?.furniture.issueDate).toBe("2026-10-01");
    expect(blockingRenderIssues(model)).toEqual([]);
  });
  it("flags overflow, too many items and missing required images", () => {
    const model = buildEditionRenderModel(data({ imageRequired: true, zones: { head: "far too long headline", strap: "a b c d", picks: ["1", "2", "3"] } }), edition);
    const codes = blockingRenderIssues(model).map((issue) => issue.code).sort();
    expect(codes).toEqual(["copy_overflow", "copy_overflow", "missing_image", "too_many_items"]);
  });
  it("refuses a page without a template and renders digital at trim size", () => {
    const d = data({});
    d.editionPages[0]!.templateVersionId = null;
    expect(() => buildEditionRenderModel(d, edition)).toThrow(/no template/);
    const model = buildEditionRenderModel(data({}), edition);
    expect(renderEditionHtml(model, "digital")).toContain("size: 210mm 297mm");
  });
  it("validates geometry and rejects unsafe image URLs", () => {
    const zones = zonesOf({ ...(version as object), imageZones: [{ id: "a", x: 0, y: 0, width: 500, height: 10 }, { id: "b", x: 1 }] } as never);
    expect(validateZoneGeometry(zones, { width: 210, height: 297 }).filter((i) => i.zoneId === "a" || i.zoneId === "b")).toHaveLength(2);
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("https://a.test/x.png")).not.toBeNull();
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });
});

describe("uploaded images in the layout", () => {
  const content = { zones: { head: "Hi" }, images: { hero: { fileId: "file-1", alt: "Hero", widthPx: 2480, heightPx: 1200 } } };
  it("addresses an uploaded file by a stable placeholder until real links are supplied", () => {
    const model = buildEditionRenderModel(data(content), edition);
    expect(model.pages[0]!.zones.find((z) => z.id === "hero")!.image).toMatchObject({ fileId: "file-1", widthPx: 2480 });
    const hashed = renderEditionHtml(model, "print");
    expect(hashed).toContain("https://files.invalid/file-1");
    const rendered = renderEditionHtml(model, "print", { imageUrls: { "file-1": "https://cdn.test/a?sig=1" } });
    expect(rendered).toContain("https://cdn.test/a?sig=1");
    expect(rendered).not.toContain("files.invalid");
    // A refreshed link must not change what the idempotency key is made from.
    expect(renderEditionHtml(model, "print")).toBe(hashed);
  });
  it("refuses an unsafe resolved address and derives resolution from the stored pixel size", () => {
    const model = buildEditionRenderModel(data(content), edition);
    expect(renderEditionHtml(model, "print", { imageUrls: { "file-1": "javascript:alert(1)" } })).not.toContain("javascript:");
    expect(derivePageArtifact(model.pages[0]!)).toMatchObject({ dpi: 300, dpiUnverifiedImages: 0 });
  });
});

describe("crop marks", () => {
  it("keeps every mark outside the bleed and inside the sheet", () => {
    const [trimW, trimH, bleed] = [210, 297, 3];
    const m = printMarginMm(bleed);
    expect(m).toBe(9);
    const marks = [...cropMarks(trimW, trimH, bleed).matchAll(/left:([\d.]+)mm;top:([\d.]+)mm;width:([\d.]+)mm;height:([\d.]+)mm/g)].map((x) => x.slice(1).map(Number) as [number, number, number, number]);
    expect(marks).toHaveLength(8);
    for (const [left, top, width, height] of marks) {
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(trimW + 2 * m);
      expect(top + height).toBeLessThanOrEqual(trimH + 2 * m);
      // The bleed box runs from m - bleed to m + trim + bleed; a mark must not overlap it.
      const insideX = left < m + trimW + bleed && left + width > m - bleed;
      const insideY = top < m + trimH + bleed && top + height > m - bleed;
      expect(insideX && insideY).toBe(false);
    }
  });
});

const request = { kind: "print", html: "<p>x</p>", sheetWidthMm: 228, sheetHeightMm: 315, bleedMm: 3, trimWidthMm: 210, trimHeightMm: 297, marginMm: 9, pageCount: 1, idempotencyKey: "k" } as const;
const pdf = new TextEncoder().encode("%PDF-1.4 body");
const report = { provider: "p", pressReady: true, pdfx: "PDF/X-1a:2003", colourSpace: "cmyk", outputIntent: "FOGRA39", fontsEmbedded: true, pageCount: 1, bleedMm: 3, boxes: true, warnings: [] as string[] } as const;

describe("render provider", () => {
  it("verifies results", () => {
    expect(verifyRenderResult(request, { pdf, sha256: sha256Hex(pdf), report })).toEqual([]);
    expect(verifyRenderResult(request, { pdf, sha256: "bad", report: { ...report, colourSpace: "rgb", pdfx: "none", fontsEmbedded: false, bleedMm: 1, pageCount: 2, boxes: false } })).toHaveLength(7);
  });
  it("requires and checks the imposed booklet when one was asked for", () => {
    const withImposition = { ...request, pageCount: 4, impose: { sheets: [{ sheet: 1, front: { left: 4, right: 1 }, back: { left: 2, right: 3 } }] } } as never;
    const main = { pdf, sha256: sha256Hex(pdf), report: { ...report, pageCount: 4 } };
    expect(verifyRenderResult(withImposition, main)).toEqual(["The imposed booklet is missing."]);
    expect(verifyRenderResult(withImposition, { ...main, imposed: { pdf, sha256: sha256Hex(pdf), report: { ...report, pageCount: 2 } } })).toEqual([]);
    expect(verifyRenderResult(withImposition, { ...main, imposed: { pdf, sha256: sha256Hex(pdf), report: { ...report, pageCount: 3, boxes: false } } })).toHaveLength(2);
  });
  it("calls the service and maps failures", async () => {
    const ok = createHttpRenderProvider({ baseUrl: "https://render.test", secret: "s", fetch: async () => new Response(JSON.stringify({ pdfBase64: Buffer.from(pdf).toString("base64"), report })) });
    expect((await ok.render(request)).report.pressReady).toBe(true);
    const bad = createHttpRenderProvider({ baseUrl: "https://render.test", secret: "s", fetch: async () => new Response("nope", { status: 503 }) });
    await expect(bad.render(request)).rejects.toMatchObject({ code: "unavailable", retryable: true });
    const rejected = createHttpRenderProvider({ baseUrl: "https://render.test", secret: "s", fetch: async () => new Response("bad html", { status: 422 }) });
    await expect(rejected.render(request)).rejects.toMatchObject({ code: "rejected", retryable: false });
    expect(() => createHttpRenderProvider({ baseUrl: "http://render.example", secret: "s" })).toThrow(RenderProviderError);
  });
});
