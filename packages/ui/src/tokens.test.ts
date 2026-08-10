import { describe, expect, it } from "vitest";
import { brandColors, density, seasonalColors, semanticColors } from "./tokens";

describe("Raring2go design tokens", () => {
  it("keeps brand and seasonal colours separate from semantic status tokens", () => {
    expect(brandColors.purple).toBe("#852890");
    expect(seasonalColors.autumn).toBe("#fbad18");
    expect(semanticColors.statusWarning).not.toBe(seasonalColors.autumn);
    expect(semanticColors.statusDanger).not.toBe(seasonalColors.winter);
  });

  it("defines comfortable and compact density modes", () => {
    expect(density.comfortable.controlHeight).toBe("44px");
    expect(density.compact.controlHeight).toBe("34px");
  });
});
