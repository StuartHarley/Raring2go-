import { csvCell, parseCsv } from "@raring2go/marketing";

/**
 * Advertiser import: parse a CSV of local businesses, decide what each row would do, and (elsewhere) apply it.
 *
 * Imported advertisers are always *prospects* in the importing territory. Nothing is sent, invoiced or booked by an import, no
 * pricing is assumed, and no marketing consent is created: a business contact is held for account management only, and the
 * audience (parents) is a different system an import never touches. A business that already exists is never merged or overwritten.
 */

export const ADVERTISER_IMPORT_MAX_ROWS = 1000;
export const ADVERTISER_IMPORT_MAX_BYTES = 1024 * 1024;

export type ParsedAdvertiserRow = {
  line: number;
  businessName: string;
  contactName: string | null;
  contactEmail: string | null;
  phone: string | null;
  role: string | null;
  tags: string[];
  notes: string | null;
};

export type AdvertiserCsvResult = {
  rows: ParsedAdvertiserRow[];
  headers: { mapped: string[]; ignored: string[] };
  fatal?: string;
};

const aliases: Record<string, string[]> = {
  businessName: ["business", "business name", "business_name", "company", "company name", "organisation", "organization", "name", "advertiser"],
  contactName: ["contact", "contact name", "contact_name", "contact person", "owner", "owner name"],
  contactEmail: ["email", "e-mail", "email address", "contact email", "contact_email"],
  phone: ["phone", "telephone", "tel", "mobile", "phone number", "contact phone"],
  role: ["role", "job title", "position", "contact role"],
  tags: ["tags", "tag", "labels", "category", "categories"],
  notes: ["notes", "note", "comments", "comment"]
};

const clean = (value: string | undefined, max: number) => {
  const text = (value ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  return text === "" ? null : text.slice(0, max);
};

export function parseAdvertiserCsv(text: string): AdvertiserCsvResult {
  const records = parseCsv(text);
  if (records.length === 0) return { rows: [], headers: { mapped: [], ignored: [] }, fatal: "The file is empty." };
  const header = records[0]!.map((cell) => cell.trim().toLowerCase());
  const columns = Object.fromEntries(Object.keys(aliases).map((key) => [key, header.findIndex((cell) => aliases[key]!.includes(cell))])) as Record<string, number>;
  const used = new Set(Object.values(columns).filter((index) => index >= 0));
  const headers = { mapped: Object.entries(columns).filter(([, index]) => index >= 0).map(([key]) => key), ignored: header.filter((cell, index) => cell !== "" && !used.has(index)) };
  if (columns.businessName! < 0) return { rows: [], headers, fatal: "There is no business name column. Name it business, company or business name." };
  if (records.length - 1 > ADVERTISER_IMPORT_MAX_ROWS) return { rows: [], headers, fatal: `This file has ${records.length - 1} rows. The limit is ${ADVERTISER_IMPORT_MAX_ROWS} per import: split it and import in parts.` };

  const cell = (record: string[], key: string, max: number) => (columns[key]! >= 0 ? clean(record[columns[key]!], max) : null);
  const rows = records.slice(1).map((record, offset): ParsedAdvertiserRow => ({
    line: offset + 2,
    businessName: clean(record[columns.businessName!], 200) ?? "",
    contactName: cell(record, "contactName", 120),
    contactEmail: cell(record, "contactEmail", 254),
    phone: cell(record, "phone", 40),
    role: cell(record, "role", 60),
    tags: columns.tags! >= 0 ? [...new Set((record[columns.tags!] ?? "").split(/[;,|]/).map((tag) => clean(tag, 40)?.toLowerCase()).filter((tag): tag is string => Boolean(tag)))].slice(0, 10) : [],
    notes: cell(record, "notes", 1000)
  }));
  return { rows, headers };
}

export type AdvertiserRowOutcome = "create" | "reject_missing_name" | "reject_invalid_email" | "reject_duplicate_in_file" | "reject_exists";

export type PlannedAdvertiserRow = { line: number; businessName: string; outcome: AdvertiserRowOutcome; reason: string; row: ParsedAdvertiserRow };

export type AdvertiserImportPlan = {
  rows: PlannedAdvertiserRow[];
  summary: { total: number; create: number; rejected: number; byOutcome: Partial<Record<AdvertiserRowOutcome, number>> };
};

const emailPattern = /^[^\s@,;<>()[\]\\"]{1,64}@[^\s@,;<>()[\]\\"]{1,255}\.[a-z]{2,}$/i;

/** The same name test the staff "create advertiser" form uses, so an import can never create what the form would refuse. */
export const normaliseBusinessName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function planAdvertiserImport(input: { rows: ParsedAdvertiserRow[]; existingNames: Iterable<string> }): AdvertiserImportPlan {
  const existing = new Set([...input.existingNames].map(normaliseBusinessName));
  const seen = new Set<string>();
  const planned: PlannedAdvertiserRow[] = [];
  for (const row of input.rows) {
    const base = { line: row.line, businessName: row.businessName, row };
    const reject = (outcome: AdvertiserRowOutcome, reason: string): PlannedAdvertiserRow => ({ ...base, outcome, reason });
    if (!row.businessName) {
      planned.push(reject("reject_missing_name", "No business name"));
      continue;
    }
    if (row.contactEmail && !emailPattern.test(row.contactEmail)) {
      planned.push(reject("reject_invalid_email", "The contact email is not a valid address (leave it blank if you do not have one)"));
      continue;
    }
    const key = normaliseBusinessName(row.businessName);
    if (seen.has(key)) {
      planned.push(reject("reject_duplicate_in_file", "This business appears earlier in the file"));
      continue;
    }
    seen.add(key);
    if (existing.has(key)) {
      planned.push(reject("reject_exists", "An advertiser with this name already exists, so it was not added or changed"));
      continue;
    }
    planned.push({ ...base, outcome: "create", reason: "New prospect" });
  }
  const byOutcome: Partial<Record<AdvertiserRowOutcome, number>> = {};
  for (const item of planned) byOutcome[item.outcome] = (byOutcome[item.outcome] ?? 0) + 1;
  const create = planned.filter((item) => item.outcome === "create").length;
  return { rows: planned, summary: { total: planned.length, create, rejected: planned.length - create, byOutcome } };
}

/** Every row that was not added, with the reason, as a CSV to fix and re-upload. */
export function buildAdvertiserRejectReport(plan: AdvertiserImportPlan): string {
  const lines = ["line,business,outcome,reason"];
  for (const item of plan.rows.filter((row) => row.outcome !== "create")) lines.push([item.line, item.businessName, item.outcome, item.reason].map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}
