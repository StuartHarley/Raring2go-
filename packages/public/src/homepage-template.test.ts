import { describe, expect, it } from "vitest";
import { HomepageTemplateError, defaultHomepageSlots, homepageSlotKinds, usableHomepageSlots, validateHomepageSlots } from "./homepage-template";

const input = () => defaultHomepageSlots().map(({ kind, heading, visible, itemCount, source }) => ({ kind, heading, visible, itemCount, source }));
const code = (value: unknown) => {
  try {
    validateHomepageSlots(value);
    return "ok";
  } catch (error) {
    return error instanceof HomepageTemplateError ? error.code : "other";
  }
};

describe("homepage template rules", () => {
  it("accepts the default layout and returns it in canonical form", () => {
    const slots = validateHomepageSlots(input());
    expect(slots.map((s) => s.kind)).toEqual(homepageSlotKinds);
    expect(slots.find((s) => s.kind === "offers")).toMatchObject({ id: "slot_offers", commercialTreatment: "sponsored", visible: true });
    expect(slots.find((s) => s.kind === "hero")!.seasonalTreatment).toBe(true);
  });
  it("lets HQ reorder, hide, rename, recount and re-source sections", () => {
    const edited = input().reverse().map((slot) => (slot.kind === "stories" ? { ...slot, heading: "  Fresh   from the area  ", itemCount: 8, source: "local_only" } : slot.kind === "competitions" ? { ...slot, visible: false } : slot));
    const slots = validateHomepageSlots(edited);
    expect(slots[0]!.kind).toBe("newsletter");
    expect(slots.find((s) => s.kind === "stories")).toMatchObject({ heading: "Fresh from the area", itemCount: 8, source: "local_only" });
    expect(slots.find((s) => s.kind === "competitions")!.visible).toBe(false);
  });
  it("keeps the hero and newsletter on the page and visible", () => {
    expect(code(input().filter((s) => s.kind !== "newsletter"))).toBe("slot_required");
    expect(code(input().filter((s) => s.kind !== "hero"))).toBe("slot_required");
    const hidden = validateHomepageSlots(input().map((s) => (s.kind === "hero" || s.kind === "newsletter" ? { ...s, visible: false } : s)));
    expect(hidden.filter((s) => s.kind === "hero" || s.kind === "newsletter").every((s) => s.visible)).toBe(true);
  });
  it("never lets a commercial section lose its sponsored label, whatever is sent", () => {
    const slots = validateHomepageSlots(input().map((s) => ({ ...s, commercialTreatment: "standard", id: "x" })));
    for (const kind of ["offers", "competitions", "advertisers"]) expect(slots.find((s) => s.kind === kind)!.commercialTreatment).toBe("sponsored");
    expect(slots.find((s) => s.kind === "stories")!.commercialTreatment).toBeUndefined();
    expect(slots.every((s) => s.id === `slot_${s.kind}`)).toBe(true);
  });
  it("refuses bad layouts with a specific code", () => {
    expect(code("nope")).toBe("slots_invalid");
    expect(code([])).toBe("slots_invalid");
    expect(code([...input(), ...input()])).toBe("slots_invalid");
    expect(code([...input().slice(0, 8), { ...input()[0]! }])).toBe("slot_duplicate");
    expect(code(input().map((s, i) => (i === 1 ? { ...s, kind: "community" } : s)))).toBe("slot_unknown");
    expect(code(input().map((s, i) => (i === 1 ? { ...s, kind: "sidebar" } : s)))).toBe("slot_unknown");
    expect(code(input().map((s, i) => (i === 1 ? { ...s, heading: "  " } : s)))).toBe("slot_heading");
    expect(code(input().map((s, i) => (i === 1 ? { ...s, heading: "x".repeat(81) } : s)))).toBe("slot_heading");
    expect(code(input().map((s) => (s.kind === "stories" ? { ...s, itemCount: 13 } : s)))).toBe("slot_count");
    expect(code(input().map((s) => (s.kind === "hero" ? { ...s, itemCount: 2 } : s)))).toBe("slot_count");
    expect(code(input().map((s) => (s.kind === "stories" ? { ...s, itemCount: 2.5 } : s)))).toBe("slot_count");
    expect(code(input().map((s) => (s.kind === "stories" ? { ...s, source: "anywhere" } : s)))).toBe("slot_source");
  });
  it("falls back to the default when a stored layout is unusable", () => {
    expect(usableHomepageSlots(input())).toMatchObject({ fromStored: true });
    expect(usableHomepageSlots([{ kind: "stories" }])).toMatchObject({ fromStored: false });
    expect(usableHomepageSlots(null).slots.map((s) => s.kind)).toEqual(homepageSlotKinds);
  });
});
