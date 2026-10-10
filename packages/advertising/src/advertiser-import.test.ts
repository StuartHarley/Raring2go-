import { describe, expect, it } from "vitest";
import { ADVERTISER_IMPORT_MAX_ROWS, buildAdvertiserRejectReport, normaliseBusinessName, parseAdvertiserCsv, planAdvertiserImport } from "./advertiser-import";

const csv = `Business Name,Contact,Email,Phone,Role,Tags,Notes,Favourite colour
Cafe One,Pat Example,pat@example.test,0121 000 0000,Owner,"cafe; family",Met at the fair,blue
,No Name,x@example.test,,,,,
Bad Email Ltd,Sam,not-an-email,,,,,
cafe   one,Dup,,,,,,
Existing Bakery,Jo,jo@example.test,,,,,
=cmd|' /C calc'!A1,Evil,,,,,,
Plain Shop,,,,,,,
`;

describe("advertiser import", () => {
  it("parses loosely named columns, cleans values and reports what it ignored", () => {
    const parsed = parseAdvertiserCsv(csv);
    expect(parsed.fatal).toBeUndefined();
    expect(parsed.headers.mapped).toEqual(["businessName", "contactName", "contactEmail", "phone", "role", "tags", "notes"]);
    expect(parsed.headers.ignored).toEqual(["favourite colour"]);
    expect(parsed.rows[0]).toMatchObject({ line: 2, businessName: "Cafe One", contactName: "Pat Example", contactEmail: "pat@example.test", phone: "0121 000 0000", role: "Owner", tags: ["cafe", "family"], notes: "Met at the fair" });
    expect(parsed.rows[2]!.contactEmail).toBe("not-an-email");
  });
  it("refuses a file with no business column, an empty file, and too many rows", () => {
    expect(parseAdvertiserCsv("email\nx@y.test").fatal).toMatch(/no business name column/);
    expect(parseAdvertiserCsv("").fatal).toMatch(/empty/);
    const many = `business\n${Array.from({ length: ADVERTISER_IMPORT_MAX_ROWS + 1 }, (_, i) => `B${i}`).join("\n")}`;
    expect(parseAdvertiserCsv(many).fatal).toMatch(/limit is 1000/);
  });
  it("plans each row: creates new ones and refuses blanks, bad emails, repeats and existing businesses", () => {
    const plan = planAdvertiserImport({ rows: parseAdvertiserCsv(csv).rows, existingNames: ["  existing  BAKERY "] });
    expect(plan.rows.map((r) => [r.line, r.outcome])).toEqual([
      [2, "create"], [3, "reject_missing_name"], [4, "reject_invalid_email"], [5, "reject_duplicate_in_file"], [6, "reject_exists"], [7, "create"], [8, "create"]
    ]);
    expect(plan.summary).toMatchObject({ total: 7, create: 3, rejected: 4 });
    expect(normaliseBusinessName("  Cafe   ONE ")).toBe("cafe one");
  });
  it("builds a reject report that cannot run a spreadsheet formula", () => {
    const parsed = parseAdvertiserCsv("business\n=HYPERLINK(\"http://evil.test\")\n,\n");
    const report = buildAdvertiserRejectReport(planAdvertiserImport({ rows: [{ ...parsed.rows[0]!, businessName: "x" }, { ...parsed.rows[1]!, businessName: "" }], existingNames: ["x"] }));
    expect(report.split("\n")[0]).toBe("line,business,outcome,reason");
    expect(report).toContain("reject_exists");
    const evil = buildAdvertiserRejectReport({ rows: [{ line: 2, businessName: "=1+1", outcome: "reject_exists", reason: "r", row: parsed.rows[0]! }], summary: { total: 1, create: 0, rejected: 1, byOutcome: {} } });
    expect(evil).toContain("'=1+1");
  });
});
