import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it, vi } from "vitest";
import {
  canonicaliseUrl, dedupeKeyFor, EventAccessError, EventStateError, eventsDiscoverTask, findDuplicate, ingestDiscoveredEvents, listEventSuggestionsForActor,
  recordEventApproval, rejectEventSuggestion, requireApprovableSuggestion, validateEventCandidates
} from "./events";
import type { EventCandidate, KnownEvent } from "./events";
import { createInMemoryEventSuggestionStore } from "./events-store";
import { AiOutputError } from "@raring2go/ai";

const NOW = new Date("2026-03-01T09:00:00Z");
const range = { from: "2026-03-01", to: "2026-03-31", now: NOW };
const good = { title: "Story time at the library", startsAt: "2026-03-10T10:00:00Z", venue: "Sutton Library", url: "https://library.example.org/events/story-time", summary: "Stories for under-fives.", sourceContext: "Listed on the library's events page under Children." };

const grant = (roleId: string, action: string, scope: string) => ({ roleId, permission: { id: `e.${action}`, module: "content.event_suggestion", action }, scope });
const permissions: PermissionData = {
  roleAssignments: [
    { id: "a1", userId: "hq", roleId: "hq" },
    { id: "a2", userId: "sutton", roleId: "owner", territoryId: "sutton" },
    { id: "a3", userId: "viewer", roleId: "none" }
  ],
  rolePermissions: [
    ...["view", "discover", "decide"].map((action) => grant("hq", action, "network")),
    ...["view", "discover", "decide"].map((action) => grant("owner", action, "own_territory"))
  ]
};
const hq = { userId: "hq" };
const owner = { userId: "sutton", territoryId: "sutton" };

describe("canonicaliseUrl", () => {
  it("strips tracking, fragments and trailing slashes; lowercases the host", () => {
    expect(canonicaliseUrl("https://Events.Example.org/a/?utm_source=x&id=5&fbclid=z#top")).toBe("https://events.example.org/a?id=5");
    expect(canonicaliseUrl("https://example.org/")).toBe("https://example.org");
  });

  it("rejects non-http(s), credentials, private or bare hosts and junk", () => {
    for (const bad of ["javascript:alert(1)", "ftp://example.org", "https://user:pw@example.org/x", "http://localhost:3000/x", "http://192.168.1.4/x", "https://intranet/x", "https://printer.local/x", "not a url", 5, undefined]) {
      expect(canonicaliseUrl(bad as never)).toBeUndefined();
    }
  });
});

describe("validateEventCandidates", () => {
  it("accepts a well-formed event and normalises text", () => {
    const { valid, rejected } = validateEventCandidates([{ ...good, title: "<b>Story</b> time ", summary: "x".repeat(900) }], range);
    expect(rejected).toEqual([]);
    expect(valid[0]).toMatchObject({ title: "Story time", venue: "Sutton Library", sourceUrl: "https://library.example.org/events/story-time" });
    expect(valid[0]!.summary!.length).toBe(400);
  });

  it("drops each invalid candidate with its own reason and keeps the rest", () => {
    const { valid, rejected } = validateEventCandidates(
      [
        good,
        { ...good, title: "ab" },
        { ...good, startsAt: "not a date" },
        { ...good, startsAt: "2026-02-20T10:00:00Z" }, // before today
        { ...good, startsAt: "2026-05-01T10:00:00Z" }, // after the range
        { ...good, endsAt: "2026-03-01T10:00:00Z" }, // ends before it starts
        { ...good, url: "http://localhost/x" },
        { ...good, sourceContext: "short" }
      ],
      range
    );
    expect(valid).toHaveLength(1);
    expect(rejected.map((entry) => entry.reason)).toEqual([
      "missing title", "missing or invalid start date", "starts in the past or before the requested range", "starts after the requested range",
      "invalid end date", "missing or unusable source URL", "missing source context"
    ]);
  });

  it("never lets a past date through even when the requested range starts earlier", () => {
    const { valid } = validateEventCandidates([{ ...good, startsAt: "2026-03-01T08:00:00Z" }], { from: "2026-02-01", to: "2026-03-31", now: NOW });
    expect(valid).toHaveLength(0);
  });
});

describe("findDuplicate", () => {
  const candidate: EventCandidate = { title: "Story time at the Library", startsAt: new Date("2026-03-10T10:00:00Z"), endsAt: null, venue: "Sutton Library", summary: null, sourceUrl: "https://library.example.org/events/story-time", sourceContext: "ctx ctx ctx" };
  const known = (overrides: Partial<KnownEvent>): KnownEvent => ({ id: "k1", kind: "suggestion", title: "Other", startsAt: null, ...overrides });

  it("matches on dedupe key, canonical URL, or same-day near-identical title", () => {
    expect(findDuplicate(candidate, [known({ dedupeKey: dedupeKeyFor(candidate) })])).toBeDefined();
    expect(findDuplicate(candidate, [known({ sourceUrl: "https://LIBRARY.example.org/events/story-time/?utm_source=a" })])).toBeDefined();
    expect(findDuplicate(candidate, [known({ title: "Story Time at library", startsAt: new Date("2026-03-10T15:00:00Z") })])).toBeDefined();
  });

  it("does not over-match: different day or unrelated title", () => {
    expect(findDuplicate(candidate, [known({ title: "Story time at the Library", startsAt: new Date("2026-03-11T10:00:00Z") })])).toBeUndefined();
    expect(findDuplicate(candidate, [known({ title: "Messy play morning", startsAt: new Date("2026-03-10T10:00:00Z") })])).toBeUndefined();
  });

  it("is stable across casing and punctuation in the dedupe key", () => {
    expect(dedupeKeyFor({ title: "Story-Time!", startsAt: new Date("2026-03-10T09:00:00Z"), venue: "Sutton  Library" })).toBe(
      dedupeKeyFor({ title: "story time", startsAt: new Date("2026-03-10T20:00:00Z"), venue: "sutton library" })
    );
  });
});

describe("eventsDiscoverTask", () => {
  const input = { territoryId: "sutton", territoryName: "Sutton Coldfield", from: "2026-03-01", to: "2026-03-31", interests: ["outdoors"], maxResults: 10 };

  it("is external-only, never approves anything itself, and sends structured input", () => {
    expect(eventsDiscoverTask.externalOnly).toBe(true);
    expect(eventsDiscoverTask.structuredInput!(input)).toEqual({ territory: "Sutton Coldfield", territoryId: "sutton", from: "2026-03-01", to: "2026-03-31", interests: ["outdoors"], maxResults: 10 });
    expect(() => eventsDiscoverTask.parse("anything", input)).toThrow(AiOutputError);
  });

  it("validates the workflow response shape and bounds the list", () => {
    expect(eventsDiscoverTask.fromStructured!({ events: [{ title: "a" }, "junk", null, { title: "b" }] }, input).events).toEqual([{ title: "a" }, { title: "b" }]);
    expect(eventsDiscoverTask.fromStructured!({ events: Array.from({ length: 200 }, () => ({})) }, input).events).toHaveLength(50);
    expect(() => eventsDiscoverTask.fromStructured!({ nope: 1 }, input)).toThrow(AiOutputError);
    expect(() => eventsDiscoverTask.fromStructured!(null, input)).toThrow(AiOutputError);
  });

  it("labels its development samples so they cannot be mistaken for real events", () => {
    const { events } = eventsDiscoverTask.deterministic(input);
    expect(events.every((event) => String(event.title).startsWith("[Sample]"))).toBe(true);
  });
});

describe("ingestDiscoveredEvents", () => {
  const base = { territoryId: "sutton", aiRunId: "run-1", from: "2026-03-01", to: "2026-03-31", maxResults: 10 };
  const noAudit = { record: async () => undefined };

  it("stores valid, unique candidates as pending and reports what it dropped", async () => {
    const store = createInMemoryEventSuggestionStore();
    const record = vi.fn(async () => undefined);
    const result = await ingestDiscoveredEvents(owner, permissions, { record }, store, [], {
      ...base,
      rawEvents: [good, { ...good, title: "Story time at the Library!" }, { ...good, title: "Messy play", url: "https://x.example.org/messy", startsAt: "2026-03-12T10:00:00Z", venue: "Hall" }, { ...good, title: "" }]
    }, NOW);

    expect(result.created.map((row) => row.title)).toEqual(["Story time at the library", "Messy play"]);
    expect(result).toMatchObject({ duplicates: 1, invalid: [{ index: 3, reason: "missing title" }] });
    expect(result.created[0]).toMatchObject({ status: "pending", aiRunId: "run-1", sourceUrl: "https://library.example.org/events/story-time", contentItemId: null });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ created: 2, duplicates: 1, invalid: 1 }) }));
  });

  it("does not resurface events already suggested, approved, rejected, or already in content", async () => {
    const store = createInMemoryEventSuggestionStore();
    const first = await ingestDiscoveredEvents(owner, permissions, noAudit, store, [], { ...base, rawEvents: [good] }, NOW);
    await rejectEventSuggestion(owner, permissions, noAudit, store, first.created[0]!.id, "not for us", NOW);

    expect((await ingestDiscoveredEvents(owner, permissions, noAudit, store, [], { ...base, rawEvents: [good] }, NOW)).duplicates).toBe(1);
    const existingContent: KnownEvent[] = [{ id: "c1", kind: "content", title: "Messy play", startsAt: new Date("2026-03-12T10:00:00Z") }];
    const second = await ingestDiscoveredEvents(owner, permissions, noAudit, store, existingContent, { ...base, rawEvents: [{ ...good, title: "Messy play", url: "https://x.example.org/m", startsAt: "2026-03-12T14:00:00Z" }] }, NOW);
    expect(second).toMatchObject({ duplicates: 1, created: [] });
    expect(store.rows.size).toBe(1);
  });

  it("respects maxResults", async () => {
    const store = createInMemoryEventSuggestionStore();
    const raw = Array.from({ length: 6 }, (_, n) => ({ ...good, title: `Event number ${n}`, url: `https://e.example.org/${n}`, startsAt: `2026-03-${10 + n}T10:00:00Z`, venue: `Venue ${n}` }));
    expect((await ingestDiscoveredEvents(hq, permissions, noAudit, store, [], { ...base, maxResults: 3, rawEvents: raw }, NOW)).created).toHaveLength(3);
  });

  it("denies discovery outside the actor's territory or without the grant", async () => {
    const store = createInMemoryEventSuggestionStore();
    await expect(ingestDiscoveredEvents(owner, permissions, noAudit, store, [], { ...base, territoryId: "solihull", rawEvents: [good] }, NOW)).rejects.toBeInstanceOf(EventAccessError);
    await expect(ingestDiscoveredEvents({ userId: "viewer" }, permissions, noAudit, store, [], { ...base, rawEvents: [good] }, NOW)).rejects.toBeInstanceOf(EventAccessError);
    expect(store.rows.size).toBe(0);
  });
});

describe("queue decisions", () => {
  const noAudit = { record: async () => undefined };
  async function pending(territoryId = "sutton") {
    const store = createInMemoryEventSuggestionStore();
    const { created } = await ingestDiscoveredEvents(hq, permissions, noAudit, store, [], { territoryId, aiRunId: null, from: "2026-03-01", to: "2026-03-31", maxResults: 5, rawEvents: [good] }, NOW);
    return { store, suggestion: created[0]! };
  }

  it("lists only the actor's territory, and nothing without view permission", async () => {
    const store = createInMemoryEventSuggestionStore();
    for (const territoryId of ["sutton", "solihull"]) {
      await ingestDiscoveredEvents(hq, permissions, noAudit, store, [], { territoryId, aiRunId: null, from: "2026-03-01", to: "2026-03-31", maxResults: 5, rawEvents: [good] }, NOW);
    }
    expect((await listEventSuggestionsForActor(owner, permissions, store)).map((row) => row.territoryId)).toEqual(["sutton"]);
    expect(await listEventSuggestionsForActor(hq, permissions, store)).toHaveLength(2);
    await expect(listEventSuggestionsForActor({ userId: "viewer" }, permissions, store)).rejects.toBeInstanceOf(EventAccessError);
  });

  it("rejects once with an audit, and approval records the created content id exactly once", async () => {
    const { store, suggestion } = await pending();
    const record = vi.fn(async () => undefined);
    const approvable = await requireApprovableSuggestion(owner, permissions, store, suggestion.id);
    const approved = await recordEventApproval(owner, { record }, store, approvable, { contentItemId: "content-1", note: " ok " }, NOW);
    expect(approved).toMatchObject({ status: "approved", contentItemId: "content-1", decisionNote: "ok", decidedByUserId: "sutton" });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.approve", after: { status: "approved", contentItemId: "content-1" } }));
    await expect(requireApprovableSuggestion(owner, permissions, store, suggestion.id)).rejects.toBeInstanceOf(EventStateError);
    await expect(rejectEventSuggestion(owner, permissions, noAudit, store, suggestion.id, null)).rejects.toBeInstanceOf(EventStateError);
  });

  it("a territory owner cannot decide another territory's suggestion; a missing id looks the same", async () => {
    const { store, suggestion } = await pending("solihull");
    await expect(requireApprovableSuggestion(owner, permissions, store, suggestion.id)).rejects.toBeInstanceOf(EventAccessError);
    await expect(rejectEventSuggestion(owner, permissions, noAudit, store, suggestion.id, null)).rejects.toBeInstanceOf(EventAccessError);
    await expect(rejectEventSuggestion(owner, permissions, noAudit, store, "nope", null)).rejects.toThrow("Event suggestion not found.");
    expect(store.rows.get(suggestion.id)!.status).toBe("pending");
  });
});
