import { recordAuditEvent } from "@raring2go/audit";
import { advertiserCreditNotes, advertiserInvoices, createDb } from "@raring2go/db";
import { ACCOUNTING_MAX_ATTEMPTS, ACCOUNTING_PROVIDER_KEY, ACCOUNTING_PROVIDER_TYPE, applyAccountingSyncResult, loadAdvertisingData, persistAdvertisingChanges, snapshotAdvertisingData } from "@raring2go/advertising";
import type { AccountingProvider } from "@raring2go/finance";
import { defineJobHandler } from "@raring2go/workflows";
import type { JobHandler } from "@raring2go/workflows";
import { eq, sql as rawSql } from "drizzle-orm";
import { accountingProvider } from "./accounting-provider";

export const SYNC_ACCOUNTING_KIND = "finance.sync_accounting";
const BATCH = 20;
const LEASE_SECONDS = 300;

/** Cron ticks about every minute; one job per five-minute bucket is plenty. */
export const syncAccountingIdempotencyKey = (now: Date) => `${SYNC_ACCOUNTING_KIND}:${Math.floor(now.getTime() / 300_000)}`;

/** Wait 5 minutes after the first failure, doubling each time, to at most 6 hours. */
export const accountingBackoffMs = (attempts: number) => Math.min(5 * 60_000 * 2 ** Math.max(0, attempts - 1), 6 * 3_600_000);

type Claimed = { id: string; entity_type: string; entity_id: string };

/**
 * Pushes issued invoices and credit notes to the accounting system, in three steps so a crash can never
 * double-record or lose one:
 *  1. lease due references in one statement (skip-locked), committed, so parallel workers never take the same one;
 *  2. call the provider with no transaction open, using a stable idempotency key per document;
 *  3. record the answer. A worker that dies between 2 and 3 only leaves a lease that expires; the retry pushes
 *     the same key, which the provider dedupes.
 */
export function createSyncAccountingHandler(providerFor: () => AccountingProvider = accountingProvider): JobHandler {
  return defineJobHandler({
    kind: SYNC_ACCOUNTING_KIND,
    maxAttempts: 2,
    handle: async ({ now }) => {
      const { db, sql } = createDb();
      try {
        const nowIso = now().toISOString();
        const claimed = (await db.execute(rawSql`
          update advertiser_provider_sync_references
          set metadata = metadata || jsonb_build_object('leasedUntil', to_char(${nowIso}::timestamptz + make_interval(secs => ${LEASE_SECONDS}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), updated_at = now()
          where id in (
            select id from advertiser_provider_sync_references
            where provider_type = ${ACCOUNTING_PROVIDER_TYPE} and provider_key = ${ACCOUNTING_PROVIDER_KEY} and status = 'pending'
              and (metadata->>'nextAttemptAt' is null or (metadata->>'nextAttemptAt')::timestamptz <= ${nowIso}::timestamptz)
              and (metadata->>'leasedUntil' is null or (metadata->>'leasedUntil')::timestamptz <= ${nowIso}::timestamptz)
            order by created_at limit ${BATCH} for update skip locked
          )
          returning id, entity_type, entity_id
        `)) as unknown as Claimed[];

        const provider = providerFor();
        let synced = 0;
        let failed = 0;
        const today = now().toISOString().slice(0, 10);

        for (const item of claimed) {
          let outcome: { status: "synced"; providerEntityId: string } | { status: "failed"; error: string };
          try {
            const result = await push(db, provider, item);
            outcome = result.status === "synced" ? { status: "synced", providerEntityId: result.providerEntityId } : { status: "failed", error: "The accounting system has not accepted this yet." };
          } catch (error) {
            outcome = { status: "failed", error: error instanceof Error ? error.message : "Unknown error" };
          }

          await db.transaction(async (tx) => {
            const data = await loadAdvertisingData(tx);
            const before = snapshotAdvertisingData(data);
            const current = data.providerSyncReferences.find((reference) => reference.id === item.id);
            const attempts = Number(current?.metadata.attempts ?? 0) + 1;
            const reference = applyAccountingSyncResult(data, item.id, {
              ...(outcome.status === "synced" ? { status: "synced" as const, providerEntityId: outcome.providerEntityId } : { status: "failed" as const, error: outcome.error, nextAttemptAt: new Date(now().getTime() + accountingBackoffMs(attempts)).toISOString() }),
              today
            });
            await persistAdvertisingChanges(tx, before, data);
            await recordAuditEvent(tx, {
              action: "advertiser.accounting.sync",
              actor: { type: "automation", automationId: SYNC_ACCOUNTING_KIND },
              entity: { type: reference.entityType, id: reference.entityId },
              after: { status: reference.status, attempts, ...(outcome.status === "failed" ? { error: outcome.error } : {}) }
            });
          });
          if (outcome.status === "synced") synced += 1;
          else failed += 1;
        }
        return { claimed: claimed.length, synced, failed, maxAttempts: ACCOUNTING_MAX_ATTEMPTS };
      } finally {
        await sql.end();
      }
    }
  });
}

async function push(db: ReturnType<typeof createDb>["db"], provider: AccountingProvider, item: Claimed) {
  if (item.entity_type === "advertiser_invoice") {
    const [invoice] = await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, item.entity_id));
    if (!invoice || invoice.status === "draft") throw new Error("The invoice is not issued.");
    return provider.pushInvoice({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issuerOrganisationId: invoice.issuerOrganisationId,
      customerOrganisationId: invoice.customerOrganisationId,
      totalMinor: invoice.totalMinor,
      subtotalMinor: invoice.subtotalMinor,
      taxMinor: invoice.taxMinor,
      currency: invoice.currency,
      issueDate: invoice.issueDate?.toISOString().slice(0, 10),
      dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
      idempotencyKey: `invoice:${invoice.id}`
    });
  }
  const [credit] = await db.select().from(advertiserCreditNotes).where(eq(advertiserCreditNotes.id, item.entity_id));
  if (!credit) throw new Error("The credit note was not found.");
  return provider.pushCreditNote({
    id: credit.id,
    creditNoteNumber: credit.creditNoteNumber,
    sourceInvoiceId: credit.invoiceId,
    totalMinor: credit.totalMinor,
    currency: credit.currency,
    issuedDate: credit.issuedDate.toISOString().slice(0, 10),
    idempotencyKey: `credit:${credit.id}`
  });
}

