import { sql } from "drizzle-orm";

/** The tables whose rows the database refuses to change or delete (migrations 0049, 0050 and 0057). */
const GUARDED = ["advertiser_invoices", "advertiser_invoice_lines", "advertiser_credit_notes", "advertiser_credit_note_lines", "advertiser_payment_allocations", "advertiser_proposal_acceptances", "audit_events", "public_homepage_templates"];

type Executor = { execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown> };

/**
 * Tests that create real issued invoices, payments or acceptances must remove them afterwards, which the
 * immutability triggers rightly forbid. This turns those triggers off for the duration of the cleanup only
 * (needs table ownership, so it works on a developer or CI database, never as an application path) and always
 * turns them back on. Never import this from application code.
 */
export async function withFinanceGuardsDisabled<T>(db: Executor, work: () => Promise<T>): Promise<T> {
  for (const table of GUARDED) await db.execute(sql.raw(`ALTER TABLE ${table} DISABLE TRIGGER USER`));
  try {
    return await work();
  } finally {
    for (const table of GUARDED) await db.execute(sql.raw(`ALTER TABLE ${table} ENABLE TRIGGER USER`));
  }
}
