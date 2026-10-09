import { recordAuditEvent } from "@raring2go/audit";
import { advertiserCreditNoteLines, advertiserCreditNotes, advertiserInvoiceLines, advertiserInvoices, advertiserProviderSyncReferences, createDb, organisations } from "@raring2go/db";
import { ACCOUNTING_MAX_ATTEMPTS, ACCOUNTING_PROVIDER_KEY, ACCOUNTING_PROVIDER_TYPE, applyAccountingSyncResult, loadAdvertisingData, persistAdvertisingChanges, snapshotAdvertisingData } from "@raring2go/advertising";
import type { AccountingLine, AccountingProvider, AccountingProviderCreditNote, AccountingProviderInvoice } from "@raring2go/finance";
import { XeroAuthError, XeroTransientError } from "@raring2go/integrations";
import { defineJobHandler } from "@raring2go/workflows";
import type { JobHandler } from "@raring2go/workflows";
import { and, asc, eq, sql as rawSql } from "drizzle-orm";
import { accountingProvider } from "./accounting-provider";
import { xeroResolver } from "./xero-runtime";

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
export type AccountingTarget = { issuerOrganisationId: string; territoryId: string };
/** Which accounting system a document goes to. `null` means there is none connected for that franchise yet. */
export type AccountingResolver = (target: AccountingTarget) => Promise<AccountingProvider | null> | AccountingProvider | null;

type Outcome = { status: "synced"; providerEntityId: string } | { status: "failed"; error: string } | { status: "waiting"; error: string; retryAfterSeconds?: number };

/** What the provider told us, mapped to what should happen next. Auth and "not yet" problems wait; they are not failed attempts. */
function outcomeFromError(error: unknown): Outcome {
  if (error instanceof XeroAuthError && error.reconnectRequired) return { status: "waiting", error: "Xero needs to be reconnected for this franchise (Settings, Connections)." };
  if (error instanceof XeroTransientError && /not reached Xero yet/i.test(error.message)) return { status: "waiting", error: error.message, retryAfterSeconds: 600 };
  if (error instanceof XeroTransientError && error.retryAfterSeconds) return { status: "waiting", error: error.message, retryAfterSeconds: error.retryAfterSeconds };
  return { status: "failed", error: error instanceof Error ? error.message : "Unknown error" };
}

/**
 * Pushes issued invoices and credit notes to the accounting system, in three steps so a crash can never
 * double-record or lose one:
 *  1. lease due references in one statement (skip-locked), committed, so parallel workers never take the same one;
 *  2. call the provider with no transaction open, using a stable idempotency key per document;
 *  3. record the answer. A worker that dies between 2 and 3 only leaves a lease that expires; the retry pushes
 *     the same key, which the provider dedupes.
 */
export function createSyncAccountingHandler(resolve: AccountingResolver = defaultAccountingResolver): JobHandler {
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

        let synced = 0;
        let failed = 0;
        let waiting = 0;
        const today = now().toISOString().slice(0, 10);

        for (const item of claimed) {
          let outcome: Outcome;
          try {
            const document = await loadDocument(db, item);
            const provider = await resolve({ issuerOrganisationId: document.issuerOrganisationId, territoryId: document.territoryId });
            if (!provider) {
              outcome = { status: "waiting", error: "No accounting system is connected for this franchise yet (Settings, Connections).", retryAfterSeconds: 6 * 3600 };
            } else {
              const result = await push(provider, document);
              outcome = result.status === "synced" ? { status: "synced", providerEntityId: result.providerEntityId } : { status: "failed", error: "The accounting system has not accepted this yet." };
            }
          } catch (error) {
            outcome = outcomeFromError(error);
          }

          await db.transaction(async (tx) => {
            const data = await loadAdvertisingData(tx);
            const before = snapshotAdvertisingData(data);
            const current = data.providerSyncReferences.find((reference) => reference.id === item.id);
            const attempts = Number(current?.metadata.attempts ?? 0) + 1;
            const retryMs = outcome.status === "waiting" ? (outcome.retryAfterSeconds ?? 900) * 1000 : accountingBackoffMs(attempts);
            const reference = applyAccountingSyncResult(data, item.id, {
              ...(outcome.status === "synced" ? { status: "synced" as const, providerEntityId: outcome.providerEntityId } : { status: outcome.status, error: outcome.error, nextAttemptAt: new Date(now().getTime() + retryMs).toISOString() }),
              today
            });
            await persistAdvertisingChanges(tx, before, data);
            await recordAuditEvent(tx, {
              action: "advertiser.accounting.sync",
              actor: { type: "automation", automationId: SYNC_ACCOUNTING_KIND },
              entity: { type: reference.entityType, id: reference.entityId },
              after: { status: reference.status, attempts: Number(reference.metadata.attempts ?? 0), ...(outcome.status !== "synced" ? { [outcome.status === "waiting" ? "waitingFor" : "error"]: outcome.error } : {}) }
            });
          });
          if (outcome.status === "synced") synced += 1;
          else if (outcome.status === "waiting") waiting += 1;
          else failed += 1;
        }
        return { claimed: claimed.length, synced, failed, waiting, maxAttempts: ACCOUNTING_MAX_ATTEMPTS };
      } finally {
        await sql.end();
      }
    }
  });
}

type Db = ReturnType<typeof createDb>["db"];

type Document =
  | { kind: "invoice"; issuerOrganisationId: string; territoryId: string; invoice: AccountingProviderInvoice }
  | { kind: "credit"; issuerOrganisationId: string; territoryId: string; credit: AccountingProviderCreditNote };

const toLines = (lines: Array<{ description: string; quantity?: number; netMinor: number; taxMinor: number; taxCode: string }>): AccountingLine[] =>
  lines.map((line) => ({ description: line.description, quantity: line.quantity ?? 1, netMinor: line.netMinor, taxMinor: line.taxMinor, taxCode: line.taxCode }));

const dateOf = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString().slice(0, 10) : undefined);

async function customerOf(db: Db, invoice: { billingSnapshot: unknown; customerOrganisationId: string }) {
  const snapshot = (invoice.billingSnapshot ?? {}) as { name?: string | null; email?: string | null };
  if (snapshot.name) return { name: snapshot.name, email: snapshot.email ?? null };
  const [organisation] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, invoice.customerOrganisationId));
  return { name: organisation?.name ?? "Customer", email: snapshot.email ?? null };
}

async function loadDocument(db: Db, item: Claimed): Promise<Document> {
  if (item.entity_type === "advertiser_invoice") {
    const [invoice] = await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, item.entity_id));
    if (!invoice || invoice.status === "draft") throw new Error("The invoice is not issued.");
    const lines = await db.select().from(advertiserInvoiceLines).where(eq(advertiserInvoiceLines.invoiceId, invoice.id)).orderBy(asc(advertiserInvoiceLines.id));
    return {
      kind: "invoice",
      issuerOrganisationId: invoice.issuerOrganisationId,
      territoryId: invoice.territoryId,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issuerOrganisationId: invoice.issuerOrganisationId,
        customerOrganisationId: invoice.customerOrganisationId,
        totalMinor: invoice.totalMinor,
        subtotalMinor: invoice.subtotalMinor,
        taxMinor: invoice.taxMinor,
        currency: invoice.currency,
        issueDate: dateOf(invoice.issueDate),
        dueDate: dateOf(invoice.dueDate) ?? null,
        idempotencyKey: `invoice:${invoice.id}`,
        customer: await customerOf(db, invoice),
        lines: toLines(lines)
      }
    };
  }
  const [credit] = await db.select().from(advertiserCreditNotes).where(eq(advertiserCreditNotes.id, item.entity_id));
  if (!credit) throw new Error("The credit note was not found.");
  const [invoice] = await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, credit.invoiceId));
  if (!invoice) throw new Error("The invoice this credit note applies to was not found.");
  const lines = await db.select().from(advertiserCreditNoteLines).where(eq(advertiserCreditNoteLines.creditNoteId, credit.id)).orderBy(asc(advertiserCreditNoteLines.id));
  const [invoiceRef] = await db
    .select({ providerEntityId: advertiserProviderSyncReferences.providerEntityId, status: advertiserProviderSyncReferences.status })
    .from(advertiserProviderSyncReferences)
    .where(and(eq(advertiserProviderSyncReferences.providerType, ACCOUNTING_PROVIDER_TYPE), eq(advertiserProviderSyncReferences.entityType, "advertiser_invoice"), eq(advertiserProviderSyncReferences.entityId, invoice.id)));
  return {
    kind: "credit",
    issuerOrganisationId: credit.issuerOrganisationId,
    territoryId: invoice.territoryId,
    credit: {
      id: credit.id,
      creditNoteNumber: credit.creditNoteNumber,
      sourceInvoiceId: credit.invoiceId,
      sourceInvoiceNumber: invoice.invoiceNumber,
      sourceInvoiceProviderId: invoiceRef?.status === "synced" ? invoiceRef.providerEntityId : null,
      customerOrganisationId: invoice.customerOrganisationId,
      customer: await customerOf(db, invoice),
      totalMinor: credit.totalMinor,
      currency: credit.currency,
      issuedDate: dateOf(credit.issuedDate),
      idempotencyKey: `credit:${credit.id}`,
      lines: toLines(lines)
    }
  };
}

function push(provider: AccountingProvider, document: Document) {
  return document.kind === "invoice" ? provider.pushInvoice(document.invoice) : provider.pushCreditNote(document.credit);
}

/** Xero where a franchise has connected it; otherwise the development provider locally, and nothing (waiting) in production. */
const defaultAccountingResolver: AccountingResolver = async (target) => (await xeroResolver(target)) ?? (process.env.NODE_ENV !== "production" ? accountingProvider() : null);
