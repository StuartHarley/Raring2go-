import { randomUUID } from "node:crypto";
import { audienceConsentEvents, audienceContacts, audiencePreferenceProfiles, audienceSavedContent, audienceSuppressions, audienceTerritorySubscriptions, createDb, fixtureIds, users } from "@raring2go/db";
import { loadPermissionData } from "@raring2go/permissions";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadParentAccount, setEmailOptOut, setEmailSubscription, updateParentPreferences, ParentSelfServiceError } from "./parent-self-service";
import { loadMarketingData } from "./repository";
import { previewSegmentDefinition } from "./service";

/** Real SQL for parent self-service. `RUN_DB_TESTS=1 pnpm --filter @raring2go/marketing test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("parent self-service (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const sutton = fixtureIds.territories.suttonColdfield;
  const solihull = fixtureIds.territories.solihull;
  const staff = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const userId = randomUUID();
  const contactId = randomUUID();
  const email = `parent-${tag}@example.test`;
  const parent = { userId, contactId };

  beforeAll(async () => {
    await db.insert(users).values({ id: userId, email, displayName: "Test parent" });
    await db.insert(audienceContacts).values({ id: contactId, email, emailNormalised: email, emailStatus: "subscribed", tags: [], metadata: { source: "test" } });
  });

  afterAll(async () => {
    await db.delete(audienceConsentEvents).where(eq(audienceConsentEvents.contactId, contactId));
    await db.delete(audienceSavedContent).where(eq(audienceSavedContent.contactId, contactId));
    await db.delete(audiencePreferenceProfiles).where(eq(audiencePreferenceProfiles.contactId, contactId));
    await db.delete(audienceSuppressions).where(eq(audienceSuppressions.contactId, contactId));
    await db.delete(audienceTerritorySubscriptions).where(eq(audienceTerritorySubscriptions.contactId, contactId));
    await db.delete(audienceContacts).where(eq(audienceContacts.id, contactId));
    await sql.end();
  });

  /** Who an email campaign for this area would actually reach, using the real eligibility rules. */
  async function eligibleFor(territoryId: string) {
    const [data, permissions] = await Promise.all([loadMarketingData(db), loadPermissionData(db)]);
    return previewSegmentDefinition(staff, permissions, data, { territoryId, definition: {} }).some((view) => view.contact.id === contactId);
  }

  it("starts with no email consent, so the parent is not eligible", async () => {
    expect(await eligibleFor(sutton)).toBe(false);
  });

  it("subscribing to an area makes the parent eligible immediately and records consent once", async () => {
    expect(await setEmailSubscription(db, parent, { territoryId: sutton, subscribed: true })).toEqual({ changed: true });
    expect(await eligibleFor(sutton)).toBe(true);
    expect(await eligibleFor(solihull)).toBe(false);

    // Repeating the same choice is a no-op and adds no consent event.
    expect(await setEmailSubscription(db, parent, { territoryId: sutton, subscribed: true })).toEqual({ changed: false });
    const events = await db.select().from(audienceConsentEvents).where(eq(audienceConsentEvents.contactId, contactId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "granted", consentType: "email_marketing", source: "parent_account", actorUserId: userId, territoryId: sutton });
  });

  it("withdrawing consent removes the parent from the audience immediately", async () => {
    await setEmailSubscription(db, parent, { territoryId: sutton, subscribed: false });
    expect(await eligibleFor(sutton)).toBe(false);
    const view = await loadParentAccount(db, parent);
    expect(view.territories.find((area) => area.id === sutton)?.emailSubscribed).toBe(false);
  });

  it("opting out of all email suppresses the parent even when subscribed, and opting back in restores it", async () => {
    await setEmailSubscription(db, parent, { territoryId: sutton, subscribed: true });
    expect(await eligibleFor(sutton)).toBe(true);

    expect(await setEmailOptOut(db, parent, true)).toEqual({ changed: true });
    expect(await eligibleFor(sutton)).toBe(false);
    expect((await loadParentAccount(db, parent)).emailOptedOut).toBe(true);
    expect(await setEmailOptOut(db, parent, true)).toEqual({ changed: false });

    expect(await setEmailOptOut(db, parent, false)).toEqual({ changed: true });
    expect(await eligibleFor(sutton)).toBe(true);
    expect((await loadParentAccount(db, parent)).emailOptedOut).toBe(false);
  });

  it("cannot lift a suppression the parent did not create", async () => {
    await db.insert(audienceSuppressions).values({
      id: randomUUID(), contactId, emailNormalised: email, territoryId: null, reason: "hard_bounce", source: "provider", active: true, suppressedAt: new Date(), metadata: {}
    });
    await db.update(audienceContacts).set({ emailStatus: "suppressed" }).where(eq(audienceContacts.id, contactId));

    await setEmailOptOut(db, parent, true);
    expect(await setEmailOptOut(db, parent, false)).toEqual({ changed: true });

    expect(await eligibleFor(sutton)).toBe(false);
    const view = await loadParentAccount(db, parent);
    expect(view.lockedSuppressions).toEqual(["hard_bounce"]);
    expect(view.contact.emailStatus).toBe("suppressed");
    // The bounce is still active.
    const [bounce] = await db.select().from(audienceSuppressions).where(eq(audienceSuppressions.reason, "hard_bounce"));
    expect(bounce?.active).toBe(true);
  });

  it("saves broad preferences and rejects anything outside the minimised set", async () => {
    const base = { followedTerritoryIds: [sutton], childAgeBands: ["primary"], interests: ["Soft Play", " soft play "], eventCategories: [], offerPreferences: [], competitionPreferences: [], newsletterFrequency: "monthly", personalisationEnabled: true };
    await updateParentPreferences(db, parent, base);
    const view = await loadParentAccount(db, parent);
    expect(view.preferences).toMatchObject({ childAgeBands: ["primary"], interests: ["soft play"], newsletterFrequency: "monthly" });
    expect(view.territories.find((area) => area.id === sutton)?.following).toBe(true);

    await expect(updateParentPreferences(db, parent, { ...base, childAgeBands: ["age-7-and-a-half"] })).rejects.toBeInstanceOf(ParentSelfServiceError);
    await expect(updateParentPreferences(db, parent, { ...base, newsletterFrequency: "hourly" })).rejects.toBeInstanceOf(ParentSelfServiceError);
    await expect(updateParentPreferences(db, parent, { ...base, followedTerritoryIds: [randomUUID()] })).rejects.toMatchObject({ code: "unknown_territory" });
  });

  it("only ever reads and changes the contact it is given", async () => {
    const otherId = randomUUID();
    const otherEmail = `other-${tag}@example.test`;
    await db.insert(audienceContacts).values({ id: otherId, email: otherEmail, emailNormalised: otherEmail, emailStatus: "subscribed", tags: [], metadata: {} });
    try {
      await setEmailSubscription(db, { userId, contactId: otherId }, { territoryId: sutton, subscribed: true });
      // These functions trust the contact id they are handed; the web runtime derives it from the session
      // (see apps/web/lib/parent-runtime.test.ts for the two-parent isolation proof).
      expect((await loadParentAccount(db, parent)).contact.id).toBe(contactId);
      expect((await loadParentAccount(db, { userId, contactId: otherId })).contact.email).toBe(otherEmail);
    } finally {
      await db.delete(audienceConsentEvents).where(eq(audienceConsentEvents.contactId, otherId));
      await db.delete(audienceTerritorySubscriptions).where(eq(audienceTerritorySubscriptions.contactId, otherId));
      await db.delete(audienceContacts).where(eq(audienceContacts.id, otherId));
    }
  });
});
