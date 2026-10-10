import { csvCell, parseCsv } from "@raring2go/marketing";

/**
 * Franchise import (UAT-003): parse a CSV of franchises and their territories, decide what each row would do, and (elsewhere) apply it.
 *
 * An import creates records only: a franchise organisation, its territory and the franchise record, plus a primary contact if the row has
 * one. It never creates a user, a role assignment, an agreement, an invoice or any consent, and it never changes a franchise or territory
 * that already exists. Getting people into the system stays the invitation flow's job.
 */

export const FRANCHISE_IMPORT_MAX_ROWS = 500;
export const FRANCHISE_IMPORT_MAX_BYTES = 512 * 1024;

export type FranchiseLifecycle = "onboarding" | "trading";

export type ParsedFranchiseRow = {
  line: number;
  territoryCode: string;
  territoryName: string;
  franchiseName: string;
  contactName: string | null;
  contactEmail: string | null;
  phone: string | null;
  launchDate: string | null;
  renewalDate: string | null;
  lifecycle: string | null;
  tags: string[];
};

export type FranchiseCsvResult = { rows: ParsedFranchiseRow[]; headers: { mapped: string[]; ignored: string[] }; fatal?: string };

const aliases: Record<string, string[]> = {
  territoryCode: ["territory code", "territory_code", "code", "territory id", "area code"],
  territoryName: ["territory", "territory name", "territory_name", "area", "area name"],
  franchiseName: ["franchise", "franchise name", "franchise_name", "business", "business name", "company", "trading name"],
  contactName: ["contact", "contact name", "contact_name", "owner", "owner name", "franchisee", "franchisee name"],
  contactEmail: ["email", "e-mail", "email address", "contact email", "contact_email", "owner email"],
  phone: ["phone", "telephone", "tel", "mobile", "phone number", "contact phone"],
  launchDate: ["launch date", "launch_date", "launched", "start date", "opened"],
  renewalDate: ["renewal date", "renewal_date", "renewal", "agreement renewal"],
  lifecycle: ["stage", "lifecycle", "lifecycle stage", "status"],
  tags: ["tags", "tag", "labels"]
};

const clean = (value: string | undefined, max: number) => {
  const text = (value ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  return text === "" ? null : text.slice(0, max);
};

export function parseFranchiseCsv(text: string): FranchiseCsvResult {
  const records = parseCsv(text);
  if (records.length === 0) return { rows: [], headers: { mapped: [], ignored: [] }, fatal: "The file is empty." };
  const header = records[0]!.map((cell) => cell.trim().toLowerCase());
  const columns = Object.fromEntries(Object.keys(aliases).map((key) => [key, header.findIndex((cell) => aliases[key]!.includes(cell))])) as Record<string, number>;
  const used = new Set(Object.values(columns).filter((index) => index >= 0));
  const headers = { mapped: Object.entries(columns).filter(([, index]) => index >= 0).map(([key]) => key), ignored: header.filter((cell, index) => cell !== "" && !used.has(index)) };
  const missing = (["territoryCode", "territoryName", "franchiseName"] as const).filter((key) => columns[key]! < 0);
  if (missing.length > 0) return { rows: [], headers, fatal: `The file needs a territory code, territory name and franchise name column (missing: ${missing.map((key) => key.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ")}).` };
  if (records.length - 1 > FRANCHISE_IMPORT_MAX_ROWS) return { rows: [], headers, fatal: `This file has ${records.length - 1} rows. The limit is ${FRANCHISE_IMPORT_MAX_ROWS} per import: split it and import in parts.` };

  const cell = (record: string[], key: string, max: number) => (columns[key]! >= 0 ? clean(record[columns[key]!], max) : null);
  const rows = records.slice(1).map((record, offset): ParsedFranchiseRow => ({
    line: offset + 2,
    territoryCode: (cell(record, "territoryCode", 40) ?? "").toUpperCase(),
    territoryName: cell(record, "territoryName", 120) ?? "",
    franchiseName: cell(record, "franchiseName", 200) ?? "",
    contactName: cell(record, "contactName", 120),
    contactEmail: cell(record, "contactEmail", 254),
    phone: cell(record, "phone", 40),
    launchDate: cell(record, "launchDate", 20),
    renewalDate: cell(record, "renewalDate", 20),
    lifecycle: cell(record, "lifecycle", 20)?.toLowerCase() ?? null,
    tags: columns.tags! >= 0 ? [...new Set((record[columns.tags!] ?? "").split(/[;,|]/).map((tag) => clean(tag, 40)?.toLowerCase()).filter((tag): tag is string => Boolean(tag)))].slice(0, 10) : []
  }));
  return { rows, headers };
}

/** Accepts yyyy-mm-dd or dd/mm/yyyy (UK order) and returns a real calendar date as yyyy-mm-dd, or null. */
export function normaliseImportDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : uk ? [Number(uk[3]), Number(uk[2]), Number(uk[1])] : [NaN, NaN, NaN];
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export type FranchiseRowOutcome =
  | "create"
  | "reject_missing_field"
  | "reject_invalid_code"
  | "reject_invalid_email"
  | "reject_invalid_date"
  | "reject_dates_out_of_order"
  | "reject_invalid_stage"
  | "reject_duplicate_in_file"
  | "reject_code_exists"
  | "reject_franchise_exists";

export type PlannedFranchiseRow = {
  line: number;
  territoryCode: string;
  franchiseName: string;
  outcome: FranchiseRowOutcome;
  reason: string;
  row: ParsedFranchiseRow;
  /** The cleaned values an applied row is created with; present only for "create". */
  resolved?: { launchDate: string | null; renewalDate: string | null; lifecycle: FranchiseLifecycle };
};

export type FranchiseImportPlan = {
  rows: PlannedFranchiseRow[];
  summary: { total: number; create: number; rejected: number; byOutcome: Partial<Record<FranchiseRowOutcome, number>> };
};

const emailPattern = /^[^\s@,;<>()[\]\\"]{1,64}@[^\s@,;<>()[\]\\"]{1,255}\.[a-z]{2,}$/i;
export const territoryCodePattern = /^[A-Z0-9][A-Z0-9-]{1,14}$/;
export const normaliseFranchiseName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function planFranchiseImport(input: { rows: ParsedFranchiseRow[]; existingTerritoryCodes: Iterable<string>; existingFranchiseNames: Iterable<string> }): FranchiseImportPlan {
  const codes = new Set([...input.existingTerritoryCodes].map((code) => code.toUpperCase()));
  const names = new Set([...input.existingFranchiseNames].map(normaliseFranchiseName));
  const seenCodes = new Set<string>();
  const seenNames = new Set<string>();
  const planned: PlannedFranchiseRow[] = [];
  for (const row of input.rows) {
    const base = { line: row.line, territoryCode: row.territoryCode, franchiseName: row.franchiseName, row };
    const reject = (outcome: FranchiseRowOutcome, reason: string): PlannedFranchiseRow => ({ ...base, outcome, reason });
    if (!row.territoryCode || !row.territoryName || !row.franchiseName) {
      planned.push(reject("reject_missing_field", "Territory code, territory name and franchise name are all required"));
      continue;
    }
    if (!territoryCodePattern.test(row.territoryCode)) {
      planned.push(reject("reject_invalid_code", "The territory code must be 2 to 15 letters, numbers or hyphens"));
      continue;
    }
    if (row.contactEmail && !emailPattern.test(row.contactEmail)) {
      planned.push(reject("reject_invalid_email", "The contact email is not a valid address (leave it blank if you do not have one)"));
      continue;
    }
    const launch = row.launchDate ? normaliseImportDate(row.launchDate) : null;
    const renewal = row.renewalDate ? normaliseImportDate(row.renewalDate) : null;
    if ((row.launchDate && !launch) || (row.renewalDate && !renewal)) {
      planned.push(reject("reject_invalid_date", "Dates must be yyyy-mm-dd or dd/mm/yyyy and be real dates"));
      continue;
    }
    if (launch && renewal && renewal <= launch) {
      planned.push(reject("reject_dates_out_of_order", "The renewal date must be after the launch date"));
      continue;
    }
    if (row.lifecycle && row.lifecycle !== "trading" && row.lifecycle !== "onboarding") {
      planned.push(reject("reject_invalid_stage", 'The stage must be "trading" or "onboarding" (or blank for trading)'));
      continue;
    }
    const nameKey = normaliseFranchiseName(row.franchiseName);
    if (seenCodes.has(row.territoryCode) || seenNames.has(nameKey)) {
      planned.push(reject("reject_duplicate_in_file", "This territory code or franchise name appears earlier in the file"));
      continue;
    }
    seenCodes.add(row.territoryCode);
    seenNames.add(nameKey);
    if (codes.has(row.territoryCode)) {
      planned.push(reject("reject_code_exists", "A territory with this code already exists, so nothing was added or changed"));
      continue;
    }
    if (names.has(nameKey)) {
      planned.push(reject("reject_franchise_exists", "A franchise with this name already exists, so nothing was added or changed"));
      continue;
    }
    planned.push({ ...base, outcome: "create", reason: "New franchise and territory", resolved: { launchDate: launch, renewalDate: renewal, lifecycle: row.lifecycle === "onboarding" ? "onboarding" : "trading" } });
  }
  const byOutcome: Partial<Record<FranchiseRowOutcome, number>> = {};
  for (const item of planned) byOutcome[item.outcome] = (byOutcome[item.outcome] ?? 0) + 1;
  const create = planned.filter((item) => item.outcome === "create").length;
  return { rows: planned, summary: { total: planned.length, create, rejected: planned.length - create, byOutcome } };
}

/** Every row that was not added, with the reason, as a CSV to fix and re-upload. */
export function buildFranchiseRejectReport(plan: FranchiseImportPlan): string {
  const lines = ["line,territory_code,franchise,outcome,reason"];
  for (const item of plan.rows.filter((row) => row.outcome !== "create")) lines.push([item.line, item.territoryCode, item.franchiseName, item.outcome, item.reason].map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}
