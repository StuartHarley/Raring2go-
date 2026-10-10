import { randomUUID } from "node:crypto";
import { deleteAudienceContactsForTests, contentChannelVariantVersions, contentChannelVariants, contentItems, audienceConsentEvents, audienceContacts, audiencePreferenceProfiles, audienceSavedContent, audienceSuppressions, audienceTerritorySubscriptions, authSessions, createDb, fixtureIds, users } from "@raring2go/db";
import { eq, sql as rawSql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDevelopmentSession, createFixtureIdentity, setIdentityForTests } from "./auth-runtime";
import {
  ParentSignInRequiredError,
  changeParentEmailOptOut,
  changeParentEmailSubscription,
  readParentAccount,
  savePublicContentForParent,
  saveParentPreferences,
  unsavePublicContentForParent
} from "./parent-runtime";

const prefs = { followedTerritoryIds: [], childAgeBands: [], interests: [], eventCategories: [], offerPreferences: [], competitionPreferences: [], newsletterFrequency: "weekly", personalisationEnabled: true };

describe("parent self-service runtime", () => {
  it("refuses every change without a valid parent session", async () => {
    for (const token of [undefined, null, "", "not-a-real-session"]) {
      await expect(changeParentEmailOptOut(token, true)).rejects.toBeInstanceOf(ParentSignInRequiredError);
      await expect(changeParentEmailSubscription(token, { territoryId: fixtureIds.territories.suttonColdfield, subscribed: true })).rejects.toBeInstanceOf(ParentSignInRequiredError);
      await expect(saveParentPreferences(token, prefs)).rejects.toBeInstanceOf(ParentSignInRequiredError);
      await expect(unsavePublicContentForParent({ sessionToken: token, contentId: randomUUID() })).rejects.toThrow();
      expect(await readParentAccount(token)).toBeUndefined();
    }
  });
});

/** Real database: a signed-in parent changes only their own record. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("parent self-service runtime (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const sutton = fixtureIds.territories.suttonColdfield;
  const emails = [`parent-a-${tag}@example.test`, `parent-b-${tag}@example.test`];
  const tokens = [randomUUID(), randomUUID()];
  const startedAt = new Date();
  const eventsOf = async (type: string, entityId?: string) =>
    db.execute(rawSql`select entity_type, entity_id, session_id, parent_user_id, path from public_analytics_events
      where event_type = ${type} and territory_id = ${sutton} and occurred_at >= ${startedAt.toISOString()}::timestamptz ${entityId ? rawSql`and entity_id = ${entityId}` : rawSql``}`);

  // The suite's default identity is in-memory; this test needs the real database users.
  beforeAll(() => setIdentityForTests(undefined));

  afterAll(async () => {
    await db.execute(rawSql`delete from public_analytics_events where event_type in ('content_saved', 'newsletter_signup_completed') and territory_id = ${sutton} and occurred_at >= ${startedAt.toISOString()}::timestamptz`);
    setIdentityForTests(createFixtureIdentity());
    for (const email of emails) {
      const [user] = await db.select().from(users).where(eq(users.email, email));
      const [contact] = await db.select().from(audienceContacts).where(eq(audienceContacts.emailNormalised, email));
      if (contact) await deleteAudienceContactsForTests(db, [contact.id]);
      if (user) await db.delete(authSessions).where(eq(authSessions.userId, user.id));
    }
    await sql.end();
  });

  it("derives the contact from the session, so two parents never see each other", async () => {
    await createDevelopmentSession({ email: emails[0]!, sessionToken: tokens[0]!, ttlMs: 60_000 });
    await createDevelopmentSession({ email: emails[1]!, sessionToken: tokens[1]!, ttlMs: 60_000 });

    await changeParentEmailSubscription(tokens[0], { territoryId: sutton, subscribed: true });
    await saveParentPreferences(tokens[0], { ...prefs, interests: ["crafts"] });

    // The completed signup is recorded once, without who did it; repeating it or unsubscribing adds nothing.
    const signups = await eventsOf("newsletter_signup_completed");
    expect(signups).toHaveLength(1);
    expect(signups[0]).toMatchObject({ entity_type: "newsletter", session_id: null, parent_user_id: null, path: "/areas/sutton-coldfield/preferences" });
    await changeParentEmailSubscription(tokens[0], { territoryId: sutton, subscribed: true });
    await changeParentEmailSubscription(tokens[1], { territoryId: sutton, subscribed: false });
    expect(await eventsOf("newsletter_signup_completed")).toHaveLength(1);

    const a = await readParentAccount(tokens[0]);
    const b = await readParentAccount(tokens[1]);
    expect(a?.contact.email).toBe(emails[0]);
    expect(a?.territories.find((area) => area.id === sutton)?.emailSubscribed).toBe(true);
    expect(a?.preferences.interests).toEqual(["crafts"]);

    expect(b?.contact.email).toBe(emails[1]);
    expect(b?.territories.find((area) => area.id === sutton)?.emailSubscribed).toBe(false);
    expect(b?.preferences.interests).toEqual([]);
  });

  it("saves and unsaves public content through the real database, and refuses non-public content", async () => {
    const ids = { item: randomUUID(), draft: randomUUID(), variant: randomUUID(), version: randomUUID() };
    const base = { contentType: "event", ownerLevel: "territory", territoryId: sutton, categories: [], tags: [], provenance: {} };
    await db.insert(contentItems).values([
      { ...base, id: ids.item, title: `Save Test ${tag}`, status: "published", relevantDates: { startDate: "2099-05-01" } },
      { ...base, id: ids.draft, title: `Save Draft ${tag}`, status: "draft", relevantDates: {} }
    ]);
    await db.insert(contentChannelVariants).values({ id: ids.variant, contentItemId: ids.item, channel: "website", status: "approved", currentVersionId: ids.version, territoryId: sutton });
    await db.insert(contentChannelVariantVersions).values({ id: ids.version, variantId: ids.variant, versionNumber: 1, status: "approved", snapshot: {} });

    try {
      const first = await savePublicContentForParent({ sessionToken: tokens[0], territorySlug: "sutton-coldfield", contentId: ids.item });
      expect(first.saved).toBe(true);
      // A new save is recorded as one event about the content, with nothing about the parent.
      const saves = await eventsOf("content_saved", ids.item);
      expect(saves).toHaveLength(1);
      expect(saves[0]).toMatchObject({ entity_type: "content", session_id: null, parent_user_id: null });
      // Saving twice keeps one row.
      expect((await savePublicContentForParent({ sessionToken: tokens[0], territorySlug: "sutton-coldfield", contentId: ids.item })).id).toBe(first.id);
      expect((await readParentAccount(tokens[0]))?.saved.map((item) => item.title)).toEqual([`Save Test ${tag}`]);
      expect((await readParentAccount(tokens[1]))?.saved).toEqual([]);

      expect(await eventsOf("content_saved", ids.item)).toHaveLength(1);
      await expect(savePublicContentForParent({ sessionToken: tokens[0], territorySlug: "sutton-coldfield", contentId: ids.draft })).rejects.toThrow(/public content/);
      expect(await eventsOf("content_saved", ids.draft)).toHaveLength(0);

      await unsavePublicContentForParent({ sessionToken: tokens[0], contentId: ids.item });
      expect((await readParentAccount(tokens[0]))?.saved).toEqual([]);
    } finally {
      await db.delete(audienceSavedContent).where(eq(audienceSavedContent.contentReferenceId, ids.item));
      await db.delete(contentChannelVariantVersions).where(eq(contentChannelVariantVersions.id, ids.version));
      await db.delete(contentChannelVariants).where(eq(contentChannelVariants.id, ids.variant));
      await db.delete(contentItems).where(eq(contentItems.id, ids.item));
      await db.delete(contentItems).where(eq(contentItems.id, ids.draft));
    }
  });

  it("opts a signed-in parent out and in, with consent and audit evidence", async () => {
    await changeParentEmailOptOut(tokens[0], true);
    expect((await readParentAccount(tokens[0]))?.emailOptedOut).toBe(true);
    expect((await readParentAccount(tokens[1]))?.emailOptedOut).toBe(false);
    await changeParentEmailOptOut(tokens[0], false);
    expect((await readParentAccount(tokens[0]))?.emailOptedOut).toBe(false);
  });
});
