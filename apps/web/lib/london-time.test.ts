import { describe, expect, it } from "vitest";
import { formatLondon, londonLocalToIso } from "./london-time";

describe("londonLocalToIso", () => {
  it("is the same as UTC in winter and an hour earlier in summer", () => {
    expect(londonLocalToIso("2026-01-15T09:00")).toBe("2026-01-15T09:00:00.000Z");
    expect(londonLocalToIso("2026-07-15T09:00")).toBe("2026-07-15T08:00:00.000Z");
  });

  it("switches on the clock-change days (29 March and 25 October 2026)", () => {
    expect(londonLocalToIso("2026-03-29T00:30")).toBe("2026-03-29T00:30:00.000Z");
    expect(londonLocalToIso("2026-03-29T02:30")).toBe("2026-03-29T01:30:00.000Z");
    expect(londonLocalToIso("2026-10-25T00:30")).toBe("2026-10-24T23:30:00.000Z");
    expect(londonLocalToIso("2026-10-25T09:00")).toBe("2026-10-25T09:00:00.000Z");
  });

  it("rejects a time that does not exist and malformed input", () => {
    expect(londonLocalToIso("2026-03-29T01:30")).toBeUndefined();
    expect(londonLocalToIso("tomorrow")).toBeUndefined();
    expect(londonLocalToIso("")).toBeUndefined();
    expect(londonLocalToIso("2026-02-30T09:00")).toBeUndefined();
  });

  it("formats back in London time", () => {
    expect(formatLondon("2026-07-15T08:00:00.000Z")).toContain("09:00");
    expect(formatLondon(null)).toBe("not scheduled");
  });
});
