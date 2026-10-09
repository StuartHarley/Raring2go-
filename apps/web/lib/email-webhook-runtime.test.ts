import { randomUUID } from "node:crypto";
import { audienceContacts, audienceSuppressions, createDb, emailCampaignVersions, emailCampaigns, emailDeliveryRecords, webhookEventClaims } from "@raring2go/db";
import type { EmailDeliveryEvent } from "@raring2go/email";
import { claimWebhookEvent } from "@raring2go/security";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processDeliveryEvents } from "./email-webhook-runtime";

const tag = randomUUID().slice(0, 8);
const provider = `itest-${tag}`;
const messageId = `msg-${tag}`;
const email = `webhook-${tag}@example.com`;
const ids = { contact: randomUUID(), campaign: randomUUID(), version: randomUUID() };

const event = (eventId: string, eventType: EmailDeliveryEvent["eventType"], message = messageId, occurredAt = new Date("2026-10-08T10:00:00Z")): EmailDeliveryEvent => ({ providerKey: provider, providerMessageId: message, eventId, eventType, occurredAt, recipientEmail: email, metadata: eventType === "bounced" ? { type: "HardBounce" } : {} });

/** Real database: durable webhook idempotency. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("email webhook idempotency (postgres)", () => {
  async function seedOriginal() {
    const { db, sql } = createDb();
    await db.insert(emailDeliveryRecords).values({ campaignId: ids.campaign, campaignVersionId: ids.version, contactId: ids.contact, emailNormalised: email, providerKey: provider, providerMessageId: messageId, status: "queued" });
    await sql.end();
  }
  beforeAll(async () => {
    const { db, sql } = createDb();
    await db.insert(audienceContacts).values({ id: ids.contact, email, emailNormalised: email });
    await db.insert(emailCampaigns).values({ id: ids.campaign, title: `Webhook ${tag}`, subject: "s" });
    await db.insert(emailCampaignVersions).values({ id: ids.version, campaignId: ids.campaign, versionNumber: 1, subject: "s" });
    await sql.end();
  });

  afterAll(async () => {
    const { db, sql } = createDb();
    await db.delete(webhookEventClaims).where(eq(webhookEventClaims.providerKey, provider));
    await db.delete(emailDeliveryRecords).where(eq(emailDeliveryRecords.providerKey, provider));
    await db.delete(audienceSuppressions).where(eq(audienceSuppressions.contactId, ids.contact));
    await db.delete(audienceContacts).where(eq(audienceContacts.id, ids.contact));
    await db.delete(emailCampaignVersions).where(eq(emailCampaignVersions.id, ids.version));
    await db.delete(emailCampaigns).where(eq(emailCampaigns.id, ids.campaign));
    await sql.end();
  });

  it("claims an event for exactly one of many simultaneous callers", async () => {
    const { db, sql } = createDb();
    try {
      const results = await Promise.all(Array.from({ length: 10 }, () => claimWebhookEvent(db, { providerKey: provider, eventId: "race-1", eventType: "delivered" })));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await claimWebhookEvent(db, { providerKey: provider, eventId: "race-1" })).toBe(false);
      expect(await claimWebhookEvent(db, { providerKey: `${provider}-other`, eventId: "race-1" })).toBe(true);
      await db.delete(webhookEventClaims).where(inArray(webhookEventClaims.providerKey, [`${provider}-other`]));
    } finally {
      await sql.end();
    }
  });

  it("does not claim an event for a message it cannot find, so the provider's retry works once the record exists", async () => {
    const first = await processDeliveryEvents(provider, [event("evt-early", "delivered")]);
    expect(first).toEqual({ persisted: 0, duplicate: 0, unmatched: 1 });
    await seedOriginal();
    const retry = await processDeliveryEvents(provider, [event("evt-early", "delivered")]);
    expect(retry).toEqual({ persisted: 1, duplicate: 0, unmatched: 0 });
  });

  it("processes the same event once even when it arrives many times at once (as on different instances)", async () => {
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => processDeliveryEvents(provider, [event("evt-dupe", "delivered")])));
    expect(outcomes.reduce((sum, outcome) => sum + outcome.persisted, 0)).toBe(1);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.duplicate, 0)).toBe(5);
    const { db, sql } = createDb();
    const claims = await db.select().from(webhookEventClaims).where(eq(webhookEventClaims.eventId, "evt-dupe"));
    await sql.end();
    expect(claims).toHaveLength(1);
  });

  it("rolls the claim back with the work when processing fails, so the retry is processed", async () => {
    await expect(processDeliveryEvents(provider, [event("evt-broken", "delivered", messageId, new Date("invalid"))])).rejects.toThrow();
    const { db, sql } = createDb();
    const claims = await db.select().from(webhookEventClaims).where(eq(webhookEventClaims.eventId, "evt-broken"));
    await sql.end();
    expect(claims).toHaveLength(0);
    expect(await processDeliveryEvents(provider, [event("evt-broken", "delivered")])).toMatchObject({ persisted: 1 });
  });

  it("applies a bounce once: the contact is suppressed and a repeat changes nothing more", async () => {
    expect(await processDeliveryEvents(provider, [event("evt-bounce", "bounced")])).toMatchObject({ persisted: 1 });
    expect(await processDeliveryEvents(provider, [event("evt-bounce", "bounced")])).toMatchObject({ persisted: 0, duplicate: 1 });
    const { db, sql } = createDb();
    const suppressions = await db.select().from(audienceSuppressions).where(eq(audienceSuppressions.contactId, ids.contact));
    const [contact] = await db.select().from(audienceContacts).where(eq(audienceContacts.id, ids.contact));
    await sql.end();
    expect(suppressions.filter((row) => row.active)).toHaveLength(1);
    expect(contact!.emailStatus).toBe("suppressed");
  });
});
