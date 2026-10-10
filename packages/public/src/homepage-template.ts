import type { PublicHomepageSlot } from "./index";

/**
 * The homepage layout HQ controls, and the rules that keep it safe. A template is an ordered list of sections
 * ("slots"). HQ chooses which sections show, their order, heading, item count and where items come from. HQ cannot
 * remove the hero or the newsletter sign-up, cannot repeat a section, and cannot take the "Sponsored" label off a
 * commercial section: those rules live here so every path (the editor, a seed, an import) obeys them.
 */

type Kind = Exclude<PublicHomepageSlot["kind"], "community">;

export const HOMEPAGE_TEMPLATE_KEY = "r2go-territory-homepage";

/** Sections the site can actually render. `community` is in the type but has no page section yet, so it cannot be chosen. */
export const homepageSlotKinds: Kind[] = ["hero", "stories", "whats_on", "things_to_do", "magazine", "offers", "competitions", "advertisers", "newsletter"];

export const homepageKindLabels: Record<Kind, string> = {
  hero: "Hero (top banner)",
  stories: "Latest local stories",
  whats_on: "What's on",
  things_to_do: "Things to do",
  magazine: "Digital magazine",
  offers: "Offers",
  competitions: "Competitions",
  advertisers: "Recommended local businesses",
  newsletter: "Newsletter sign-up"
};

/** Allowed item counts per section. A section that shows one thing has a fixed count of 1. */
export const homepageItemBounds: Record<Kind, { min: number; max: number }> = {
  hero: { min: 1, max: 1 },
  stories: { min: 1, max: 12 },
  whats_on: { min: 1, max: 12 },
  things_to_do: { min: 1, max: 12 },
  magazine: { min: 1, max: 1 },
  offers: { min: 1, max: 8 },
  competitions: { min: 1, max: 8 },
  advertisers: { min: 1, max: 8 },
  newsletter: { min: 1, max: 1 }
};

const REQUIRED: Kind[] = ["hero", "newsletter"];
const SPONSORED: Kind[] = ["offers", "competitions", "advertisers"];
const SEASONAL: Kind[] = ["hero", "magazine", "newsletter"];
const SOURCES: PublicHomepageSlot["source"][] = ["local_then_network", "local_only", "network"];

export type HomepageTemplateErrorCode =
  | "slots_invalid"
  | "slot_unknown"
  | "slot_duplicate"
  | "slot_required"
  | "slot_heading"
  | "slot_count"
  | "slot_source";

export const homepageErrorText: Record<HomepageTemplateErrorCode | "not_allowed" | "draft_exists" | "not_draft" | "not_found", string> = {
  slots_invalid: "The layout could not be read.",
  slot_unknown: "A section is not one the site can show.",
  slot_duplicate: "A section appears twice.",
  slot_required: "The top banner and the newsletter sign-up must stay on the page.",
  slot_heading: "Every section needs a heading of up to 80 characters.",
  slot_count: "An item count is outside what that section allows.",
  slot_source: "A section has an unknown content source.",
  not_allowed: "You do not have permission to change the homepage.",
  draft_exists: "There is already a draft; edit it or discard it first.",
  not_draft: "Only a draft can be changed or published.",
  not_found: "That version was not found."
};

export class HomepageTemplateError extends Error {
  constructor(message: string, readonly code: HomepageTemplateErrorCode) {
    super(message);
    this.name = "HomepageTemplateError";
  }
}

export type HomepageSlotInput = { kind: string; heading: string; visible: boolean; itemCount: number; source: string };

export function defaultHomepageSlots(): PublicHomepageSlot[] {
  const make = (kind: Kind, heading: string, itemCount: number, visible = true): PublicHomepageSlot => ({
    id: `slot_${kind}`,
    kind,
    heading,
    visible,
    itemCount,
    source: kind === "newsletter" ? "local_only" : "local_then_network",
    seasonalTreatment: SEASONAL.includes(kind),
    commercialTreatment: SPONSORED.includes(kind) ? "sponsored" : undefined
  });
  return [
    make("hero", "Your local family guide", 1),
    make("stories", "Latest local stories", 4),
    make("whats_on", "What's on near you", 6),
    make("things_to_do", "Things to do", 6),
    make("magazine", "Latest digital magazine", 1),
    make("offers", "Offers families will love", 4),
    make("competitions", "Competitions", 4),
    make("advertisers", "Recommended local businesses", 4),
    make("newsletter", "Get the local family edit", 1)
  ];
}

/** Checks a layout and returns it in its canonical form. Order is the order given; the ids, seasonal treatment and sponsored label are not HQ's to set. */
export function validateHomepageSlots(input: unknown): PublicHomepageSlot[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > homepageSlotKinds.length) {
    throw new HomepageTemplateError("Bad layout.", "slots_invalid");
  }
  const seen = new Set<string>();
  const slots: PublicHomepageSlot[] = [];
  for (const raw of input as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== "object") throw new HomepageTemplateError("Bad section.", "slots_invalid");
    const kind = raw.kind as Kind;
    if (!homepageSlotKinds.includes(kind)) throw new HomepageTemplateError("Unknown section.", "slot_unknown");
    if (seen.has(kind)) throw new HomepageTemplateError("Duplicate section.", "slot_duplicate");
    seen.add(kind);
    const heading = typeof raw.heading === "string" ? raw.heading.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
    if (!heading || heading.length > 80) throw new HomepageTemplateError("Bad heading.", "slot_heading");
    const bounds = homepageItemBounds[kind];
    const itemCount = Number(raw.itemCount);
    if (!Number.isInteger(itemCount) || itemCount < bounds.min || itemCount > bounds.max) throw new HomepageTemplateError("Bad item count.", "slot_count");
    const source = raw.source as PublicHomepageSlot["source"];
    if (!SOURCES.includes(source)) throw new HomepageTemplateError("Bad source.", "slot_source");
    slots.push({
      id: `slot_${kind}`,
      kind,
      heading,
      visible: REQUIRED.includes(kind) ? true : raw.visible !== false,
      itemCount,
      source,
      seasonalTreatment: SEASONAL.includes(kind),
      commercialTreatment: SPONSORED.includes(kind) ? "sponsored" : undefined
    });
  }
  for (const kind of REQUIRED) {
    if (!seen.has(kind)) throw new HomepageTemplateError("Required section missing.", "slot_required");
  }
  return slots;
}

/** What the live site should use: the stored layout if it is valid, otherwise the built-in default, so a bad record can never blank the homepage. */
export function usableHomepageSlots(stored: unknown): { slots: PublicHomepageSlot[]; fromStored: boolean } {
  try {
    return { slots: validateHomepageSlots(stored), fromStored: true };
  } catch {
    return { slots: defaultHomepageSlots(), fromStored: false };
  }
}
