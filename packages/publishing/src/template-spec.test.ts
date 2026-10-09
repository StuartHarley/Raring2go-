import { describe, expect, it } from "vitest";
import { buildTemplateSpec, specToForm, TemplateSpecError } from "./template-spec";
import { zonesOf } from "./render";
import type { MagazineTemplateVersion } from "./types";

const base = { size: "a4" as const, lockedElements: ["Masthead"], showPageNumber: true, showIssueDate: false, zones: [
  { id: "headline", kind: "headline", x: "12", y: "12", width: "186", height: "30", maxCharacters: "60" },
  { id: "hero", kind: "image", x: "0", y: "50", width: "210", height: "100", minDpi: "300" },
  { id: "picks", kind: "list", maxItems: "4" },
  { id: "", kind: "", x: "", y: "" }
] };

describe("template spec", () => {
  it("builds a version's fields and round-trips through the form", () => {
    const spec = buildTemplateSpec(base);
    expect(spec.trim).toMatchObject({ width: 210, height: 297 });
    expect(spec.lockedElements[0]).toMatchObject({ id: "masthead" });
    const version = { ...spec, id: "v", templateId: "t", version: 1, status: "draft" } as unknown as MagazineTemplateVersion;
    expect(zonesOf(version).map((zone) => `${zone.id}:${zone.kind}`).sort()).toEqual(["headline:headline", "hero:image", "picks:list"]);
    const form = specToForm(version);
    expect(form.size).toBe("a4");
    expect(form.zones.map((zone) => zone.id).sort()).toEqual(["headline", "hero", "picks"]);
    expect(buildTemplateSpec(form).trim).toEqual(spec.trim);
  });
  it("refuses bad input with a clear message", () => {
    const fails = (patch: object, message: RegExp) => expect(() => buildTemplateSpec({ ...base, ...patch })).toThrow(message);
    fails({ lockedElements: [] }, /locked element/);
    fails({ zones: [] }, /at least one editable zone/);
    fails({ zones: [{ id: "A b", kind: "copy" }] }, /lower-case/);
    fails({ zones: [{ id: "a", kind: "copy" }, { id: "a", kind: "copy" }] }, /used twice/);
    fails({ zones: [{ id: "a", kind: "nope" }] }, /zone type/);
    fails({ zones: [{ id: "a", kind: "copy", x: "200", y: "0", width: "50", height: "10" }] }, /outside the trim/);
    fails({ zones: [{ id: "a", kind: "copy", x: "1" }] }, /x, y, width and height together/);
    fails({ zones: [{ id: "a", kind: "copy", maxWords: "1.5" }] }, /whole number/);
    fails({ size: "custom", customWidth: "abc" }, /Page width/);
    expect(buildTemplateSpec({ ...base, size: "custom", customWidth: "300", customHeight: "400" }).trim).toMatchObject({ width: 300, height: 400 });
    expect(() => buildTemplateSpec({ ...base, size: "custom", customWidth: "100", customHeight: "150" })).toThrow(TemplateSpecError);
  });
});
