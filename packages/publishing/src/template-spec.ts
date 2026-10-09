import type { MagazineTemplateVersion } from "./types";
import { validateZoneGeometry, zonesOf } from "./render";
import type { TemplateZone, ZoneKind } from "./render";

/**
 * Turns what the template form submits into a template version's fields, with every number checked. The form is
 * a trust boundary, so nothing here is accepted as-is: unknown kinds, duplicate ids, sizes outside the sheet and
 * non-numbers are refused with a message the author can act on.
 */

export const pageSizePresets = {
  a4: { label: "A4 portrait", width: 210, height: 297 },
  a5: { label: "A5 portrait", width: 148, height: 210 },
  "a4-landscape": { label: "A4 landscape", width: 297, height: 210 }
} as const;

export type PageSizeKey = keyof typeof pageSizePresets | "custom";

export type ZoneRowInput = {
  id: string;
  kind: string;
  x?: string;
  y?: string;
  width?: string;
  height?: string;
  maxCharacters?: string;
  maxWords?: string;
  maxItems?: string;
  minDpi?: string;
};

export type TemplateSpecInput = {
  size: PageSizeKey;
  customWidth?: string;
  customHeight?: string;
  bleed?: string;
  margins?: { top?: string; right?: string; bottom?: string; left?: string };
  lockedElements: string[];
  zones: ZoneRowInput[];
  showPageNumber: boolean;
  showIssueDate: boolean;
};

/** Fixed codes so a page can explain a refusal without reflecting anything the author typed. */
export type TemplateSpecErrorCode = "template_key" | "template_name" | "page_size" | "number" | "locked_missing" | "zones_missing" | "zone_id" | "zone_duplicate" | "zone_kind" | "zone_geometry";

export const templateSpecErrorText: Record<TemplateSpecErrorCode | "template_exists" | "invalid", string> = {
  template_key: "The key must be lower-case letters, digits and hyphens, starting with a letter.",
  template_name: "Give the template a name.",
  template_exists: "A template with that key already exists.",
  page_size: "Choose a page size, or give a custom width and height.",
  number: "A size, margin, limit or position is not a valid number in range.",
  locked_missing: "Add at least one locked element (for example the masthead).",
  zones_missing: "Add at least one editable zone.",
  zone_id: "Each zone needs an id of lower-case letters, digits and hyphens, starting with a letter.",
  zone_duplicate: "Two zones share an id.",
  zone_kind: "Choose a type for every zone you have started.",
  zone_geometry: "A zone is outside the page, or has only some of x, y, width and height.",
  invalid: "The template could not be saved. Check the page and zone details."
};

export class TemplateSpecError extends Error {
  constructor(message: string, readonly code: TemplateSpecErrorCode = "number") {
    super(message);
    this.name = "TemplateSpecError";
  }
}

const KINDS: ZoneKind[] = ["headline", "copy", "image", "list", "advertiser"];
const ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

function number(value: string | undefined, label: string, options: { min: number; max: number; integer?: boolean; required?: boolean }): number | undefined {
  const text = (value ?? "").trim();
  if (text === "") {
    if (options.required) throw new TemplateSpecError(`${label} is required.`, "page_size");
    return undefined;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < options.min || parsed > options.max || (options.integer && !Number.isInteger(parsed))) {
    throw new TemplateSpecError(`${label} must be ${options.integer ? "a whole number" : "a number"} from ${options.min} to ${options.max}.`);
  }
  return parsed;
}

type SpecFields = Pick<
  MagazineTemplateVersion,
  | "pageDimensions" | "bleed" | "trim" | "margins" | "grid" | "lockedElements" | "editableZones" | "imageZones" | "copyZones"
  | "headlineZones" | "advertiserZones" | "footerFurniture" | "printRules" | "digitalEnhancements"
>;

export function buildTemplateSpec(input: TemplateSpecInput): SpecFields {
  const preset = input.size === "custom" ? null : pageSizePresets[input.size];
  if (input.size !== "custom" && !preset) throw new TemplateSpecError("Choose a page size.", "page_size");
  const width = preset?.width ?? number(input.customWidth, "Page width", { min: 50, max: 600, required: true })!;
  const height = preset?.height ?? number(input.customHeight, "Page height", { min: 50, max: 800, required: true })!;
  const bleed = number(input.bleed, "Bleed", { min: 0, max: 10 }) ?? 3;
  const margin = (key: "top" | "right" | "bottom" | "left") => number(input.margins?.[key], `${key[0]!.toUpperCase()}${key.slice(1)} margin`, { min: 0, max: Math.min(width, height) / 3 }) ?? 12;
  const margins = { top: margin("top"), right: margin("right"), bottom: margin("bottom"), left: margin("left"), unit: "mm" };

  const locked = input.lockedElements.map((entry) => entry.trim()).filter(Boolean);
  if (locked.length === 0) throw new TemplateSpecError("Add at least one locked element (for example the masthead) so brand furniture cannot be edited locally.", "locked_missing");
  const seen = new Set<string>();
  const zones: TemplateZone[] = [];
  for (const [index, row] of input.zones.entries()) {
    const touched = Object.values(row).some((value) => typeof value === "string" && value.trim() !== "");
    if (!touched) continue;
    const label = `Zone ${index + 1}`;
    const id = row.id.trim();
    if (!ID_PATTERN.test(id)) throw new TemplateSpecError(`${label}: the id must be lower-case letters, digits and hyphens, starting with a letter.`, "zone_id");
    if (seen.has(id)) throw new TemplateSpecError(`${label}: the id "${id}" is used twice.`, "zone_duplicate");
    seen.add(id);
    if (!KINDS.includes(row.kind as ZoneKind)) throw new TemplateSpecError(`${label}: choose a zone type.`, "zone_kind");
    zones.push({
      id,
      kind: row.kind as ZoneKind,
      x: number(row.x, `${label} x`, { min: 0, max: width }),
      y: number(row.y, `${label} y`, { min: 0, max: height }),
      width: number(row.width, `${label} width`, { min: 1, max: width }),
      height: number(row.height, `${label} height`, { min: 1, max: height }),
      maxCharacters: number(row.maxCharacters, `${label} character limit`, { min: 1, max: 20000, integer: true }),
      maxWords: number(row.maxWords, `${label} word limit`, { min: 1, max: 5000, integer: true }),
      maxItems: number(row.maxItems, `${label} item limit`, { min: 1, max: 50, integer: true }),
      minDpi: number(row.minDpi, `${label} minimum dpi`, { min: 72, max: 1200, integer: true })
    });
  }
  if (zones.length === 0) throw new TemplateSpecError("Add at least one editable zone.", "zones_missing");
  const problems = validateZoneGeometry(zones, { width, height });
  if (problems[0]) throw new TemplateSpecError(`Zone "${problems[0].zoneId}": ${problems[0].message}`, "zone_geometry");

  const strip = (zone: TemplateZone) => Object.fromEntries(Object.entries({ ...zone, kind: undefined }).filter(([, value]) => value !== undefined));
  const of = (kind: ZoneKind) => zones.filter((zone) => zone.kind === kind).map(strip);
  // Everything except advertiser slots is something the local editor may fill; the typed arrays above carry the same ids.
  const editable = zones
    .filter((zone) => zone.kind !== "advertiser")
    .map((zone) => (zone.kind === "list" ? { ...strip(zone), type: "highlight_list", locked: false } : { id: zone.id, type: zone.kind, locked: false }));
  return {
    pageDimensions: { width, height, unit: "mm" },
    bleed: { top: bleed, right: bleed, bottom: bleed, left: bleed, unit: "mm" },
    trim: { width, height, unit: "mm" },
    margins,
    grid: {},
    lockedElements: locked.map((id) => ({ id: id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), label: id, type: "locked" })),
    editableZones: editable,
    imageZones: of("image"),
    copyZones: of("copy"),
    headlineZones: of("headline"),
    advertiserZones: of("advertiser"),
    footerFurniture: { pageNumber: input.showPageNumber, issueDate: input.showIssueDate },
    printRules: { colourSpace: "cmyk", minDpi: 300, bleedRequired: true },
    digitalEnhancements: { links: true, altTextRequired: true }
  };
}

/** The reverse, for editing a revision: a version's fields back into form rows. */
export function specToForm(version: MagazineTemplateVersion): TemplateSpecInput {
  const trim = version.trim as { width?: number; height?: number };
  const preset = (Object.entries(pageSizePresets) as Array<[keyof typeof pageSizePresets, (typeof pageSizePresets)[keyof typeof pageSizePresets]]>).find(([, size]) => size.width === trim.width && size.height === trim.height);
  const m = version.margins as Record<string, number>;
  const bleed = version.bleed as Record<string, number>;
  const text = (value: number | undefined) => (value === undefined ? "" : String(value));
  const furniture = version.footerFurniture as { pageNumber?: boolean; issueDate?: boolean };
  return {
    size: preset ? preset[0] : "custom",
    customWidth: text(trim.width),
    customHeight: text(trim.height),
    bleed: text(bleed.top),
    margins: { top: text(m.top), right: text(m.right), bottom: text(m.bottom), left: text(m.left) },
    lockedElements: version.lockedElements.map((element) => String(element.label ?? element.id ?? "")),
    zones: zonesOf(version).map((zone) => ({
      id: zone.id, kind: zone.kind === "editable" ? "copy" : zone.kind,
      x: text(zone.x), y: text(zone.y), width: text(zone.width), height: text(zone.height),
      maxCharacters: text(zone.maxCharacters), maxWords: text(zone.maxWords), maxItems: text(zone.maxItems), minDpi: text(zone.minDpi)
    })),
    showPageNumber: furniture.pageNumber !== false,
    showIssueDate: furniture.issueDate === true
  };
}
