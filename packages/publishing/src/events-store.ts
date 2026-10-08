import { randomUUID } from "node:crypto";
import { eventSuggestions } from "@raring2go/db";
import { and, desc, eq } from "drizzle-orm";
import type { EventSuggestionRecord, EventSuggestionStatus, EventSuggestionStore } from "./events";

export function createInMemoryEventSuggestionStore(): EventSuggestionStore & { rows: Map<string, EventSuggestionRecord> } {
  const rows = new Map<string, EventSuggestionRecord>();

  return {
    rows,
    async insertMany(input, now) {
      const created: EventSuggestionRecord[] = [];
      for (const row of input) {
        // Mirrors the unique (territory, dedupeKey) index.
        if ([...rows.values()].some((existing) => existing.territoryId === row.territoryId && existing.dedupeKey === row.dedupeKey)) continue;
        const record: EventSuggestionRecord = { ...row, id: randomUUID(), status: "pending", contentItemId: null, decidedByUserId: null, decidedAt: null, decisionNote: null, createdAt: now };
        rows.set(record.id, record);
        created.push(record);
      }
      return created;
    },
    async get(id) {
      return rows.get(id);
    },
    async list(filter) {
      return [...rows.values()]
        .filter((row) => !filter.territoryId || row.territoryId === filter.territoryId)
        .filter((row) => !filter.status || row.status === filter.status)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .slice(0, filter.limit ?? 100);
    },
    async decide(id, decision, now) {
      const existing = rows.get(id);
      if (!existing || existing.status !== "pending") return undefined;
      const next: EventSuggestionRecord = { ...existing, status: decision.status, decidedByUserId: decision.userId, decidedAt: now, decisionNote: decision.note, contentItemId: decision.contentItemId ?? null };
      rows.set(id, next);
      return next;
    }
  };
}

type Db = {
  insert(table: unknown): { values(values: unknown): { onConflictDoNothing(): { returning(): Promise<unknown[]> } } };
  select(): { from(table: unknown): { where(condition: unknown): { orderBy(...order: unknown[]): { limit(count: number): Promise<unknown[]> } } } };
  update(table: unknown): { set(values: unknown): { where(condition: unknown): { returning(): Promise<unknown[]> } } };
};

const toRecord = (row: unknown) => row as EventSuggestionRecord;

export function createDrizzleEventSuggestionStore(db: Db): EventSuggestionStore {
  return {
    async insertMany(input, now) {
      if (input.length === 0) return [];
      const rows = await db
        .insert(eventSuggestions)
        .values(input.map((row) => ({ ...row, createdAt: now, updatedAt: now })))
        .onConflictDoNothing()
        .returning();
      return rows.map(toRecord);
    },
    async get(id) {
      const [row] = await db.select().from(eventSuggestions).where(eq(eventSuggestions.id, id)).orderBy(desc(eventSuggestions.createdAt)).limit(1);
      return row ? toRecord(row) : undefined;
    },
    async list(filter) {
      const conditions = [];
      if (filter.territoryId) conditions.push(eq(eventSuggestions.territoryId, filter.territoryId));
      if (filter.status) conditions.push(eq(eventSuggestions.status, filter.status as EventSuggestionStatus));
      const rows = await db
        .select()
        .from(eventSuggestions)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(eventSuggestions.startsAt))
        .limit(Math.min(filter.limit ?? 100, 500));
      return rows.map(toRecord);
    },
    async decide(id, decision, now) {
      const [row] = await db
        .update(eventSuggestions)
        .set({ status: decision.status, decidedByUserId: decision.userId, decidedAt: now, decisionNote: decision.note, contentItemId: decision.contentItemId ?? null, updatedAt: now })
        .where(and(eq(eventSuggestions.id, id), eq(eventSuggestions.status, "pending")))
        .returning();
      return row ? toRecord(row) : undefined;
    }
  };
}
