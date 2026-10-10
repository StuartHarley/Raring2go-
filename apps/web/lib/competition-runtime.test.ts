import { randomUUID } from "node:crypto";
import { audienceConsentEvents, audienceTerritorySubscriptions, auditEvents, audienceContacts, competitionEntries, contentChannelVariantVersions, contentChannelVariants, contentItems, createDb, deleteAudienceContactsForTests, fixtureIds, publicAnalyticsEvents, users, authSessions } from "@raring2go/db";
import { createDrizzlePrivacyStore, enforceRetention } from "@raring2go/security";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDevelopmentSession, createFixtureIdentity, setIdentityForTests } from "./auth-runtime";
import {
  CompetitionClosedError, CompetitionDrawError, CompetitionNotAllowedError, competitionClosingDate, competitionState, drawCompetitionWinners, enterCompetitionForParent, hasEnteredCompetition, pickRandom, readCompetitionEntries
} from "./competition-runtime";
import { ParentSignInRequiredError } from "./parent-runtime";
import { withFinanceGuardsDisabled } from "./finance-test-support";

describe("competition rules", () => {
  it("works out the closing date and state", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(competitionClosingDate({ endDate: "2026-10-12" })).toBe("2026-10-12");
    expect(competitionClosingDate({ expiresAt: "2026-10-12T23:59:00Z" })).toBe("2026-10-12");
    expect(competitionClosingDate({ startDate: "2026-10-01" })).toBeNull();
    expect(competitionState("2026-10-10", now)).toBe("open");
    expect(competitionState("2026-10-09", now)).toBe("closed");
    expect(competitionState(null, now)).toBe("no_end_date");
  });
  it("picks distinct entries uniformly with the source it is given", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(pickRandom(items, 2, () => 0)).toHaveLength(2);
    expect(new Set(pickRandom(items, 5)).size).toBe(5);
    expect(pickRandom(items, 10)).toHaveLength(5);
    // Every entry can win: over many draws of one, each of the five turns up.
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) seen.add(pickRandom(items, 1)[0]!);
    expect(seen.size).toBe(5);
    expect(items).toEqual(["a", "b", "c", "d", "e"]);
  });
});

/** Real database: entering is once per person and only while open; the draw is once, random, audited and limited to people who may run it. `RUN_DB_TESTS=1` */
describe.skipIf(!process.env.RUN_DB_TESTS)("competition entries and draw (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const sutton = fixtureIds.territories.suttonColdfield;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const emails = ["a", "b", "c"].map((n) => `comp-${n}-${tag}@example.test`);
  const tokens = emails.map(() => randomUUID());
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, territoryId: null };
  const suttonStaff = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: sutton };
  const solihullStaff = { ...suttonStaff, territoryId: fixtureIds.territories.solihull };
  const created: string[] = [];
  const variants: Array<{ id: string; version: string }> = [];
  const eventStart = new Date();

  async function competition(title: string, relevantDates: Record<string, unknown>, status = "published") {
    const id = randomUUID();
    const variant = { id: randomUUID(), version: randomUUID() };
    await db.insert(contentItems).values({ id, title: `${title} ${tag}`, contentType: "competition", ownerLevel: "territory", territoryId: sutton, categories: [], tags: [], provenance: {}, status, relevantDates });
    await db.insert(contentChannelVariants).values({ id: variant.id, contentItemId: id, channel: "website", status: "approved", currentVersionId: variant.version, territoryId: sutton });
    await db.insert(contentChannelVariantVersions).values({ id: variant.version, variantId: variant.id, versionNumber: 1, status: "approved", snapshot: {} });
    created.push(id);
    variants.push(variant);
    return id;
  }

  beforeAll(async () => {
    setIdentityForTests(undefined);
    for (const [index, email] of emails.entries()) await createDevelopmentSession({ email, sessionToken: tokens[index]!, ttlMs: 120_000 });
  });

  afterAll(async () => {
    setIdentityForTests(createFixtureIdentity());
    const contacts = await db.select({ id: audienceContacts.id }).from(audienceContacts).where(inArray(audienceContacts.emailNormalised, emails));
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(inArray(auditEvents.entityId, created));
    });
    await db.delete(competitionEntries).where(inArray(competitionEntries.contentItemId, created));
    await db.delete(publicAnalyticsEvents).where(and(eq(publicAnalyticsEvents.eventType, "public_conversion"), inArray(publicAnalyticsEvents.entityId, created)));
    await deleteAudienceContactsForTests(db, contacts.map((c) => c.id));
    for (const email of emails) {
      const [user] = await db.select().from(users).where(eq(users.email, email));
      if (user) await db.delete(authSessions).where(eq(authSessions.userId, user.id));
    }
    await db.delete(contentChannelVariantVersions).where(inArray(contentChannelVariantVersions.id, variants.map((v) => v.version)));
    await db.delete(contentChannelVariants).where(inArray(contentChannelVariants.id, variants.map((v) => v.id)));
    await db.delete(contentItems).where(inArray(contentItems.id, created));
    await sql.end();
  });

  const enter = (index: number, contentId: string) => enterCompetitionForParent({ sessionToken: tokens[index], territorySlug: "sutton-coldfield", contentId });

  it("lets a signed-in parent enter once, while open, and records one conversion without who entered", async () => {
    const open = await competition("Win a family ticket", { endDate: day(5) });
    await expect(enterCompetitionForParent({ sessionToken: null, territorySlug: "sutton-coldfield", contentId: open })).rejects.toBeInstanceOf(ParentSignInRequiredError);
    expect(await enter(0, open)).toEqual({ entered: true, alreadyEntered: false });
    expect(await enter(0, open)).toEqual({ entered: false, alreadyEntered: true });
    expect(await hasEnteredCompetition(tokens[0], open)).toBe(true);
    expect(await hasEnteredCompetition(tokens[1], open)).toBe(false);
    expect(await hasEnteredCompetition(null, open)).toBe(false);

    const events = await db.select().from(publicAnalyticsEvents).where(and(eq(publicAnalyticsEvents.eventType, "public_conversion"), eq(publicAnalyticsEvents.entityId, open)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityType: "content", sessionId: null, parentUserId: null, metadata: { conversionType: "competition_entry" } });

    // Entering gave no marketing consent.
    const [contact] = await db.select().from(audienceContacts).where(eq(audienceContacts.emailNormalised, emails[0]!));
    expect(await db.select().from(audienceTerritorySubscriptions).where(eq(audienceTerritorySubscriptions.contactId, contact!.id))).toEqual([]);
    expect(await db.select().from(audienceConsentEvents).where(eq(audienceConsentEvents.contactId, contact!.id))).toEqual([]);
  });

  it("refuses entry to a competition that is closed, has no closing date, is not published, or is not in that area", async () => {
    const closed = await competition("Closed one", { endDate: day(-1) });
    const noEnd = await competition("No end date", {});
    const draft = await competition("Draft comp", { endDate: day(5) }, "draft");
    for (const id of [closed, noEnd, draft, randomUUID()]) await expect(enter(1, id)).rejects.toBeInstanceOf(CompetitionClosedError);
    await expect(enterCompetitionForParent({ sessionToken: tokens[1], territorySlug: "nowhere", contentId: closed })).rejects.toBeInstanceOf(CompetitionClosedError);
    expect(await db.select().from(competitionEntries).where(inArray(competitionEntries.contentItemId, [closed, noEnd, draft]))).toEqual([]);
  });

  it("draws once the competition has closed, at random, once, audited, and only for people who may", async () => {
    const id = await competition("Draw me", { endDate: day(1) });
    for (const index of [0, 1, 2]) await enter(index, id);
    expect(await readCompetitionEntries(hq, id)).toMatchObject({ entryCount: 3, state: "open", drawn: false, winners: [] });
    await expect(drawCompetitionWinners(hq, id, 1)).rejects.toMatchObject({ code: "still_open" });

    // The competition ends: staff can now draw it.
    await db.update(contentItems).set({ relevantDates: { endDate: day(-1) } }).where(eq(contentItems.id, id));
    await expect(drawCompetitionWinners(solihullStaff, id, 1)).rejects.toBeInstanceOf(CompetitionNotAllowedError);
    await expect(drawCompetitionWinners(hq, id, 0)).rejects.toMatchObject({ code: "bad_count" });
    await expect(drawCompetitionWinners(hq, id, 11)).rejects.toMatchObject({ code: "bad_count" });
    const drawn = await drawCompetitionWinners(suttonStaff, id, 2);
    expect(drawn).toEqual({ entrants: 3, winners: 2 });
    await expect(drawCompetitionWinners(hq, id, 1)).rejects.toMatchObject({ code: "already_drawn" });

    const rows = await db.select().from(competitionEntries).where(eq(competitionEntries.contentItemId, id));
    expect(rows.filter((r) => r.outcome === "winner")).toHaveLength(2);
    expect(rows.filter((r) => r.outcome === "winner").every((r) => r.drawnByUserId === suttonStaff.userId && r.drawnAt)).toBe(true);
    const view = await readCompetitionEntries(suttonStaff, id);
    expect(view).toMatchObject({ entryCount: 3, state: "closed", drawn: true, canDraw: true });
    expect(view.winners.map((w) => w.email).every((email) => emails.includes(email!))).toBe(true);
    await expect(readCompetitionEntries(solihullStaff, id)).rejects.toBeInstanceOf(CompetitionNotAllowedError);

    const audit = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, "content.competition.draw")));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.payload)).not.toContain("@example.test");
    expect((audit[0]!.payload as { after: unknown }).after).toMatchObject({ entrants: 3, winnersRequested: 2 });
  });

  it("refuses to draw a competition with no entries or no closing date, and two people drawing at once cannot both succeed", async () => {
    const empty = await competition("Nobody came", { endDate: day(-2) });
    await expect(drawCompetitionWinners(hq, empty, 1)).rejects.toMatchObject({ code: "no_entries" });
    const noEnd = await competition("Never ends", {});
    await expect(drawCompetitionWinners(hq, noEnd, 1)).rejects.toMatchObject({ code: "no_end_date" });
    await expect(drawCompetitionWinners(hq, randomUUID(), 1)).rejects.toBeInstanceOf(CompetitionDrawError);

    const race = await competition("Photo finish", { endDate: day(3) });
    for (const index of [0, 1, 2]) await enter(index, race);
    await db.update(contentItems).set({ relevantDates: { endDate: day(-1) } }).where(eq(contentItems.id, race));
    const results = await Promise.allSettled([drawCompetitionWinners(hq, race, 1), drawCompetitionWinners(hq, race, 1), drawCompetitionWinners(suttonStaff, race, 1)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.select().from(competitionEntries).where(and(eq(competitionEntries.contentItemId, race), eq(competitionEntries.outcome, "winner"))))).toHaveLength(1);
  });

  it("includes entries in a person's data export, removes them on erasure, and deletes old entries under the retention policy", async () => {
    const id = await competition("Privacy check", { endDate: day(4) });
    await enter(0, id);
    const [contact] = await db.select().from(audienceContacts).where(eq(audienceContacts.emailNormalised, emails[0]!));
    const store = createDrizzlePrivacyStore(db);
    const bundle = await store.gatherSubjectData(contact!.id, new Date());
    expect(bundle.competitionEntries.some((entry) => entry.contentItemId === id)).toBe(true);

    // Retention: 91-day-old non-winners and 13-month-old winners go; fresh ones and recent winners stay.
    const old = await competition("Old comp", { endDate: day(-100) });
    const stamp = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
    const rows = [
      { contactId: contact!.id, contentItemId: old, outcome: "entered", enteredAt: stamp(91), drawnAt: null },
      { contactId: (await db.select().from(audienceContacts).where(eq(audienceContacts.emailNormalised, emails[1]!)).then((r) => r[0]!.id)), contentItemId: old, outcome: "winner", enteredAt: stamp(400), drawnAt: stamp(380) },
      { contactId: (await db.select().from(audienceContacts).where(eq(audienceContacts.emailNormalised, emails[2]!)).then((r) => r[0]!.id)), contentItemId: old, outcome: "winner", enteredAt: stamp(100), drawnAt: stamp(60) }
    ];
    await db.insert(competitionEntries).values(rows.map((row) => ({ id: randomUUID(), territoryId: sutton, ...row })));
    const result = await enforceRetention(db);
    expect(result.competition_entries).toBeGreaterThanOrEqual(2);
    const left = await db.select().from(competitionEntries).where(eq(competitionEntries.contentItemId, old));
    expect(left.map((entry) => entry.outcome)).toEqual(["winner"]);
    expect((await db.select().from(competitionEntries).where(eq(competitionEntries.contentItemId, id)))).toHaveLength(1);

    await db.transaction(async (tx) => {
      const counts = await createDrizzlePrivacyStore(tx as never).eraseContact(contact!.id, new Date());
      expect(counts.competitionEntries).toBeGreaterThanOrEqual(1);
    });
    expect(await db.select().from(competitionEntries).where(eq(competitionEntries.contactId, contact!.id))).toEqual([]);
  });
});
