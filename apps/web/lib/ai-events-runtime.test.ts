import { aiRuns, contentDomainEvents, contentItemVersions, contentItems, createDb, eventSuggestions, fixtureIds } from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveEventSuggestionAsActor, discoverEvents, readEventSuggestions, rejectEventSuggestionAsActor } from "./publishing-runtime";

const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
const SUTTON = fixtureIds.territories.suttonColdfield;
const SOLIHULL = fixtureIds.territories.solihull;
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

describe("AI event discovery end to end (postgres)", () => {
  const touchedItems: string[] = [];

  beforeAll(async () => {
    process.env.AI_PROVIDER = "deterministic";
    process.env.AI_SPEND_CAP_NETWORK_MINOR = "100000000";
    process.env.AI_SPEND_CAP_TERRITORY_MINOR = "100000000";
    process.env.AI_ASSIST_RATE_LIMIT = "1000";
    await clean();
  });

  afterAll(async () => {
    await clean();
  });

  async function clean() {
    const { db, sql } = createDb();
    const items = await db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.sourceReference, "https://events.example.test/x"));
    const sampleItems = (await db.select().from(contentItems).where(eq(contentItems.sourceType, "ai"))).filter((item) => String(item.sourceReference).includes("events.example.test"));
    const ids = [...items.map((item) => item.id), ...sampleItems.map((item) => item.id), ...touchedItems];
    if (ids.length > 0) {
      await db.delete(contentDomainEvents).where(inArray(contentDomainEvents.contentItemId, ids));
      await db.delete(eventSuggestions).where(inArray(eventSuggestions.contentItemId, ids));
      await db.delete(contentItemVersions).where(inArray(contentItemVersions.contentItemId, ids));
      await db.delete(contentItems).where(inArray(contentItems.id, ids));
    }
    await db.delete(eventSuggestions).where(eq(eventSuggestions.sourceContext, "Deterministic development sample: not a real event."));
    await db.delete(aiRuns).where(eq(aiRuns.taskKey, "events.discover"));
    await sql.end();
  }

  it("queues valid, labelled, source-linked suggestions as pending, and a repeat run adds nothing", async () => {
    const first = await discoverEvents(hq, { territoryId: SUTTON, from: tomorrow, to: nextMonth, maxResults: 10 });
    expect(first).toMatchObject({ created: 3, duplicates: 0, invalid: 0 });

    const queue = await readEventSuggestions(hq, "pending");
    const mine = queue.filter((row) => row.territoryId === SUTTON && row.sourceContext.startsWith("Deterministic development sample"));
    expect(mine).toHaveLength(3);
    expect(mine.every((row) => row.title.startsWith("[Sample]") && row.sourceUrl.startsWith("https://") && row.status === "pending" && row.contentItemId === null)).toBe(true);

    const second = await discoverEvents(hq, { territoryId: SUTTON, from: tomorrow, to: nextMonth, maxResults: 10 });
    expect(second).toMatchObject({ created: 0, duplicates: 3 });
  });

  it("approving creates a DRAFT event item with source and provenance, exactly once; rejecting records it and never resurfaces", async () => {
    const [target, other] = (await readEventSuggestions(hq, "pending")).filter((row) => row.territoryId === SUTTON);
    const { contentItemId } = await approveEventSuggestionAsActor(sutton, target!.id, "looks good");
    touchedItems.push(contentItemId);

    const { db, sql } = createDb();
    const [item] = await db.select().from(contentItems).where(eq(contentItems.id, contentItemId));
    await sql.end();
    expect(item).toMatchObject({ contentType: "event", status: "draft", sourceType: "ai", territoryId: SUTTON, sourceReference: target!.sourceUrl, approvedAt: null, publishedAt: null });
    expect(item!.provenance).toMatchObject({ source: "ai_event_discovery", suggestionId: target!.id, approvedByUserId: sutton.userId });

    await expect(approveEventSuggestionAsActor(sutton, target!.id, null)).rejects.toThrow(/already approved/);

    await rejectEventSuggestionAsActor(sutton, other!.id, "not relevant");
    const again = await discoverEvents(hq, { territoryId: SUTTON, from: tomorrow, to: nextMonth, maxResults: 10 });
    expect(again).toMatchObject({ created: 0, duplicates: 3 });
    expect((await readEventSuggestions(hq, "rejected")).some((row) => row.id === other!.id)).toBe(true);
  });

  it("keeps territories apart: a franchisee cannot discover for, see, or decide another territory", async () => {
    await expect(discoverEvents(sutton, { territoryId: SOLIHULL, from: tomorrow, to: nextMonth })).rejects.toThrow(/permission/);

    await discoverEvents(hq, { territoryId: SOLIHULL, from: tomorrow, to: nextMonth, maxResults: 3 });
    const visible = await readEventSuggestions(sutton);
    expect(visible.every((row) => row.territoryId === SUTTON)).toBe(true);

    const solihull = (await readEventSuggestions(hq, "pending")).find((row) => row.territoryId === SOLIHULL)!;
    await expect(approveEventSuggestionAsActor(sutton, solihull.id, null)).rejects.toThrow(/Missing permission/);
    await expect(rejectEventSuggestionAsActor(sutton, solihull.id, null)).rejects.toThrow(/Missing permission/);
  });

  it("validates the request before spending anything", async () => {
    await expect(discoverEvents(hq, { territoryId: SUTTON, from: "tomorrow", to: nextMonth })).rejects.toThrow(/valid date range/);
    await expect(discoverEvents(hq, { territoryId: SUTTON, from: nextMonth, to: tomorrow })).rejects.toThrow(/end date/);
    await expect(discoverEvents(hq, { territoryId: SUTTON, from: tomorrow, to: "2099-01-01" })).rejects.toThrow(/at most 90 days/);
    await expect(discoverEvents(hq, { territoryId: "00000000-0000-4000-8000-00000000dead", from: tomorrow, to: nextMonth })).rejects.toThrow(/not found/);
  });
});
