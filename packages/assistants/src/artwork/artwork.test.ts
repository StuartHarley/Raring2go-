import { describe, expect, it } from "vitest";
import { classifyArtwork } from "./classify";
import { analysePreflight } from "./preflight";
import type { PreflightCheckInput } from "./preflight";
import { mergePreflightHelp, preflightHelpTask } from "./tasks";

const rgb: PreflightCheckInput = { code: "colour_space_rgb", severity: "error", message: "Artwork must use CMYK colour for print.", fixable: true };
const lowRes: PreflightCheckInput = { code: "low_resolution", severity: "error", message: "Placed images must be at least 300dpi for print.", fixable: false };
const links: PreflightCheckInput = { code: "unchecked_links", severity: "warning", message: "Digital links have not been checked.", fixable: true };

describe("preflight analysis", () => {
  it("explains known findings and gives conservative fix verdicts", () => {
    const analysis = analysePreflight([rgb, lowRes, links]);
    const byCode = Object.fromEntries(analysis.items.map((item) => [item.code, item]));
    expect(byCode.colour_space_rgb).toMatchObject({ fixability: "auto_safe", title: expect.stringContaining("RGB") });
    expect(byCode.low_resolution!.fixability).toBe("needs_new_artwork");
    expect(byCode.low_resolution!.steps.join(" ")).toMatch(/higher-resolution/i);
    expect(analysis.readyForPrint).toBe(false);
    expect(analysis.blockers).toBe(2);
    expect(analysis.summary).toMatch(/not ready for print/);
  });

  it("never upgrades: an engine 'not fixable' beats a knowledge-base 'auto safe', and low resolution can never be auto-fixed", () => {
    const stricter = analysePreflight([{ ...rgb, fixable: false }, { ...lowRes, fixable: true }]);
    expect(stricter.items.find((item) => item.code === "colour_space_rgb")!.fixability).toBe("manual");
    expect(stricter.items.find((item) => item.code === "low_resolution")!.fixability).toBe("needs_new_artwork");
  });

  it("treats unknown findings as needing a person, and a clean or warnings-only result as ready", () => {
    const unknown = analysePreflight([{ code: "novel_check", severity: "error", message: "Something new.", fixable: true }]);
    // Even if the engine says fixable, an unrecognised finding is never claimed auto-fixable.
    expect(unknown.items[0]).toMatchObject({ title: "Preflight issue", fixability: "manual" });
    expect(analysePreflight([]).readyForPrint).toBe(true);
    expect(analysePreflight([]).summary).toMatch(/no issues/);
    expect(analysePreflight([links]).readyForPrint).toBe(true);
  });
});

describe("preflight help task: model wording can never change a verdict", () => {
  const input = { label: "Page 4", checks: [rgb, lowRes] };

  it("keeps the engine's verdicts and only takes the model's wording", () => {
    const merged = mergePreflightHelp(
      { summary: "Two problems to sort out before this can go to print.", items: [{ code: "colour_space_rgb", explanation: "Your colours are RGB; printers need CMYK.", steps: ["Convert it.", "Check the colours."], fixability: "auto_safe", severity: "info" }, { code: "invented", explanation: "x", steps: [] }] },
      input
    );
    expect(merged.items.map((item) => item.code)).toEqual(["colour_space_rgb", "low_resolution"]);
    expect(merged.items[0]).toMatchObject({ explanation: "Your colours are RGB; printers need CMYK.", steps: ["Convert it.", "Check the colours."], severity: "error", fixability: "auto_safe" });
    expect(merged.readyForPrint).toBe(false);
    expect(merged.summary).toBe("Two problems to sort out before this can go to print.");
  });

  it("ignores a model that tries to change fixability, severity or readiness", () => {
    const merged = mergePreflightHelp({ summary: "All good.", readyForPrint: true, items: [{ code: "low_resolution", explanation: "Fine.", steps: ["Upscale it."], fixability: "auto_safe", severity: "info" }] }, input);
    expect(merged.readyForPrint).toBe(false);
    expect(merged.items[1]).toMatchObject({ fixability: "needs_new_artwork", severity: "error" });
  });

  it("discards a summary that claims print-ready while a blocker remains", () => {
    for (const claim of ["This artwork is print-ready.", "Good to go!", "No issues found, it will print fine.", "Print safe."]) {
      const merged = mergePreflightHelp({ summary: claim, items: [] }, input);
      expect(merged.summary).toMatch(/not ready for print/);
    }
  });

  it("strips markup, bounds lengths, and falls back to the knowledge base when the model gives nothing", () => {
    const merged = mergePreflightHelp({ summary: "<b>Heads up</b>", items: [{ code: "colour_space_rgb", explanation: "<script>x</script>Use CMYK" + "!".repeat(1000), steps: [] }] }, input);
    expect(merged.summary).toBe("Heads up");
    expect(merged.items[0]!.explanation).not.toContain("<");
    expect(merged.items[0]!.explanation.length).toBeLessThanOrEqual(400);
    expect(merged.items[0]!.steps.length).toBeGreaterThan(0);
  });

  it("parses a fenced JSON reply, rejects non-JSON, and produces the same thing deterministically with no model", () => {
    const fenced = "```json\n" + JSON.stringify({ summary: "Fix two things.", items: [] }) + "\n```";
    expect(preflightHelpTask.parse(fenced, input).summary).toBe("Fix two things.");
    expect(() => preflightHelpTask.parse("not json", input)).toThrow();
    const none = preflightHelpTask.deterministic(input);
    expect(none.readyForPrint).toBe(false);
    expect(none.items).toHaveLength(2);
  });

  it("is a low-risk, informational task behind its own permission, and stores only a bounded, secret-free input", () => {
    expect(preflightHelpTask).toMatchObject({ key: "artwork.preflight_help", risk: "low", approval: "none", capability: { module: "artwork", action: "ai_assist" } });
    expect(preflightHelpTask.summariseInput({ label: "x".repeat(500), checks: [rgb, lowRes] })).toEqual({ label: "x".repeat(200), checkCodes: ["colour_space_rgb", "low_resolution"], errors: 2 });
    expect(preflightHelpTask.buildUserPrompt(input)).toContain("code=low_resolution severity=error fixability=needs_new_artwork");
  });
});

describe("artwork classification", () => {
  it("classifies from real facts and says how sure it is", () => {
    expect(classifyArtwork({ fileName: "Acme-Logo.png", contentType: "image/png", bytes: 80_000, widthPx: 1200, heightPx: 600 })).toMatchObject({ classification: "logo", confidence: "high" });
    expect(classifyArtwork({ fileName: "advert.pdf", contentType: "application/pdf", bytes: 900_000, intendedSlot: "full_page" })).toMatchObject({ classification: "full_page_ad", confidence: "medium" });
    expect(classifyArtwork({ fileName: "advert.pdf", contentType: "application/pdf", bytes: 900_000, intendedSlot: "half_page" })).toMatchObject({ classification: "partial_page_ad" });
    expect(classifyArtwork({ fileName: "scan.png", contentType: "image/png", bytes: 3_000_000, widthPx: 2480, heightPx: 3508 })).toMatchObject({ classification: "full_page_ad", confidence: "medium" });
    expect(classifyArtwork({ fileName: "IMG_1234.jpg", contentType: "image/jpeg", bytes: 3_000_000, widthPx: 4500, heightPx: 3000 })).toMatchObject({ classification: "photograph" });
  });

  it("refuses to guess when it cannot tell, and flags unsuitable files", () => {
    expect(classifyArtwork({ fileName: "notes.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: 20_000 })).toMatchObject({ classification: "unknown", confidence: "low" });
    expect(classifyArtwork({ fileName: "advert.pdf", contentType: "application/pdf", bytes: 900_000 })).toMatchObject({ classification: "document", confidence: "low" });
    expect(classifyArtwork({ fileName: "tiny.png", contentType: "image/png", bytes: 900 }).concerns.join(" ")).toMatch(/very small/);
    expect(classifyArtwork({ fileName: "art.png", contentType: "image/png", bytes: 500_000 }).concerns.join(" ")).toMatch(/dimensions were not recorded/);
  });
});
