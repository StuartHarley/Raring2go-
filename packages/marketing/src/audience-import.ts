import { normaliseEmail } from "./service";
import type { MarketingData } from "./types";

/**
 * Audience import: parse a CSV, decide what each row would do, and (elsewhere) apply it.
 *
 * Consent is never assumed. A row only becomes a subscriber if it carries evidence: a consent date and a
 * consent source, both valid, and the import was declared as `consent_evidenced`. Everything else is imported as
 * `pending_consent`: the person is on file, visible to staff and traceable to the import, but is not eligible
 * for any send until they confirm themselves. Suppressed and previously-unsubscribed people are never revived.
 * There is deliberately no third basis (such as "legitimate interest"): that is a legal decision this code does
 * not make for you.
 */

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
/** Consent evidence older than this is treated as stale: the person is imported but must confirm again. */
export const CONSENT_MAX_AGE_MONTHS = 24;

export type ImportConsentBasis = "consent_evidenced" | "no_consent_record";

export type ParsedImportRow = {
  line: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  consentDate: string | null;
  consentSource: string | null;
  tags: string[];
};

export type CsvParseResult = {
  rows: ParsedImportRow[];
  headers: { email: string; mapped: string[]; ignored: string[] };
  /** File-level problems that stop the import (no email column, too many rows). */
  fatal?: string;
};

const headerAliases: Record<string, string[]> = {
  email: ["email", "e-mail", "email address", "emailaddress", "e mail"],
  firstName: ["first_name", "firstname", "first name", "given name", "fname"],
  lastName: ["last_name", "lastname", "last name", "surname", "family name", "lname"],
  consentDate: ["consent_date", "consented_at", "consent date", "opt_in_date", "optin_time", "opt-in date", "optin date", "subscribed_at"],
  consentSource: ["consent_source", "optin_source", "opt_in_source", "consent source", "signup source", "source"],
  tags: ["tags", "tag", "labels"]
};

/** Minimal RFC 4180 parsing: quoted fields, escaped quotes, commas and newlines inside quotes, CRLF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      record.push(field);
      field = "";
      if (record.some((cell) => cell.trim() !== "")) records.push(record);
      record = [];
    } else field += char;
  }
  record.push(field);
  if (record.some((cell) => cell.trim() !== "")) records.push(record);
  return records;
}

const clean = (value: string | undefined, max: number) => {
  // Control characters and zero-width characters have no place in a name or a source.
  const text = (value ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  return text === "" ? null : text.slice(0, max);
};

export function parseAudienceCsv(text: string): CsvParseResult {
  const records = parseCsv(text);
  if (records.length === 0) return { rows: [], headers: { email: "", mapped: [], ignored: [] }, fatal: "The file is empty." };

  const header = records[0]!.map((cell) => cell.trim().toLowerCase());
  const indexOf = (key: string) => header.findIndex((cell) => headerAliases[key]!.includes(cell));
  const columns = Object.fromEntries(Object.keys(headerAliases).map((key) => [key, indexOf(key)])) as Record<string, number>;
  const mappedIndexes = new Set(Object.values(columns).filter((index) => index >= 0));
  const headers = {
    email: columns.email! >= 0 ? header[columns.email!]! : "",
    mapped: Object.entries(columns).filter(([, index]) => index >= 0).map(([key]) => key),
    ignored: header.filter((_, index) => !mappedIndexes.has(index) && header[index] !== "")
  };
  if (columns.email! < 0) return { rows: [], headers, fatal: "There is no email column. Name it email, e-mail or email address." };
  if (records.length - 1 > IMPORT_MAX_ROWS) return { rows: [], headers, fatal: `This file has ${records.length - 1} rows. The limit is ${IMPORT_MAX_ROWS} per import: split it and import in parts.` };

  const rows: ParsedImportRow[] = records.slice(1).map((record, offset) => ({
    line: offset + 2,
    email: (record[columns.email!] ?? "").trim(),
    firstName: columns.firstName! >= 0 ? clean(record[columns.firstName!], 100) : null,
    lastName: columns.lastName! >= 0 ? clean(record[columns.lastName!], 100) : null,
    consentDate: columns.consentDate! >= 0 ? clean(record[columns.consentDate!], 40) : null,
    consentSource: columns.consentSource! >= 0 ? clean(record[columns.consentSource!], 200) : null,
    tags: columns.tags! >= 0
      ? [...new Set((record[columns.tags!] ?? "").split(/[;,|]/).map((tag) => clean(tag, 40)?.toLowerCase()).filter((tag): tag is string => Boolean(tag)))].slice(0, 10)
      : []
  }));
  return { rows, headers };
}

export type ImportRowOutcome =
  | "create_subscribed"
  | "create_pending"
  | "add_subscription"
  | "add_pending"
  | "skip_already_subscribed"
  | "skip_existing_no_evidence"
  | "reject_invalid_email"
  | "reject_duplicate_in_file"
  | "reject_suppressed"
  | "reject_previously_unsubscribed";

export type PlannedImportRow = {
  line: number;
  email: string;
  outcome: ImportRowOutcome;
  /** Plain-language reason shown in the report. */
  reason: string;
  row: ParsedImportRow;
  existingContactId?: string;
  /** Present when the row carries valid, current consent evidence. */
  consent?: { date: string; source: string };
};

export type ImportPlan = {
  rows: PlannedImportRow[];
  summary: {
    total: number;
    newSubscribed: number;
    newPending: number;
    addedToTerritory: number;
    alreadySubscribed: number;
    rejected: number;
    byOutcome: Partial<Record<ImportRowOutcome, number>>;
  };
};

const emailPattern = /^[^\s@,;<>()[\]\\"]{1,64}@[^\s@,;<>()[\]\\"]{1,255}\.[a-z]{2,}$/i;

/** A valid, real, recent consent date, or the reason it is not usable. */
export function assessConsentEvidence(row: Pick<ParsedImportRow, "consentDate" | "consentSource">, today: string): { ok: true; date: string; source: string } | { ok: false; reason: string } {
  if (!row.consentDate && !row.consentSource) return { ok: false, reason: "No consent date or source in the file" };
  if (!row.consentSource) return { ok: false, reason: "Consent date given but no source" };
  if (!row.consentDate) return { ok: false, reason: "Consent source given but no date" };

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.consentDate) ?? /^(\d{2})\/(\d{2})\/(\d{4})/.exec(row.consentDate);
  if (!match) return { ok: false, reason: "Consent date is not a date we can read (use YYYY-MM-DD)" };
  const iso = match[1]!.length === 4 ? `${match[1]}-${match[2]}-${match[3]}` : `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return { ok: false, reason: "Consent date is not a real date" };
  if (iso > today) return { ok: false, reason: "Consent date is in the future" };

  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - CONSENT_MAX_AGE_MONTHS);
  if (parsed < cutoff) return { ok: false, reason: `Consent is more than ${CONSENT_MAX_AGE_MONTHS} months old, so the person must confirm again` };
  return { ok: true, date: iso, source: row.consentSource };
}

/**
 * Decides what every row would do, without changing anything. Used for the dry run and again at the moment of
 * commit against fresh data, so a suppression or unsubscribe that happened in between is respected.
 */
export function planAudienceImport(data: MarketingData, input: { territoryId: string; basis: ImportConsentBasis; rows: ParsedImportRow[]; today: string }): ImportPlan {
  const byEmail = new Map(data.contacts.filter((contact) => !contact.deletedAt).map((contact) => [contact.emailNormalised, contact]));
  const seen = new Set<string>();
  const planned: PlannedImportRow[] = [];

  for (const row of input.rows) {
    const email = normaliseEmail(row.email);
    const base = { line: row.line, email: row.email, row };
    const reject = (outcome: ImportRowOutcome, reason: string, existingContactId?: string): PlannedImportRow => ({ ...base, outcome, reason, existingContactId });

    if (!emailPattern.test(email) || email.length > 254) {
      planned.push(reject("reject_invalid_email", "Not a valid email address"));
      continue;
    }
    if (seen.has(email)) {
      planned.push(reject("reject_duplicate_in_file", "This address appears earlier in the file"));
      continue;
    }
    seen.add(email);

    const evidence = input.basis === "consent_evidenced" ? assessConsentEvidence(row, input.today) : ({ ok: false, reason: "Imported as a list with no consent record" } as const);
    const consent = evidence.ok ? { date: evidence.date, source: evidence.source } : undefined;
    const existing = byEmail.get(email);

    if (!existing) {
      planned.push(consent
        ? { ...base, outcome: "create_subscribed", reason: "New contact with consent evidence", consent }
        : { ...base, outcome: "create_pending", reason: `New contact, not emailed until they confirm: ${evidence.ok ? "" : evidence.reason}` });
      continue;
    }

    const suppressed = existing.emailStatus === "suppressed" || data.suppressions.some((suppression) => suppression.contactId === existing.id && suppression.active);
    if (suppressed) {
      planned.push(reject("reject_suppressed", "This person is suppressed (unsubscribed, bounced or complained) and cannot be re-added", existing.id));
      continue;
    }

    // A subscription withdrawn by an import rollback does not count: a corrected file can bring the person in again.
    const subscription = data.subscriptions.find((candidate) => candidate.contactId === existing.id && candidate.territoryId === input.territoryId && !candidate.deletedAt && candidate.status !== "import_rolled_back");
    if (subscription?.status === "subscribed") {
      planned.push({ ...base, outcome: "skip_already_subscribed", reason: "Already subscribed in this territory", existingContactId: existing.id });
    } else if (subscription?.status === "unsubscribed") {
      planned.push(reject("reject_previously_unsubscribed", "They unsubscribed from this territory and cannot be re-added by import", existing.id));
    } else if (subscription?.status === "pending_consent" && !consent) {
      planned.push({ ...base, outcome: "skip_existing_no_evidence", reason: "Already on file, waiting for them to confirm", existingContactId: existing.id });
    } else if (consent) {
      planned.push({ ...base, outcome: "add_subscription", reason: "Existing contact, now subscribed here with consent evidence", existingContactId: existing.id, consent });
    } else {
      planned.push({ ...base, outcome: "add_pending", reason: "Existing contact added to this territory, not emailed until they confirm", existingContactId: existing.id });
    }
  }

  const count = (...outcomes: ImportRowOutcome[]) => planned.filter((item) => outcomes.includes(item.outcome)).length;
  const byOutcome: Partial<Record<ImportRowOutcome, number>> = {};
  for (const item of planned) byOutcome[item.outcome] = (byOutcome[item.outcome] ?? 0) + 1;
  return {
    rows: planned,
    summary: {
      total: planned.length,
      newSubscribed: count("create_subscribed"),
      newPending: count("create_pending"),
      addedToTerritory: count("add_subscription", "add_pending"),
      alreadySubscribed: count("skip_already_subscribed", "skip_existing_no_evidence"),
      rejected: count("reject_invalid_email", "reject_duplicate_in_file", "reject_suppressed", "reject_previously_unsubscribed"),
      byOutcome
    }
  };
}

/** A spreadsheet treats a cell starting with = + - @ as a formula, so anything we echo back is defused before download. */
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Every row that was not imported as asked, with the reason, as a CSV staff can fix and re-upload. */
export function buildRejectReport(plan: ImportPlan): string {
  const lines = ["line,email,outcome,reason"];
  for (const item of plan.rows.filter((row) => row.outcome.startsWith("reject_") || row.outcome === "create_pending" || row.outcome === "add_pending")) {
    lines.push([item.line, item.email, item.outcome, item.reason].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
