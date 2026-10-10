import { describe, expect, it } from "vitest";
import { FRANCHISE_IMPORT_MAX_ROWS, buildFranchiseRejectReport, normaliseImportDate, parseFranchiseCsv, planFranchiseImport } from "./franchise-import";

const plan = (text: string, existingTerritoryCodes: string[] = [], existingFranchiseNames: string[] = []) => planFranchiseImport({ rows: parseFranchiseCsv(text).rows, existingTerritoryCodes, existingFranchiseNames });
const head = "Territory Code,Territory Name,Franchise Name,Contact,Email,Launch Date,Renewal Date,Stage,Tags\n";

describe("parseFranchiseCsv", () => {
  it("matches headers loosely, upper-cases codes, cleans values and reports ignored columns", () => {
    const parsed = parseFranchiseCsv("code,Area,Business Name,Favourite colour,Owner\n sut ,Sutton,  Raring2go\u0000  Sutton ,blue,Pat\n");
    expect(parsed.fatal).toBeUndefined();
    expect(parsed.headers.ignored).toEqual(["favourite colour"]);
    expect(parsed.rows[0]).toMatchObject({ line: 2, territoryCode: "SUT", territoryName: "Sutton", franchiseName: "Raring2go Sutton", contactName: "Pat" });
  });

  it("refuses a file without the three required columns, an empty file and an over-long one", () => {
    expect(parseFranchiseCsv("code,name\nA,B\n").fatal).toMatch(/territory code, territory name and franchise name/);
    expect(parseFranchiseCsv("").fatal).toMatch(/empty/);
    const rows = Array.from({ length: FRANCHISE_IMPORT_MAX_ROWS + 1 }, (_, i) => `C${i},N${i},F${i}`).join("\n");
    expect(parseFranchiseCsv(`code,territory,franchise\n${rows}\n`).fatal).toMatch(/limit/);
  });
});

describe("normaliseImportDate", () => {
  it("accepts ISO and UK order and rejects impossible or out-of-range dates", () => {
    expect(normaliseImportDate("2025-03-01")).toBe("2025-03-01");
    expect(normaliseImportDate("1/3/2025")).toBe("2025-03-01");
    expect(normaliseImportDate("31/04/2025")).toBeNull();
    expect(normaliseImportDate("2025-02-30")).toBeNull();
    expect(normaliseImportDate("03/01/1999")).toBeNull();
    expect(normaliseImportDate("soon")).toBeNull();
  });
});

describe("planFranchiseImport", () => {
  it("classifies every row and defaults the stage to trading", () => {
    const result = plan(head + [
      "N1,North,North Co,,,01/03/2025,2030-03-01,,north",
      "N2,South,South Co,,,,,onboarding,",
      "N3,,No Name,,,,,,",
      "bad code!,X,Bad Code Co,,,,,,",
      "N4,Mail,Mail Co,,nope,,,,",
      "N5,Dates,Dates Co,,,31/02/2025,,,",
      "N6,Order,Order Co,,,2025-05-01,2025-04-01,,",
      "N7,Stage,Stage Co,,,,,franchised,",
      "n1,Again,Again Co,,,,,,",
      "N8,Clash,Clash Co,,,,,,",
      "N9,Fresh,Existing Name,,,,,,"
    ].join("\n"), ["N8"], ["existing  name"]);
    expect(result.rows.map((r) => r.outcome)).toEqual(["create", "create", "reject_missing_field", "reject_invalid_code", "reject_invalid_email", "reject_invalid_date", "reject_dates_out_of_order", "reject_invalid_stage", "reject_duplicate_in_file", "reject_code_exists", "reject_franchise_exists"]);
    expect(result.rows[0]!.resolved).toEqual({ launchDate: "2025-03-01", renewalDate: "2030-03-01", lifecycle: "trading" });
    expect(result.rows[1]!.resolved?.lifecycle).toBe("onboarding");
    expect(result.summary).toMatchObject({ total: 11, create: 2, rejected: 9 });
  });

  it("never plans to change what exists and builds a report of only the rejected rows", () => {
    const result = plan(head + "SUT,Sutton,Raring2go Sutton,,,,,,\nNEW,New,New Co,,,,,,\n", ["sut"], []);
    expect(result.rows.map((r) => r.outcome)).toEqual(["reject_code_exists", "create"]);
    const report = buildFranchiseRejectReport(result);
    expect(report.split("\n")).toHaveLength(3);
    expect(report).toContain("reject_code_exists");
    expect(report).not.toContain("NEW,");
  });

  it("defuses spreadsheet formulas in the report", () => {
    const result = plan(head + "=BAD,Name,Co,,,,,,\n");
    expect(buildFranchiseRejectReport(result)).not.toMatch(/(^|,)=BAD/m);
  });
});
