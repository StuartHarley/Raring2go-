import { describe, expect, it } from "vitest";
import { displayName, firstName, formatCount, formatDate, formatDateTime, formatLabel, formatLabels, initials, isUuid } from "./format";

describe("formatLabel", () => {
  it("turns machine statuses into words", () => {
    expect(formatLabel("pending_review")).toBe("Pending review");
    expect(formatLabel("needs-watch")).toBe("Needs watch");
    expect(formatLabel("ACTIVE")).toBe("Active");
    expect(formatLabel("missingImage")).toBe("Missing image");
  });

  it("falls back for empty values", () => {
    expect(formatLabel(undefined)).toBe("Unknown");
    expect(formatLabel("", "Not set")).toBe("Not set");
    expect(formatLabel("___")).toBe("Unknown");
  });

  it("joins lists", () => {
    expect(formatLabels(["missing_image", "no_standfirst"])).toBe("Missing image, No standfirst");
  });
});

describe("dates", () => {
  it("formats ISO dates in en-GB without a time zone shift", () => {
    expect(formatDate("2026-08-10")).toBe("10 Aug 2026");
    expect(formatDate(new Date("2026-12-24T10:30:00Z"))).toBe("24 Dec 2026");
    expect(formatDateTime("2026-01-05T09:05:00Z")).toBe("5 Jan 2026, 09:05");
  });

  it("never prints Invalid Date", () => {
    expect(formatDate(undefined)).toBe("Not set");
    expect(formatDate("not a date", "Unknown")).toBe("Unknown");
  });
});

describe("names", () => {
  it("counts with plurals", () => {
    expect(formatCount(1, "edition")).toBe("1 edition");
    expect(formatCount(3, "edition")).toBe("3 editions");
    expect(formatCount(0, "entry", "entries")).toBe("0 entries");
  });

  it("recognises identifiers and refuses to show them as names", () => {
    const id = "00000000-0000-4000-8000-000000000101";
    expect(isUuid(id)).toBe(true);
    expect(isUuid("Sutton Coldfield")).toBe(false);
    expect(displayName(id, "Territory")).toBe("Territory");
    expect(displayName("Sutton Coldfield", "Territory")).toBe("Sutton Coldfield");
    expect(displayName(undefined, "Territory")).toBe("Territory");
  });

  it("greets by first name and builds initials", () => {
    expect(firstName("Jane Example")).toBe("Jane");
    expect(firstName("  ")).toBe("there");
    expect(initials("Jane Example-Smith")).toBe("JE");
    expect(initials("Cher")).toBe("C");
    expect(initials(undefined)).toBe("?");
  });
});

describe("formatCode", () => {
  it("turns dotted codes into words", async () => {
    const { formatCode } = await import("./format");
    expect(formatCode("advertiser.invoice.created")).toBe("Advertiser invoice created");
    expect(formatCode("finance.sync_accounting")).toBe("Finance sync accounting");
    expect(formatCode(undefined)).toBe("Unknown");
  });
});
