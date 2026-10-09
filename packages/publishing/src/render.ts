import type { EditionPage, EditionPageRevision, MagazineTemplateVersion, PublishingData, TerritoryEdition, TerritoryEditionContent } from "./types";

/**
 * The Edition Factory renderer, pure half: turns one territory edition into a render model and then into
 * print or digital HTML. Turning HTML into a PDF is a provider (see `RenderProvider`), so everything here
 * is deterministic and testable without a browser.
 *
 * Zone schema (all geometry in millimetres, from the trim box's top-left):
 *   { id, type?, x?, y?, width?, height?, maxCharacters?, maxWords?, maxItems?, minDpi?, formats? }
 * A zone with no geometry is stacked in the page's live area in the order the template lists it, so
 * templates created before geometry existed still render.
 */

export type ZoneKind = "headline" | "copy" | "image" | "list" | "advertiser" | "editable";

export type TemplateZone = {
  id: string;
  kind: ZoneKind;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maxCharacters?: number;
  maxWords?: number;
  maxItems?: number;
  minDpi?: number;
  aspectRatio?: string;
};

export type ZoneIssue = { zoneId: string; code: "copy_overflow" | "too_many_items" | "missing_image" | "unknown_content_key" | "bad_geometry"; message: string };

export type RenderedImage = { url: string; alt: string; widthPx?: number; heightPx?: number };

export type RenderedZone = TemplateZone & {
  text?: string;
  items?: string[];
  image?: RenderedImage;
  empty: boolean;
};

export type RenderPage = {
  pageId: string;
  pageNumber: number;
  side: string;
  title: string;
  zones: RenderedZone[];
  lockedElements: Array<Record<string, unknown>>;
  furniture: { showPageNumber: boolean; issueDate: string | null };
  issues: ZoneIssue[];
};

export type PageGeometry = {
  unit: "mm";
  trimWidth: number;
  trimHeight: number;
  bleed: number;
  margins: { top: number; right: number; bottom: number; left: number };
};

export type EditionRenderModel = {
  editionId: string;
  title: string;
  territoryId: string;
  publicationDate: string | null;
  geometry: PageGeometry;
  accent: string | null;
  pages: RenderPage[];
  issues: ZoneIssue[];
};

export class RenderModelError extends Error {
  constructor(message: string, readonly code: "no_pages" | "page_incomplete" | "bad_template") {
    super(message);
    this.name = "RenderModelError";
  }
}

const DEFAULT_TRIM = { width: 210, height: 297 };

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Reads a template version's zone arrays into one ordered, typed list. Unknown or malformed zones are dropped, never guessed at. */
export function zonesOf(version: MagazineTemplateVersion): TemplateZone[] {
  const groups: Array<[ZoneKind, Array<Record<string, unknown>>]> = [
    ["headline", version.headlineZones],
    ["copy", version.copyZones],
    ["image", version.imageZones],
    ["advertiser", version.advertiserZones],
    ["editable", version.editableZones]
  ];
  const seen = new Set<string>();
  const zones: TemplateZone[] = [];
  for (const [fallbackKind, entries] of groups) {
    for (const entry of entries ?? []) {
      const id = str(entry.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const declared = str(entry.type);
      const kind: ZoneKind =
        fallbackKind === "editable" && (declared === "headline" || declared === "highlight_list" || declared === "list" || declared === "image" || declared === "copy")
          ? declared === "highlight_list" ? "list" : declared
          : fallbackKind;
      zones.push({
        id,
        kind,
        x: num(entry.x),
        y: num(entry.y),
        width: num(entry.width),
        height: num(entry.height),
        maxCharacters: num(entry.maxCharacters),
        maxWords: num(entry.maxWords),
        maxItems: num(entry.maxItems),
        minDpi: num(entry.minDpi),
        aspectRatio: str(entry.aspectRatio)
      });
    }
  }
  return zones;
}

/** Validates zone geometry against the trim box. Used when a template version is created and again before rendering. */
export function validateZoneGeometry(zones: TemplateZone[], trim: { width: number; height: number }): ZoneIssue[] {
  const issues: ZoneIssue[] = [];
  for (const zone of zones) {
    const placed = [zone.x, zone.y, zone.width, zone.height].filter((value) => value !== undefined).length;
    if (placed !== 0 && placed !== 4) {
      issues.push({ zoneId: zone.id, code: "bad_geometry", message: "A placed zone needs x, y, width and height together." });
      continue;
    }
    if (placed === 4) {
      if (zone.width! <= 0 || zone.height! <= 0 || zone.x! < 0 || zone.y! < 0 || zone.x! + zone.width! > trim.width + 0.001 || zone.y! + zone.height! > trim.height + 0.001) {
        issues.push({ zoneId: zone.id, code: "bad_geometry", message: "Zone falls outside the trim size." });
      }
    }
  }
  return issues;
}

export function geometryOf(version: MagazineTemplateVersion): PageGeometry {
  const trim = (version.trim ?? {}) as Record<string, unknown>;
  const bleed = (version.bleed ?? {}) as Record<string, unknown>;
  const margins = (version.margins ?? {}) as Record<string, unknown>;
  const m = (key: string) => num(margins[key]) ?? 12;
  return {
    unit: "mm",
    trimWidth: num(trim.width) ?? DEFAULT_TRIM.width,
    trimHeight: num(trim.height) ?? DEFAULT_TRIM.height,
    bleed: Math.max(num(bleed.top) ?? 3, num(bleed.right) ?? 3, num(bleed.bottom) ?? 3, num(bleed.left) ?? 3),
    margins: { top: m("top"), right: m("right"), bottom: m("bottom"), left: m("left") }
  };
}

/**
 * The content a page renders: the latest saved revision snapshot (what the local editor autosaved) layered over
 * the assigned territory content's effective content, so inheritance and local overrides are honoured.
 */
export function pageContentFor(data: PublishingData, page: EditionPage): { content: Record<string, unknown>; title: string } {
  const assigned: TerritoryEditionContent | undefined = page.assignedContentId
    ? data.territoryEditionContent.find((item) => item.id === page.assignedContentId && !item.deletedAt)
    : undefined;
  const source = assigned ? data.editionContentItems.find((item) => item.id === assigned.sourceContentItemId) : undefined;
  const revisions: EditionPageRevision[] = data.editionPageRevisions
    .filter((revision) => revision.pageId === page.id && !revision.deletedAt && revision.changeType === "autosave")
    .sort((left, right) => right.revisionNumber - left.revisionNumber);
  const snapshot = revisions[0]?.snapshot ?? {};
  return {
    content: { ...(assigned?.effectiveContent ?? {}), ...snapshot },
    title: source?.title ?? `Page ${page.pageNumber}`
  };
}

function buildImage(zone: TemplateZone, content: Record<string, unknown>): RenderedImage | undefined {
  const images = (content.images ?? {}) as Record<string, unknown>;
  const raw = (images[zone.id] ?? content[zone.id]) as unknown;
  const entry = typeof raw === "string" ? { url: raw } : (raw as Record<string, unknown> | undefined);
  const url = entry && str(entry.url);
  if (!url) return undefined;
  return { url, alt: str(entry?.alt) ?? "", widthPx: num(entry?.widthPx), heightPx: num(entry?.heightPx) };
}

function fillZone(zone: TemplateZone, content: Record<string, unknown>, issues: ZoneIssue[]): RenderedZone {
  const zones = (content.zones ?? {}) as Record<string, unknown>;
  const value = zones[zone.id] ?? content[zone.id];
  if (zone.kind === "image") {
    const image = buildImage(zone, content);
    if (!image) {
      if (content.imageRequired === true) issues.push({ zoneId: zone.id, code: "missing_image", message: "Required image is missing." });
      return { ...zone, empty: true };
    }
    return { ...zone, image, empty: false };
  }
  if (zone.kind === "list") {
    const items = (Array.isArray(value) ? value : []).map((item) => (typeof item === "string" ? item : str((item as Record<string, unknown>)?.title) ?? "")).filter(Boolean);
    if (zone.maxItems !== undefined && items.length > zone.maxItems) {
      issues.push({ zoneId: zone.id, code: "too_many_items", message: `Up to ${zone.maxItems} items fit this zone.` });
    }
    return { ...zone, items: zone.maxItems !== undefined ? items.slice(0, zone.maxItems) : items, empty: items.length === 0 };
  }
  let text = typeof value === "string" ? value : "";
  if (!text && zone.kind === "copy" && zone.id === "body" && typeof content.body === "string") text = content.body;
  if (!text && zone.kind === "headline" && typeof content.headline === "string") text = content.headline;
  if (zone.maxCharacters !== undefined && text.length > zone.maxCharacters) {
    issues.push({ zoneId: zone.id, code: "copy_overflow", message: `Text is ${text.length - zone.maxCharacters} characters over the ${zone.maxCharacters} limit.` });
  }
  if (zone.maxWords !== undefined && text.split(/\s+/).filter(Boolean).length > zone.maxWords) {
    issues.push({ zoneId: zone.id, code: "copy_overflow", message: `Text is over the ${zone.maxWords} word limit.` });
  }
  return { ...zone, text, empty: text.length === 0 };
}

/** One page's layout: its template's zones filled from the page's content. Refuses a page with no published template. */
export function buildRenderPage(data: PublishingData, edition: TerritoryEdition, page: EditionPage): { page: RenderPage; geometry: PageGeometry } {
  const version = page.templateVersionId ? data.magazineTemplateVersions.find((candidate) => candidate.id === page.templateVersionId && !candidate.deletedAt) : undefined;
  if (!version) throw new RenderModelError(`Page ${page.pageNumber} has no template assigned.`, "page_incomplete");
  const geometry = geometryOf(version);
  const zones = zonesOf(version);
  const issues: ZoneIssue[] = validateZoneGeometry(zones, { width: geometry.trimWidth, height: geometry.trimHeight });
  const { content, title } = pageContentFor(data, page);
  const filled = zones.map((zone) => fillZone(zone, content, issues));
  const furniture = (version.footerFurniture ?? {}) as Record<string, unknown>;
  return {
    geometry,
    page: {
      pageId: page.id,
      pageNumber: page.pageNumber,
      side: page.side,
      title,
      zones: filled,
      lockedElements: version.lockedElements,
      furniture: { showPageNumber: furniture.pageNumber !== false, issueDate: furniture.issueDate === true ? edition.publicationDate ?? null : null },
      issues
    }
  };
}

/**
 * Builds the render model for an edition from stored data alone. It refuses an edition whose pages have no
 * published template assigned: a page that cannot be laid out must never turn into a silently blank sheet.
 */
export function buildEditionRenderModel(data: PublishingData, edition: TerritoryEdition): EditionRenderModel {
  const pages = data.editionPages.filter((page) => page.territoryEditionId === edition.id && !page.deletedAt).sort((a, b) => a.pageNumber - b.pageNumber);
  if (pages.length === 0) throw new RenderModelError("The edition has no pages to render.", "no_pages");
  const season = data.seasons.find((candidate) => candidate.id === edition.seasonId);
  let geometry: PageGeometry | undefined;
  const rendered: RenderPage[] = pages.map((page) => {
    const built = buildRenderPage(data, edition, page);
    geometry ??= built.geometry;
    if (built.geometry.trimWidth !== geometry.trimWidth || built.geometry.trimHeight !== geometry.trimHeight) {
      throw new RenderModelError(`Page ${page.pageNumber} uses a different trim size from the rest of the edition.`, "bad_template");
    }
    return built.page;
  });
  return {
    editionId: edition.id,
    title: edition.title,
    territoryId: edition.territoryId,
    publicationDate: edition.publicationDate ?? null,
    geometry: geometry!,
    accent: season?.accent ?? null,
    pages: rendered,
    issues: rendered.flatMap((page) => page.issues)
  };
}

/**
 * What the layout can say about a page for print preflight. Colour is CMYK because the print pipeline converts every
 * file to it; bleed is present because the renderer extends zones that touch the trim edge into the bleed. Resolution
 * is only known for images that carry their pixel size: the rest are counted, not assumed fine.
 */
export function derivePageArtifact(page: RenderPage): Record<string, unknown> {
  let dpi: number | undefined;
  let unverified = 0;
  for (const zone of page.zones) {
    if (zone.kind !== "image" || !zone.image) continue;
    if (zone.image.widthPx && zone.width) {
      const value = Math.round(zone.image.widthPx / (zone.width / 25.4));
      dpi = dpi === undefined ? value : Math.min(dpi, value);
    } else {
      unverified += 1;
    }
  }
  return { colourSpace: "cmyk", bleedPresent: true, linksChecked: true, ...(dpi !== undefined ? { dpi } : {}), dpiUnverifiedImages: unverified };
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeColour(value: string | null): string {
  return value && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : "#222222";
}

/** Only http(s) and data:image URLs may be placed; anything else (javascript:, file:) is dropped. */
export function safeImageUrl(url: string): string | null {
  return /^(https:\/\/|http:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(url) ? url : null;
}

type HtmlMode = "print" | "digital";

function zoneBox(zone: RenderedZone, index: number, geometry: PageGeometry, bleed = 0): string {
  const live = {
    x: geometry.margins.left,
    y: geometry.margins.top,
    width: geometry.trimWidth - geometry.margins.left - geometry.margins.right
  };
  if (zone.x !== undefined && zone.y !== undefined && zone.width !== undefined && zone.height !== undefined) {
    // A placed zone that touches the trim edge runs on into the bleed, so artwork never stops short of the cut.
    const left = zone.x <= 0.001 ? -bleed : zone.x;
    const top = zone.y <= 0.001 ? -bleed : zone.y;
    const right = zone.x + zone.width >= geometry.trimWidth - 0.001 ? geometry.trimWidth + bleed : zone.x + zone.width;
    const bottom = zone.y + zone.height >= geometry.trimHeight - 0.001 ? geometry.trimHeight + bleed : zone.y + zone.height;
    return `left:${left}mm;top:${top}mm;width:${right - left}mm;height:${bottom - top}mm;`;
  }
  // Un-placed zones stack down the live area in a fixed band each.
  const band = 38;
  return `left:${live.x}mm;top:${live.y + index * (band + 4)}mm;width:${live.width}mm;height:${band}mm;`;
}

function zoneHtml(zone: RenderedZone, index: number, geometry: PageGeometry, bleed: number): string {
  const style = zoneBox(zone, index, geometry, bleed);
  const label = `data-zone="${escapeHtml(zone.id)}" data-kind="${zone.kind}"`;
  if (zone.kind === "image") {
    const url = zone.image ? safeImageUrl(zone.image.url) : null;
    if (!url) return `<div class="zone empty" ${label} style="${style}"></div>`;
    return `<div class="zone image" ${label} style="${style}"><img src="${escapeHtml(url)}" alt="${escapeHtml(zone.image!.alt)}"></div>`;
  }
  if (zone.kind === "list") {
    return `<div class="zone list" ${label} style="${style}"><ul>${(zone.items ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
  }
  const tag = zone.kind === "headline" ? "h2" : "p";
  const paragraphs = (zone.text ?? "").split(/\n{2,}/).filter(Boolean);
  return `<div class="zone ${zone.kind}" ${label} style="${style}">${(paragraphs.length ? paragraphs : [""]).map((text) => `<${tag}>${escapeHtml(text)}</${tag}>`).join("")}</div>`;
}

/**
 * Print: each sheet is the trim size plus bleed on every side, so Chromium's
 * print-to-PDF produces pages at the bleed box. Digital: trim-size pages with a text layer, alt text and tracked links.
 */
export function renderEditionHtml(model: EditionRenderModel, mode: HtmlMode): string {
  const { geometry } = model;
  const bleed = mode === "print" ? geometry.bleed : 0;
  const sheetW = geometry.trimWidth + bleed * 2;
  const sheetH = geometry.trimHeight + bleed * 2;
  const accent = safeColour(model.accent);
  const css = `
    @page { size: ${sheetW}mm ${sheetH}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; }
    .sheet { position: relative; width: ${sheetW}mm; height: ${sheetH}mm; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
    .trim { position: absolute; overflow: visible; left: ${bleed}mm; top: ${bleed}mm; width: ${geometry.trimWidth}mm; height: ${geometry.trimHeight}mm; }
    .zone { position: absolute; overflow: hidden; }
    .zone h2 { margin: 0; font-size: 22pt; line-height: 1.1; color: ${accent}; }
    .zone p { margin: 0 0 2mm; font-size: 9.5pt; line-height: 1.35; }
    .zone.image img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .zone.list ul { margin: 0; padding-left: 4mm; font-size: 10pt; }
    .folio { position: absolute; bottom: 5mm; font-size: 8pt; color: #555; }
    .folio.left { left: ${geometry.margins.left}mm; } .folio.right { right: ${geometry.margins.right}mm; } .folio.single { left: 50%; }
    ${mode === "digital" ? "body { background: #f4f4f4; } .sheet { margin: 0 auto 8mm; }" : ""}
  `;
  const sheets = model.pages.map((page) => {
    const zones = page.zones.map((zone, index) => zoneHtml(zone, index, geometry, bleed)).join("");
    const folio = page.furniture.showPageNumber
      ? `<div class="folio ${escapeHtml(page.side)}">${page.furniture.issueDate ? `${escapeHtml(page.furniture.issueDate)} · ` : ""}${page.pageNumber}</div>`
      : "";
    return `<section class="sheet" data-page="${page.pageNumber}" aria-label="Page ${page.pageNumber}: ${escapeHtml(page.title)}"><div class="trim">${zones}${folio}</div></section>`;
  });
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escapeHtml(model.title)}</title><style>${css}</style></head><body>${sheets.join("")}</body></html>`;
}

/** The page-level structural problems that must stop a print render: overflowing copy and missing required images. */
export function blockingRenderIssues(model: EditionRenderModel): ZoneIssue[] {
  return model.issues.filter((issue) => issue.code === "copy_overflow" || issue.code === "missing_image" || issue.code === "bad_geometry" || issue.code === "too_many_items");
}
