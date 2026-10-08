import { randomUUID } from "node:crypto";
import { createDb, eventSuggestions, fixtureIds } from "@raring2go/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDrizzleEventSuggestionStore } from "./events-store";
import type { NewEventSuggestion } from "./events";

/** Real SQL for the suggestion queue. `RUN_DB_TESTS=1 pnpm --filter @raring2go/publishing test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("drizzle event suggestion store (postgres)", () => {
  const { db, sql } = createDb();
  const store = createDrizzleEventSuggestionStore(db as never);
  const tag = randomUUID().slice(0, 8);
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created) await db.delete(eventSuggestions).where(eq(eventSuggestions.id, id));
    await sql.end();
  });

  const row = (key: string, overrides: Partial<NewEventSuggestion> = {}): NewEventSuggestion => ({
    territoryId: fixtureIds.territories.suttonColdfield, aiRunId: null, title: `Event ${key}`, startsAt: new Date("2030-03-10T10:00:00Z"), endsAt: null, venue: "Hall",
    summary: "s", sourceUrl: `https://e.example.org/${tag}/${key}`, sourceContext: "context text here", dedupeKey: `${tag}-${key}`, ...overrides
  });

  it("inserts new rows as pending and silently skips an existing (territory, dedupeKey)", async () => {
    const first = await store.insertMany([row("a"), row("b")], new Date());
    created.push(...first.map((entry) => entry.id));
    expect(first).toHaveLength(2);
    expect(first.every((entry) => entry.status === "pending")).toBe(true);

    const again = await store.insertMany([row("a"), row("c")], new Date());
    created.push(...again.map((entry) => entry.id));
    expect(again.map((entry) => entry.dedupeKey)).toEqual([`${tag}-c`]);

    // The same key in another territory is a different event.
    const other = await store.insertMany([row("a", { territoryId: fixtureIds.territories.solihull })], new Date());
    created.push(...other.map((entry) => entry.id));
    expect(other).toHaveLength(1);
  });

  it("lists by territory and status, and decides a pending suggestion exactly once", async () => {
    const [target] = await store.insertMany([row("d")], new Date());
    created.push(target!.id);
    expect((await store.list({ territoryId: fixtureIds.territories.suttonColdfield, status: "pending", limit: 500 })).some((entry) => entry.id === target!.id)).toBe(true);
    expect((await store.list({ territoryId: fixtureIds.territories.solihull, limit: 500 })).some((entry) => entry.id === target!.id)).toBe(false);

    const approved = await store.decide(target!.id, { status: "approved", userId: fixtureIds.users.superAdmin, note: "ok" }, new Date());
    expect(approved).toMatchObject({ status: "approved", decidedByUserId: fixtureIds.users.superAdmin, decisionNote: "ok" });
    expect(await store.decide(target!.id, { status: "rejected", userId: fixtureIds.users.superAdmin, note: null }, new Date())).toBeUndefined();
    expect((await store.get(target!.id))!.status).toBe("approved");
  });
});
