import { describe, expect, it } from "vitest";
import { IMPORT_MAX_ROWS, assessConsentEvidence, buildRejectReport, csvCell, parseAudienceCsv, parseCsv, planAudienceImport } from "./audience-import";
import type { ParsedImportRow } from "./audience-import";
import type { MarketingData } from "./types";

const TODAY = "2026-10-09";
const TERRITORY = "territory_a";

const data = (): MarketingData => ({
  contacts: [], subscriptions: [], suppressions: [], consentEvents: [], activityEvents: [], preferenceProfiles: [], savedContent: []
} as unknown as MarketingData);

const row = (overrides: Partial<ParsedImportRow> = {}): ParsedImportRow => ({
  line: 2, email: "pat@example.test", firstName: "Pat", lastName: "Parent", consentDate: "2026-09-01", consentSource: "Website form", tags: [], ...overrides
});

const contact = (id: string, email: string, emailStatus = "subscribed") => ({ id, email, emailNormalised: email.toLowerCase(), emailStatus, tags: [], metadata: {} });

describe("parseCsv", () => {
  it("handles quotes, embedded commas and newlines, escaped quotes, CRLF and a BOM", () => {
    const text = '﻿email,first_name\r\n"a@b.test","Smith, ""Jo"""\r\n"c@d.test","two\nlines"\r\n';
    expect(parseCsv(text)).toEqual([["email", "first_name"], ["a@b.test", 'Smith, "Jo"'], ["c@d.test", "two\nlines"]]);
  });

  it("skips blank lines and keeps a final row with no trailing newline", () => {
    expect(parseCsv("a,b\n\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseAudienceCsv", () => {
  it("maps common header names from other tools and reports what it ignored", () => {
    const result = parseAudienceCsv("E-mail,First Name,Surname,OPTIN_TIME,Source,Tags,Favourite colour\nPat@Example.test,Pat,Parent,2026-09-01,Website form,\"a; b|c\",blue\n");
    expect(result.fatal).toBeUndefined();
    expect(result.headers).toMatchObject({ email: "e-mail", ignored: ["favourite colour"] });
    expect(result.rows[0]).toMatchObject({ line: 2, email: "Pat@Example.test", firstName: "Pat", lastName: "Parent", consentDate: "2026-09-01", consentSource: "Website form", tags: ["a", "b", "c"] });
  });

  it("refuses a file with no email column or too many rows, and an empty file", () => {
    expect(parseAudienceCsv("name\nPat").fatal).toMatch(/no email column/);
    expect(parseAudienceCsv("").fatal).toMatch(/empty/);
    const big = `email\n${Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `u${i}@example.test`).join("\n")}`;
    expect(parseAudienceCsv(big).fatal).toMatch(/limit/);
  });

  it("strips control and zero-width characters from names and caps lengths", () => {
    const [parsed] = parseAudienceCsv(`email,first_name\na@b.test,"Pa​t\u0007 ${"x".repeat(300)}"\n`).rows;
    expect(parsed!.firstName).not.toMatch(/[​\u0007]/);
    expect(parsed!.firstName!.length).toBeLessThanOrEqual(100);
  });
});

describe("assessConsentEvidence", () => {
  it("needs both a real, past, recent date and a source", () => {
    expect(assessConsentEvidence({ consentDate: "2026-09-01", consentSource: "Form" }, TODAY)).toEqual({ ok: true, date: "2026-09-01", source: "Form" });
    expect(assessConsentEvidence({ consentDate: "01/09/2026", consentSource: "Form" }, TODAY)).toMatchObject({ ok: true, date: "2026-09-01" });
    expect(assessConsentEvidence({ consentDate: null, consentSource: null }, TODAY)).toMatchObject({ ok: false });
    expect(assessConsentEvidence({ consentDate: "2026-09-01", consentSource: null }, TODAY)).toMatchObject({ ok: false, reason: expect.stringMatching(/no source/) });
    expect(assessConsentEvidence({ consentDate: null, consentSource: "Form" }, TODAY)).toMatchObject({ ok: false, reason: expect.stringMatching(/no date/) });
    expect(assessConsentEvidence({ consentDate: "yesterday", consentSource: "Form" }, TODAY)).toMatchObject({ ok: false, reason: expect.stringMatching(/not a date/) });
    expect(assessConsentEvidence({ consentDate: "2026-02-30", consentSource: "Form" }, TODAY)).toMatchObject({ ok: false, reason: expect.stringMatching(/real date/) });
    expect(assessConsentEvidence({ consentDate: "2027-01-01", consentSource: "Form" }, TODAY)).toMatchObject({ ok: false, reason: expect.stringMatching(/future/) });
    expect(assessConsentEvidence({ consentDate: "2023-01-01", consentSource: "Form" }, TODAY)).toMatchObject({ ok: false, reason: expect.stringMatching(/24 months/) });
  });
});

describe("planAudienceImport", () => {
  const plan = (rows: ParsedImportRow[], d = data(), basis: "consent_evidenced" | "no_consent_record" = "consent_evidenced") => planAudienceImport(d, { territoryId: TERRITORY, basis, rows, today: TODAY });

  it("subscribes a new contact only when the row has consent evidence, otherwise imports them pending", () => {
    const result = plan([row({ line: 2 }), row({ line: 3, email: "no-evidence@example.test", consentDate: null, consentSource: null }), row({ line: 4, email: "stale@example.test", consentDate: "2020-01-01" })]);
    expect(result.rows.map((item) => item.outcome)).toEqual(["create_subscribed", "create_pending", "create_pending"]);
    expect(result.rows[0]!.consent).toEqual({ date: "2026-09-01", source: "Website form" });
    expect(result.rows[2]!.reason).toMatch(/24 months/);
    expect(result.summary).toMatchObject({ total: 3, newSubscribed: 1, newPending: 2, rejected: 0 });
  });

  it("never subscribes anyone when the import is declared as having no consent record, even if the file has dates", () => {
    const result = plan([row()], data(), "no_consent_record");
    expect(result.rows[0]).toMatchObject({ outcome: "create_pending" });
    expect(result.rows[0]!.consent).toBeUndefined();
  });

  it("rejects bad addresses and repeats within the file, treating addresses case-insensitively", () => {
    const result = plan([row({ line: 2, email: "not-an-email" }), row({ line: 3, email: "Dup@Example.test" }), row({ line: 4, email: "dup@example.TEST" }), row({ line: 5, email: "a,b@example.test" }), row({ line: 6, email: "" })]);
    expect(result.rows.map((item) => item.outcome)).toEqual(["reject_invalid_email", "create_subscribed", "reject_duplicate_in_file", "reject_invalid_email", "reject_invalid_email"]);
  });

  it("never revives a suppressed or previously unsubscribed person", () => {
    const d = data();
    d.contacts.push(contact("c1", "gone@example.test", "suppressed") as never, contact("c2", "unsub@example.test") as never, contact("c3", "bounced@example.test") as never);
    d.subscriptions.push({ id: "s2", contactId: "c2", territoryId: TERRITORY, status: "unsubscribed" } as never);
    d.suppressions.push({ id: "x", contactId: "c3", active: true, reason: "hard_bounce" } as never);
    const result = plan([row({ email: "gone@example.test" }), row({ line: 3, email: "unsub@example.test" }), row({ line: 4, email: "bounced@example.test" })], d);
    expect(result.rows.map((item) => item.outcome)).toEqual(["reject_suppressed", "reject_previously_unsubscribed", "reject_suppressed"]);
    expect(result.summary.rejected).toBe(3);
  });

  it("handles existing contacts: skip if already subscribed, add the territory if they have evidence, never overwrite", () => {
    const d = data();
    d.contacts.push(contact("c1", "in@example.test") as never, contact("c2", "elsewhere@example.test") as never, contact("c3", "waiting@example.test") as never);
    d.subscriptions.push(
      { id: "s1", contactId: "c1", territoryId: TERRITORY, status: "subscribed" } as never,
      { id: "s2", contactId: "c2", territoryId: "territory_b", status: "subscribed" } as never,
      { id: "s3", contactId: "c3", territoryId: TERRITORY, status: "pending_consent" } as never
    );
    const result = plan([
      row({ email: "in@example.test" }),
      row({ line: 3, email: "elsewhere@example.test" }),
      row({ line: 4, email: "elsewhere@example.test", consentDate: null, consentSource: null }),
      row({ line: 5, email: "waiting@example.test", consentDate: null, consentSource: null })
    ], d);
    expect(result.rows.map((item) => item.outcome)).toEqual(["skip_already_subscribed", "add_subscription", "reject_duplicate_in_file", "skip_existing_no_evidence"]);
    expect(result.rows[1]).toMatchObject({ existingContactId: "c2" });
  });

  it("ignores soft-deleted contacts, so a deleted person can be imported again as new", () => {
    const d = data();
    d.contacts.push({ ...contact("c1", "back@example.test"), deletedAt: new Date() } as never);
    expect(plan([row({ email: "back@example.test" })], d).rows[0]!.outcome).toBe("create_subscribed");
  });
});

describe("reject report", () => {
  it("lists rejected and pending rows with reasons, and defuses spreadsheet formulas", () => {
    const result = planAudienceImport(data(), { territoryId: TERRITORY, basis: "consent_evidenced", today: TODAY, rows: [row({ email: "=HYPERLINK(\"http://evil\")" }), row({ line: 3, email: "ok@example.test" }), row({ line: 4, email: "pending@example.test", consentDate: null, consentSource: null })] });
    const report = buildRejectReport(result);
    const lines = report.trim().split("\n");
    expect(lines[0]).toBe("line,email,outcome,reason");
    expect(lines).toHaveLength(3);
    expect(report).not.toContain("ok@example.test");
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[2]).toContain("create_pending");
  });

  it("quotes cells that need it and prefixes formula characters", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)"]) expect(csvCell(bad).startsWith("'")).toBe(true);
    expect(csvCell("plain")).toBe("plain");
  });
});
