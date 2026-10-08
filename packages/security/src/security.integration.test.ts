import { randomUUID } from "node:crypto";
import {
  audienceActivityEvents, audienceConsentEvents, audienceContacts, audiencePreferenceProfiles, audienceSavedContent, audienceSuppressions, audienceTerritorySubscriptions,
  authSessions, authVerificationTokens, createDb, emailCampaignVersions, emailCampaigns, emailDeliveryRecords, emailRecipientSnapshots, fixtureIds, privacyRequests, publicAnalyticsEvents, rateLimitBuckets
} from "@raring2go/db";
import type { PermissionData } from "@raring2go/permissions";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDrizzlePrivacyStore, erasedEmail } from "./privacy/repository";
import { createPrivacyRequest, decideErasure, generateSubjectExport, PrivacyStateError } from "./privacy/service";
import { checkRateLimit, createPostgresRateLimitStore, pruneRateLimitBuckets } from "./rate-limit";
import { enforceRetention } from "./retention";

/** Real SQL for rate limiting, retention and the data-subject workflow. `RUN_DB_TESTS=1 pnpm --filter @raring2go/security test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("security (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const grant = (action: string) => ({ roleId: "hq", permission: { id: `p-${action}`, module: "privacy.request", action }, scope: "network", constraints: {} });
  const permissions: PermissionData = {
    roleAssignments: [
      { id: "a1", userId: fixtureIds.users.superAdmin, roleId: "hq", organisationId: fixtureIds.organisations.hq },
      { id: "a2", userId: fixtureIds.users.workflowAutomation, roleId: "hq", organisationId: fixtureIds.organisations.hq }
    ],
    rolePermissions: ["view", "create", "decide", "export"].map(grant)
  };
  const requester = { userId: fixtureIds.users.superAdmin };
  const approver = { userId: fixtureIds.users.workflowAutomation };
  const events: Array<{ action: string; metadata?: unknown }> = [];
  const audit = { record: async (input: { action: string; metadata?: unknown }) => void events.push(input) };

  const email = `dsar-${tag}@example.com`;
  const bystanderEmail = `bystander-${tag}@example.com`;
  let contactId = "";
  let bystanderId = "";
  let campaignId = "";
  let versionId = "";
  let snapshotId = "";
  const requestIds: string[] = [];
  const sessionIds: string[] = [];
  const tokenIds: string[] = [];
  const analyticsIds: string[] = [];
  const bucketKeys: string[] = [];

  afterAll(async () => {
    if (snapshotId) await db.delete(emailRecipientSnapshots).where(eq(emailRecipientSnapshots.id, snapshotId));
    const contacts = [contactId, bystanderId].filter(Boolean);
    if (contacts.length) {
      await db.delete(emailDeliveryRecords).where(inArray(emailDeliveryRecords.contactId, contacts));
      await db.delete(audienceSuppressions).where(inArray(audienceSuppressions.contactId, contacts));
      await db.delete(audienceConsentEvents).where(inArray(audienceConsentEvents.contactId, contacts));
      await db.delete(audienceTerritorySubscriptions).where(inArray(audienceTerritorySubscriptions.contactId, contacts));
      await db.delete(audienceActivityEvents).where(inArray(audienceActivityEvents.contactId, contacts));
      await db.delete(audienceSavedContent).where(inArray(audienceSavedContent.contactId, contacts));
      await db.delete(audiencePreferenceProfiles).where(inArray(audiencePreferenceProfiles.contactId, contacts));
    }
    if (requestIds.length) await db.delete(privacyRequests).where(inArray(privacyRequests.id, requestIds));
    if (contacts.length) await db.delete(audienceContacts).where(inArray(audienceContacts.id, contacts));
    if (versionId) await db.delete(emailCampaignVersions).where(eq(emailCampaignVersions.id, versionId));
    if (campaignId) await db.delete(emailCampaigns).where(eq(emailCampaigns.id, campaignId));
    if (sessionIds.length) await db.delete(authSessions).where(inArray(authSessions.id, sessionIds));
    if (tokenIds.length) await db.delete(authVerificationTokens).where(inArray(authVerificationTokens.id, tokenIds));
    if (analyticsIds.length) await db.delete(publicAnalyticsEvents).where(inArray(publicAnalyticsEvents.id, analyticsIds));
    if (bucketKeys.length) await db.delete(rateLimitBuckets).where(inArray(rateLimitBuckets.key, bucketKeys));
    await sql.end();
  });

  it("counts atomically across concurrent callers and shares state through the database", async () => {
    const store = createPostgresRateLimitStore(db);
    const rule = { name: `itest:${tag}`, limit: 5, windowSeconds: 600, onStoreError: "deny" as const };
    const decisions = await Promise.all(Array.from({ length: 12 }, () => checkRateLimit(store, rule, "203.0.113.7")));
    expect(decisions.filter((d) => d.allowed)).toHaveLength(5);
    expect(decisions.filter((d) => !d.allowed)).toHaveLength(7);
    const rows = await db.select().from(rateLimitBuckets);
    const mine = rows.filter((row) => row.count === 12 && row.windowStart.getTime() % 600_000 === 0);
    expect(mine.length).toBeGreaterThan(0);
    bucketKeys.push(...mine.map((row) => row.key));
    // Nothing identifying is stored.
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
  });

  it("deletes only expired security data and keeps everything still inside its retention window", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const user = fixtureIds.users.franchisee;
    const inserted = await db
      .insert(authSessions)
      .values([
        { userId: user, sessionTokenHash: `old-${tag}`, expiresAt: days(40) },
        { userId: user, sessionTokenHash: `revoked-${tag}`, expiresAt: new Date(now.getTime() + 86_400_000), revokedAt: days(31) },
        { userId: user, sessionTokenHash: `recent-${tag}`, expiresAt: days(5) },
        { userId: user, sessionTokenHash: `live-${tag}`, expiresAt: new Date(now.getTime() + 86_400_000) }
      ])
      .returning({ id: authSessions.id, hash: authSessions.sessionTokenHash });
    sessionIds.push(...inserted.map((row) => row.id));
    const tokens = await db
      .insert(authVerificationTokens)
      .values([
        { identifier: "x", tokenHash: `tok-old-${tag}`, purpose: "sign_in", expiresAt: days(10) },
        { identifier: "x", tokenHash: `tok-live-${tag}`, purpose: "sign_in", expiresAt: new Date(now.getTime() + 600_000) }
      ])
      .returning({ id: authVerificationTokens.id, hash: authVerificationTokens.tokenHash });
    tokenIds.push(...tokens.map((row) => row.id));
    const [territory] = [fixtureIds.territories.suttonColdfield];
    const analytics = await db
      .insert(publicAnalyticsEvents)
      .values([
        { eventType: "territory_viewed", territoryId: territory, path: "/x", occurredAt: days(600), retainUntil: days(1) },
        { eventType: "territory_viewed", territoryId: territory, path: "/y", occurredAt: days(1), retainUntil: new Date(now.getTime() + 86_400_000) }
      ])
      .returning({ id: publicAnalyticsEvents.id, path: publicAnalyticsEvents.path });
    analyticsIds.push(...analytics.map((row) => row.id));

    const result = await enforceRetention(db, now);
    expect(result.auth_sessions).toBeGreaterThanOrEqual(2);
    expect(result.public_analytics_events).toBeGreaterThanOrEqual(1);

    const surviving = (await db.select({ hash: authSessions.sessionTokenHash }).from(authSessions).where(inArray(authSessions.id, sessionIds))).map((row) => row.hash);
    expect(surviving.sort()).toEqual([`live-${tag}`, `recent-${tag}`].sort());
    expect((await db.select({ hash: authVerificationTokens.tokenHash }).from(authVerificationTokens).where(inArray(authVerificationTokens.id, tokenIds))).map((row) => row.hash)).toEqual([`tok-live-${tag}`]);
    expect((await db.select({ path: publicAnalyticsEvents.path }).from(publicAnalyticsEvents).where(inArray(publicAnalyticsEvents.id, analyticsIds))).map((row) => row.path)).toEqual(["/y"]);
    // Re-running is safe and finds nothing more of ours.
    const again = await enforceRetention(db, now);
    expect(again.auth_verification_tokens).toBe(0);
    await pruneRateLimitBuckets(db, new Date(0));
  });

  it("exports and then erases a subscriber across every table, leaving other people untouched", async () => {
    const [contact] = await db.insert(audienceContacts).values({ email, emailNormalised: email, firstName: "Sam", lastName: "Subject", tags: ["vip"], metadata: { note: "private" } }).returning();
    const [bystander] = await db.insert(audienceContacts).values({ email: bystanderEmail, emailNormalised: bystanderEmail, firstName: "Bea", lastName: "Stander" }).returning();
    contactId = contact!.id;
    bystanderId = bystander!.id;
    const territoryId = fixtureIds.territories.suttonColdfield;
    const at = new Date("2026-09-01T10:00:00Z");

    await db.insert(audienceTerritorySubscriptions).values([{ contactId, territoryId, status: "subscribed", preferences: { topics: ["x"] }, subscribedAt: at }, { contactId: bystanderId, territoryId, status: "subscribed", subscribedAt: at }]);
    await db.insert(audienceConsentEvents).values({ contactId, territoryId, consentType: "marketing_email", action: "granted", source: "web", occurredAt: at, evidence: { ip: "198.51.100.5", userAgent: "UA" } });
    await db.insert(audienceActivityEvents).values([{ contactId, activityType: "email_open", title: "Opened", occurredAt: at }, { contactId: bystanderId, activityType: "email_open", title: "Opened", occurredAt: at }]);
    await db.insert(audienceSavedContent).values({ contactId, contentType: "article", title: "Saved thing", savedAt: at });
    await db.insert(audiencePreferenceProfiles).values({ contactId, interests: ["soft play"] });

    const [campaign] = await db.insert(emailCampaigns).values({ title: `DSAR test ${tag}`, subject: "s" }).returning();
    campaignId = campaign!.id;
    const [version] = await db.insert(emailCampaignVersions).values({ campaignId, versionNumber: 1, subject: "s" }).returning();
    versionId = version!.id;
    await db.insert(emailDeliveryRecords).values([
      { campaignId, campaignVersionId: versionId, contactId, emailNormalised: email, status: "delivered", metadata: { messageStream: "x" } },
      { campaignId, campaignVersionId: versionId, contactId: bystanderId, emailNormalised: bystanderEmail, status: "delivered" }
    ]);
    const [snapshot] = await db
      .insert(emailRecipientSnapshots)
      .values({
        campaignId, campaignVersionId: versionId, generatedAt: at, idempotencyKey: `dsar-${tag}`, recipientCount: 3,
        recipients: [
          { contactId: bystanderId, emailNormalised: bystanderEmail, firstName: "Bea", lastName: "Stander" },
          { contactId, emailNormalised: email, firstName: "Sam", lastName: "Subject" },
          { contactId: randomUUID(), emailNormalised: "third@example.com", firstName: "Third", lastName: null }
        ]
      })
      .returning();
    snapshotId = snapshot!.id;

    const store = createDrizzlePrivacyStore(db);

    // Export
    const exportRequest = (await createPrivacyRequest(requester, permissions, audit, store, { kind: "export", email: ` ${email.toUpperCase()} ` })).request;
    requestIds.push(exportRequest.id);
    expect(exportRequest.subjectContactId).toBe(contactId);
    const { bundle, request: exported } = await generateSubjectExport(requester, permissions, audit, store, exportRequest.id);
    expect(exported.status).toBe("completed");
    expect(bundle.contact).toMatchObject({ email, firstName: "Sam" });
    expect(bundle.subscriptions).toHaveLength(1);
    expect(bundle.consentEvents).toHaveLength(1);
    expect(bundle.activity).toHaveLength(1);
    expect(bundle.savedContent).toHaveLength(1);
    expect(bundle.preferences).toMatchObject({ interests: ["soft play"] });
    expect(bundle.emailDeliveries).toHaveLength(1);
    // Nothing about anyone else leaks into the export.
    expect(JSON.stringify(bundle)).not.toContain(bystanderEmail);
    expect(JSON.stringify(bundle)).not.toContain("Bea");

    // Erasure: requires a second person
    const erasure = (await createPrivacyRequest(requester, permissions, audit, store, { kind: "erasure", email })).request;
    requestIds.push(erasure.id);
    await expect(decideErasure(requester, permissions, audit, store, erasure.id, "approve", null)).rejects.toBeInstanceOf(PrivacyStateError);
    expect((await db.select().from(audienceContacts).where(eq(audienceContacts.id, contactId)))[0]!.email).toBe(email);

    const [first, second] = await Promise.allSettled([
      db.transaction(async (tx) => decideErasure(approver, permissions, audit, createDrizzlePrivacyStore(tx as unknown as typeof db), erasure.id, "approve", "verified")),
      db.transaction(async (tx) => decideErasure(approver, permissions, audit, createDrizzlePrivacyStore(tx as unknown as typeof db), erasure.id, "approve", "verified"))
    ]);
    // Concurrent approvals: exactly one erases, the other is refused cleanly.
    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);

    const placeholder = erasedEmail(contactId);
    const [after] = await db.select().from(audienceContacts).where(eq(audienceContacts.id, contactId));
    expect(after).toMatchObject({ email: placeholder, emailNormalised: placeholder, firstName: null, lastName: null, emailStatus: "erased", tags: [], metadata: {} });
    expect(after!.deletedAt).not.toBeNull();

    expect(await db.select().from(audienceActivityEvents).where(eq(audienceActivityEvents.contactId, contactId))).toHaveLength(0);
    expect(await db.select().from(audienceSavedContent).where(eq(audienceSavedContent.contactId, contactId))).toHaveLength(0);
    expect(await db.select().from(audiencePreferenceProfiles).where(eq(audiencePreferenceProfiles.contactId, contactId))).toHaveLength(0);
    const [subscription] = await db.select().from(audienceTerritorySubscriptions).where(eq(audienceTerritorySubscriptions.contactId, contactId));
    expect(subscription).toMatchObject({ status: "unsubscribed", preferences: {} });
    const [consent] = await db.select().from(audienceConsentEvents).where(eq(audienceConsentEvents.contactId, contactId));
    expect(consent).toMatchObject({ consentType: "marketing_email", action: "granted", evidence: {} });
    const [delivery] = await db.select().from(emailDeliveryRecords).where(eq(emailDeliveryRecords.contactId, contactId));
    expect(delivery).toMatchObject({ emailNormalised: placeholder, metadata: {}, status: "delivered" });

    // The address survives only on the suppression list, so they cannot be silently re-subscribed.
    const suppressions = await db.select().from(audienceSuppressions).where(eq(audienceSuppressions.contactId, contactId));
    expect(suppressions.some((row) => row.active && row.emailNormalised === email && row.reason === "erasure_request")).toBe(true);

    // The frozen send list is rewritten for this person only, and order is unchanged.
    const [snap] = await db.select().from(emailRecipientSnapshots).where(eq(emailRecipientSnapshots.id, snapshotId));
    expect(snap!.recipients).toEqual([
      { contactId: bystanderId, emailNormalised: bystanderEmail, firstName: "Bea", lastName: "Stander" },
      { contactId, emailNormalised: placeholder, firstName: null, lastName: null },
      { contactId: expect.any(String), emailNormalised: "third@example.com", firstName: "Third", lastName: null }
    ]);
    expect(JSON.stringify(snap!.recipients)).not.toContain(email);

    // The other subscriber is untouched.
    const [other] = await db.select().from(audienceContacts).where(eq(audienceContacts.id, bystanderId));
    expect(other).toMatchObject({ email: bystanderEmail, firstName: "Bea", emailStatus: "subscribed" });
    expect(await db.select().from(audienceActivityEvents).where(eq(audienceActivityEvents.contactId, bystanderId))).toHaveLength(1);

    // The request records what was erased, and holds a hash rather than the address.
    const [settled] = await db.select().from(privacyRequests).where(eq(privacyRequests.id, erasure.id));
    expect(settled).toMatchObject({ status: "completed", decidedByUserId: approver.userId });
    expect(settled!.resultSummary).toMatchObject({ erased: { contact: 1, activity: 1 } });
    expect(JSON.stringify(settled)).not.toContain(email);
    expect(JSON.stringify(events)).not.toContain(email);

    // After erasure the address is no longer found, so asking again answers "no data held".
    const repeat = await createPrivacyRequest(requester, permissions, audit, store, { kind: "erasure", email });
    requestIds.push(repeat.request.id);
    expect(repeat.request).toMatchObject({ status: "completed", subjectContactId: null });
  });
});
