import { contentDomainEvents, socialAccounts, socialProviderEvents, socialPublications, socialPublishJobs } from "@raring2go/db";
import { eq, getTableColumns } from "drizzle-orm";
import type { Column } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { PublishingData } from "./types";

type CollectionKey = "socialAccounts" | "socialPublications" | "socialPublishJobs" | "socialProviderEvents" | "contentDomainEvents";

/** Parents before children, so inserts satisfy foreign keys in this order. */
export const socialCollections: Array<[CollectionKey, PgTable]> = [
  ["socialAccounts", socialAccounts],
  ["socialPublications", socialPublications],
  ["socialPublishJobs", socialPublishJobs],
  ["socialProviderEvents", socialProviderEvents],
  ["contentDomainEvents", contentDomainEvents]
];

const MANAGED = new Set(["createdAt", "updatedAt"]);
type Row = Record<string, unknown>;

/** Domain objects use ISO strings; date and timestamp columns want Dates. Converted by column type. */
export function toSocialDbRow(table: PgTable, row: Row): Row {
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

export type SocialPlannedChange = { collection: CollectionKey; table: PgTable; inserts: Row[]; updates: Array<{ id: string; changes: Row }> };

/** Minimal writes between the data as loaded and as a domain function left it. Vanishing rows are a bug, so they throw. */
export function planSocialChanges(before: PublishingData, after: PublishingData): SocialPlannedChange[] {
  const plan: SocialPlannedChange[] = [];
  for (const [collection, table] of socialCollections) {
    const previous = new Map((before[collection] as unknown as Row[]).map((row) => [String(row.id), row]));
    const change: SocialPlannedChange = { collection, table, inserts: [], updates: [] };

    for (const row of after[collection] as unknown as Row[]) {
      const id = String(row.id);
      const earlier = previous.get(id);
      previous.delete(id);
      if (!earlier) {
        change.inserts.push(toSocialDbRow(table, row));
        continue;
      }
      const now = toSocialDbRow(table, row);
      const was = toSocialDbRow(table, earlier);
      const changes: Row = {};
      for (const [key, value] of Object.entries(now)) {
        if (key !== "id" && comparable(value) !== comparable(was[key])) changes[key] = value;
      }
      if (Object.keys(changes).length > 0) change.updates.push({ id, changes });
    }

    if (previous.size > 0) throw new Error(`Social ${collection} rows were removed by a domain function (${[...previous.keys()].join(", ")}).`);
    if (change.inserts.length > 0 || change.updates.length > 0) plan.push(change);
  }
  return plan;
}

type WriteDb = {
  insert(table: unknown): { values(values: unknown): PromiseLike<unknown> };
  update(table: unknown): { set(values: unknown): { where(condition: unknown): { returning(): Promise<unknown[]> } } };
};

export function snapshotPublishingData(data: PublishingData): PublishingData {
  return structuredClone(data);
}

export async function persistSocialChanges(db: WriteDb, before: PublishingData, after: PublishingData, now: Date = new Date()) {
  let inserted = 0;
  let updated = 0;
  for (const change of planSocialChanges(before, after)) {
    for (const row of change.inserts) {
      await db.insert(change.table).values(row);
      inserted += 1;
    }
    const columns = getTableColumns(change.table) as Record<string, Column>;
    const idColumn = columns.id!;
    const hasUpdatedAt = "updatedAt" in columns;
    for (const update of change.updates) {
      const result = await db.update(change.table).set({ ...update.changes, ...(hasUpdatedAt ? { updatedAt: now } : {}) }).where(eq(idColumn, update.id)).returning();
      if (result.length === 0) throw new Error(`Social ${change.collection} row ${update.id} no longer exists.`);
      updated += 1;
    }
  }
  return { inserted, updated };
}
