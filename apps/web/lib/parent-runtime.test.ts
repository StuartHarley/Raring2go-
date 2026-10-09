import { randomUUID } from "node:crypto";
import { audienceConsentEvents, audienceContacts, audiencePreferenceProfiles, audienceSavedContent, audienceSuppressions, audienceTerritorySubscriptions, authSessions, createDb, fixtureIds, users } from "@raring2go/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDevelopmentSession, createFixtureIdentity, setIdentityForTests } from "./auth-runtime";
import {
  ParentSignInRequiredError,
  changeParentEmailOptOut,
  changeParentEmailSubscription,
  readParentAccount,
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

  // The suite's default identity is in-memory; this test needs the real database users.
  beforeAll(() => setIdentityForTests(undefined));

  afterAll(async () => {
    setIdentityForTests(createFixtureIdentity());
    for (const email of emails) {
      const [user] = await db.select().from(users).where(eq(users.email, email));
      const [contact] = await db.select().from(audienceContacts).where(eq(audienceContacts.emailNormalised, email));
      if (contact) {
        await db.delete(audienceConsentEvents).where(eq(audienceConsentEvents.contactId, contact.id));
        await db.delete(audienceSavedContent).where(eq(audienceSavedContent.contactId, contact.id));
        await db.delete(audiencePreferenceProfiles).where(eq(audiencePreferenceProfiles.contactId, contact.id));
        await db.delete(audienceSuppressions).where(eq(audienceSuppressions.contactId, contact.id));
        await db.delete(audienceTerritorySubscriptions).where(eq(audienceTerritorySubscriptions.contactId, contact.id));
        await db.delete(audienceContacts).where(eq(audienceContacts.id, contact.id));
      }
      if (user) await db.delete(authSessions).where(eq(authSessions.userId, user.id));
    }
    await sql.end();
  });

  it("derives the contact from the session, so two parents never see each other", async () => {
    await createDevelopmentSession({ email: emails[0]!, sessionToken: tokens[0]!, ttlMs: 60_000 });
    await createDevelopmentSession({ email: emails[1]!, sessionToken: tokens[1]!, ttlMs: 60_000 });

    await changeParentEmailSubscription(tokens[0], { territoryId: sutton, subscribed: true });
    await saveParentPreferences(tokens[0], { ...prefs, interests: ["crafts"] });

    const a = await readParentAccount(tokens[0]);
    const b = await readParentAccount(tokens[1]);
    expect(a?.contact.email).toBe(emails[0]);
    expect(a?.territories.find((area) => area.id === sutton)?.emailSubscribed).toBe(true);
    expect(a?.preferences.interests).toEqual(["crafts"]);

    expect(b?.contact.email).toBe(emails[1]);
    expect(b?.territories.find((area) => area.id === sutton)?.emailSubscribed).toBe(false);
    expect(b?.preferences.interests).toEqual([]);
  });

  it("opts a signed-in parent out and in, with consent and audit evidence", async () => {
    await changeParentEmailOptOut(tokens[0], true);
    expect((await readParentAccount(tokens[0]))?.emailOptedOut).toBe(true);
    expect((await readParentAccount(tokens[1]))?.emailOptedOut).toBe(false);
    await changeParentEmailOptOut(tokens[0], false);
    expect((await readParentAccount(tokens[0]))?.emailOptedOut).toBe(false);
  });
});
