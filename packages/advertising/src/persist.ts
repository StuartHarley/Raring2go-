import {
  advertiserActivityEvents,
  advertiserContacts,
  advertiserCreditNoteLines,
  advertiserCreditNotes,
  advertiserDomainEvents,
  advertiserInvoiceLines,
  advertiserInvoiceSequences,
  advertiserInvoices,
  advertiserMetricSnapshots,
  advertiserPaymentAllocations,
  advertiserPayments,
  advertiserProposalAcceptances,
  advertiserProviderSyncReferences,
  advertiserTerms,
  advertisers,
  artworkRequirements,
  artworkVersions,
  campaignFulfilments,
  commercialBookingItems,
  commercialBookings,
  commercialPackages,
  commercialProducts,
  commercialProductionRequests,
  commercialProposalItems,
  commercialProposals,
  inventoryReservations,
  inventorySlots,
  opportunities,
  pipelineStages,
  priceBookItems,
  priceBooks,
  proofPacks,
  renewalPrompts,
  advertiserTasks,
  advertiserTaxRates
} from "@raring2go/db";
import { eq, getTableColumns } from "drizzle-orm";
import type { Column } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { AdvertisingData } from "./types";

type CollectionKey = Exclude<keyof AdvertisingData, "organisations" | "territories">;

/** Parents before children, so inserts satisfy foreign keys in this order. */
export const persistedCollections: Array<[CollectionKey, PgTable]> = [
  ["advertisers", advertisers],
  ["contacts", advertiserContacts],
  ["activityEvents", advertiserActivityEvents],
  ["metricSnapshots", advertiserMetricSnapshots],
  ["pipelineStages", pipelineStages],
  ["opportunities", opportunities],
  ["products", commercialProducts],
  ["packages", commercialPackages],
  ["priceBooks", priceBooks],
  ["priceBookItems", priceBookItems],
  ["inventorySlots", inventorySlots],
  ["proposals", commercialProposals],
  ["proposalItems", commercialProposalItems],
  ["inventoryReservations", inventoryReservations],
  ["bookings", commercialBookings],
  ["bookingItems", commercialBookingItems],
  ["productionRequests", commercialProductionRequests],
  ["terms", advertiserTerms],
  ["acceptances", advertiserProposalAcceptances],
  ["domainEvents", advertiserDomainEvents],
  ["invoiceSequences", advertiserInvoiceSequences],
  ["invoices", advertiserInvoices],
  ["invoiceLines", advertiserInvoiceLines],
  ["creditNotes", advertiserCreditNotes],
  ["creditNoteLines", advertiserCreditNoteLines],
  ["payments", advertiserPayments],
  ["paymentAllocations", advertiserPaymentAllocations],
  ["providerSyncReferences", advertiserProviderSyncReferences],
  ["artworkRequirements", artworkRequirements],
  ["artworkVersions", artworkVersions],
  ["campaignFulfilments", campaignFulfilments],
  ["proofPacks", proofPacks],
  ["renewalPrompts", renewalPrompts],
  ["tasks", advertiserTasks],
  ["taxRates", advertiserTaxRates]
];

/** Bookkeeping columns the database owns: never diffed, never written from domain objects. */
const MANAGED = new Set(["createdAt", "updatedAt"]);

type Row = Record<string, unknown>;

/** Domain objects use ISO date strings; date/timestamp columns want Dates. Convert by column type, not by guess. */
export function toDbRow(table: PgTable, row: Row): Row {
  const out: Row = {};
  for (const [prop, column] of Object.entries(getTableColumns(table))) {
    if (MANAGED.has(prop) || !(prop in row) || row[prop] === undefined) continue;
    const value = row[prop];
    const type = (column as { columnType: string }).columnType;
    out[prop] = typeof value === "string" && (type === "PgDate" || type === "PgTimestamp") ? new Date(value) : value;
  }
  return out;
}

const comparable = (value: unknown) => JSON.stringify(value instanceof Date ? value.toISOString() : value);

export type PlannedChange = {
  collection: CollectionKey;
  table: PgTable;
  inserts: Row[];
  updates: Array<{ id: string; changes: Row }>;
};

/**
 * Compares data as loaded (`before`, a deep copy taken before the domain call) with the
 * same data after a domain function mutated it, and plans the minimal writes: new rows are
 * inserted, and only the columns that actually changed are updated, so unrelated concurrent
 * edits to the same row are not clobbered. Rows vanishing is a bug (the domain soft-deletes),
 * so it throws instead of silently diverging.
 */
export function planAdvertisingChanges(before: AdvertisingData, after: AdvertisingData): PlannedChange[] {
  const plan: PlannedChange[] = [];

  for (const [collection, table] of persistedCollections) {
    const previous = new Map((before[collection] as unknown as Row[]).map((row) => [String(row.id), row]));
    const current = after[collection] as unknown as Row[];
    const change: PlannedChange = { collection, table, inserts: [], updates: [] };

    for (const row of current) {
      const id = String(row.id);
      const earlier = previous.get(id);
      previous.delete(id);

      if (!earlier) {
        change.inserts.push(toDbRow(table, row));
        continue;
      }

      const now = toDbRow(table, row);
      const was = toDbRow(table, earlier);
      const changes: Row = {};
      for (const [key, value] of Object.entries(now)) {
        if (key !== "id" && comparable(value) !== comparable(was[key])) changes[key] = value;
      }
      if (Object.keys(changes).length > 0) change.updates.push({ id, changes });
    }

    if (previous.size > 0) {
      throw new Error(`Advertising ${collection} rows were removed by a domain function (${[...previous.keys()].join(", ")}); records are soft-deleted, never removed.`);
    }
    if (change.inserts.length > 0 || change.updates.length > 0) plan.push(change);
  }

  return plan;
}

type WriteDb = {
  insert(table: unknown): { values(values: unknown): PromiseLike<unknown> };
  update(table: unknown): { set(values: unknown): { where(condition: unknown): { returning(): Promise<unknown[]> } } };
};

/** A deep copy to diff against later. Call before invoking a domain function. */
export function snapshotAdvertisingData(data: AdvertisingData): AdvertisingData {
  return structuredClone(data);
}

export async function persistAdvertisingChanges(db: WriteDb, before: AdvertisingData, after: AdvertisingData, now: Date = new Date()) {
  const plan = planAdvertisingChanges(before, after);
  let inserted = 0;
  let updated = 0;

  for (const change of plan) {
    for (const row of change.inserts) {
      await db.insert(change.table).values(row);
      inserted += 1;
    }
    const columns = getTableColumns(change.table) as Record<string, Column>;
    const idColumn = columns.id!;
    const hasUpdatedAt = "updatedAt" in columns;
    for (const update of change.updates) {
      const result = await db
        .update(change.table)
        .set({ ...update.changes, ...(hasUpdatedAt ? { updatedAt: now } : {}) })
        .where(eq(idColumn, update.id))
        .returning();
      if (result.length === 0) throw new Error(`Advertising ${change.collection} row ${update.id} no longer exists.`);
      updated += 1;
    }
  }

  return { inserted, updated };
}
