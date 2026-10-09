import { describe, expect, it } from "vitest";
import { blockingRenderIssues, buildEditionRenderModel, escapeHtml, renderEditionHtml, safeImageUrl, validateZoneGeometry, zonesOf } from "./render";
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
    expect(html).toContain("size: 216mm 303mm");
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

const request = { kind: "print", html: "<p>x</p>", sheetWidthMm: 216, sheetHeightMm: 303, bleedMm: 3, pageCount: 1, idempotencyKey: "k" } as const;
const pdf = new TextEncoder().encode("%PDF-1.4 body");
const report = { provider: "p", pressReady: true, pdfx: "PDF/X-1a:2003", colourSpace: "cmyk", outputIntent: "FOGRA39", fontsEmbedded: true, pageCount: 1, bleedMm: 3, warnings: [] as string[] } as const;

describe("render provider", () => {
  it("verifies results", () => {
    expect(verifyRenderResult(request, { pdf, sha256: sha256Hex(pdf), report })).toEqual([]);
    expect(verifyRenderResult(request, { pdf, sha256: "bad", report: { ...report, colourSpace: "rgb", pdfx: "none", fontsEmbedded: false, bleedMm: 1, pageCount: 2 } })).toHaveLength(6);
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
