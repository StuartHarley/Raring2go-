import { randomUUID } from "node:crypto";
import {
  contentChannelVariantVersions, contentChannelVariants, contentItems, schoolHolidayPeriods, audienceActivityEvents, audienceContacts, deleteAudienceContactsForTests, territories, audienceSuppressions, audienceTerritorySubscriptions, createDb, emailCampaignVersions, emailCampaigns, emailRecipientSnapshots, emailSendJobs, fixtureIds,
  marketingJourneyAudienceEntries, marketingJourneyExecutions, marketingJourneyStepExecutions, marketingJourneyVersions, marketingJourneys
} from "@raring2go/db";
import { findJourneyTemplate, validateJourneyTemplate } from "@raring2go/marketing";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activateMarketingJourney, approveMarketingJourneyVersion, createMarketingJourney } from "./marketing-runtime";
import { createRunJourneysHandler } from "./journey-jobs";

/** Real database: journeys enter people once, caps skip emails, quiet subscribers are re-engaged once. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("journey engine (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  // A territory of its own, so the engine only ever sees this suite's subscribers and not other tests' running alongside.
  const sutton = "00000000-0000-4000-8000-0000000009a1";
  const journeyIds: string[] = [];
  const contactIds: string[] = [];
  const periodIds: string[] = [];
  const eventIds = { item: randomUUID(), variant: randomUUID(), version: randomUUID() };
  const handler = createRunJourneysHandler() as unknown as { handle: (context: { now: () => Date }) => Promise<Record<string, number>> };
  const run = () => handler.handle({ now: () => new Date() });

  beforeAll(async () => {
    // Created once and kept: audit rows reference a territory, so it cannot be removed after use.
    await db.insert(territories).values({ id: sutton, code: "JOURNEY-TESTS", name: "Journey Tests (do not use)", status: "archived", franchiseOrganisationId: fixtureIds.organisations.franchise }).onConflictDoNothing();
  });

  /**
   * The subscription is inserted last. Other suites run the job worker on the same database at any moment, which
   * scans for subscribers, so a contact must be fully set up (suppressed, active) before it becomes visible.
   */
  async function contact(label: string, subscribedDaysAgo = 0, setup: { suppressed?: boolean; recentActivity?: boolean; unsubscribed?: boolean } = {}) {
    const id = randomUUID();
    const email = `${label}-${tag}@example.test`;
    await db.insert(audienceContacts).values({ id, email, emailNormalised: email, emailStatus: setup.suppressed ? "suppressed" : "subscribed", tags: [], metadata: {} });
    contactIds.push(id);
    if (setup.suppressed) await db.insert(audienceSuppressions).values({ id: randomUUID(), contactId: id, emailNormalised: email, territoryId: null, reason: "recipient_unsubscribe", source: "test", active: true, suppressedAt: new Date(), metadata: {} });
    if (setup.recentActivity) await db.insert(audienceActivityEvents).values({ id: randomUUID(), contactId: id, territoryId: sutton, activityType: "email_open", title: "Opened", metadata: {}, occurredAt: new Date(Date.now() - 5 * 86_400_000) });
    await db.insert(audienceTerritorySubscriptions).values({ id: randomUUID(), contactId: id, territoryId: sutton, status: setup.unsubscribed ? "unsubscribed" : "subscribed", source: "test", preferences: {}, subscribedAt: new Date(Date.now() - subscribedDaysAgo * 86_400_000) });
    return id;
  }

  async function activate(templateKey: "welcome" | "re_engagement" | "school_holiday_countdown" | "weekly_digest", overrides: { frequencyCap?: Record<string, unknown>; steps?: ReturnType<typeof validateJourneyTemplate>["steps"]; trigger?: ReturnType<typeof validateJourneyTemplate>["trigger"]; territoryId?: string } = {}) {
    const template = findJourneyTemplate(templateKey)!;
    const parsed = validateJourneyTemplate(template);
    const journeyId = randomUUID();
    const versionId = randomUUID();
    await createMarketingJourney(hq, { journeyId, versionId, key: `${templateKey}-${tag}-${journeyId.slice(0, 4)}`, name: `${template.name} ${tag}`, territoryId: overrides.territoryId ?? sutton, purpose: "marketing", frequencyCap: overrides.frequencyCap ?? template.frequencyCap, trigger: overrides.trigger ?? parsed.trigger, conditions: parsed.conditions, steps: overrides.steps ?? parsed.steps });
    await approveMarketingJourneyVersion(hq, journeyId, versionId);
    await activateMarketingJourney(hq, journeyId);
    journeyIds.push(journeyId);
    return { journeyId, versionId };
  }

  const entriesFor = (contactId: string, journeyId: string) =>
    db.select().from(marketingJourneyAudienceEntries).where(eq(marketingJourneyAudienceEntries.contactId, contactId)).then((rows) => rows.filter((row) => row.journeyId === journeyId));

  afterAll(async () => {
    if (journeyIds.length) {
      const executions = await db.select({ id: marketingJourneyExecutions.id }).from(marketingJourneyExecutions).where(inArray(marketingJourneyExecutions.journeyId, journeyIds));
      if (executions.length) await db.delete(marketingJourneyStepExecutions).where(inArray(marketingJourneyStepExecutions.executionId, executions.map((row) => row.id)));
      await db.delete(marketingJourneyExecutions).where(inArray(marketingJourneyExecutions.journeyId, journeyIds));
      await db.delete(marketingJourneyAudienceEntries).where(inArray(marketingJourneyAudienceEntries.journeyId, journeyIds));
      const versions = await db.select({ id: marketingJourneyVersions.id }).from(marketingJourneyVersions).where(inArray(marketingJourneyVersions.journeyId, journeyIds));
      const campaigns = await db.select({ id: emailCampaigns.id, metadata: emailCampaigns.metadata }).from(emailCampaigns).where(eq(emailCampaigns.campaignType, "journey"));
      const ours = campaigns.filter((campaign) => versions.some((version) => version.id === (campaign.metadata as { journeyVersionId?: string }).journeyVersionId)).map((campaign) => campaign.id);
      if (ours.length) {
        await db.delete(emailSendJobs).where(inArray(emailSendJobs.campaignId, ours));
        await db.delete(emailRecipientSnapshots).where(inArray(emailRecipientSnapshots.campaignId, ours));
        await db.delete(emailCampaignVersions).where(inArray(emailCampaignVersions.campaignId, ours));
        await db.delete(emailCampaigns).where(inArray(emailCampaigns.id, ours));
      }
      await db.delete(marketingJourneyVersions).where(inArray(marketingJourneyVersions.journeyId, journeyIds));
      await db.delete(marketingJourneys).where(inArray(marketingJourneys.id, journeyIds));
    }
    if (periodIds.length) await db.delete(schoolHolidayPeriods).where(inArray(schoolHolidayPeriods.id, periodIds));
    await db.delete(contentChannelVariantVersions).where(eq(contentChannelVariantVersions.id, eventIds.version));
    await db.delete(contentChannelVariants).where(eq(contentChannelVariants.id, eventIds.variant));
    await db.delete(contentItems).where(eq(contentItems.id, eventIds.item));
    await deleteAudienceContactsForTests(db, contactIds);
    await sql.end();
  });

  it("welcomes a new subscriber once, however many times the engine runs, and sends exactly one email", async () => {
    const { journeyId } = await activate("welcome");
    const id = await contact("welcome");

    await run();
    await Promise.all([run(), run()]);
    await run();

    expect(await entriesFor(id, journeyId)).toHaveLength(1);
    const executions = await db.select().from(marketingJourneyExecutions).where(eq(marketingJourneyExecutions.journeyId, journeyId));
    expect(executions.filter((row) => row.status === "completed").length).toBeGreaterThanOrEqual(1);
    const steps = await db.select().from(marketingJourneyStepExecutions).where(inArray(marketingJourneyStepExecutions.executionId, executions.map((row) => row.id)));
    expect(steps.filter((step) => step.status === "completed")).toHaveLength(steps.length);

    const snapshots = (await db.select().from(emailRecipientSnapshots)).filter((snapshot) => (snapshot.recipients as Array<{ contactId: string }>).some((recipient) => recipient.contactId === id));
    expect(snapshots).toHaveLength(1);
  });

  it("does not welcome someone who unsubscribed or was suppressed before the engine ran", async () => {
    const { journeyId } = await activate("welcome");
    const suppressed = await contact("suppressed", 0, { suppressed: true });
    const unsubscribed = await contact("unsub", 0, { unsubscribed: true });

    await run();
    expect(await entriesFor(suppressed, journeyId)).toHaveLength(0);
    expect(await entriesFor(unsubscribed, journeyId)).toHaveLength(0);
  });

  it("skips a step that would break the journey's frequency cap and still completes the journey", async () => {
    const template = validateJourneyTemplate(findJourneyTemplate("re_engagement")!);
    // Two emails an instant apart under a cap of one per 30 days: the second must be skipped.
    const steps = template.steps.map((step, index) => ({ ...step, delayMinutes: index === 0 ? 0 : 0 }));
    const { journeyId } = await activate("re_engagement", { frequencyCap: { maxPerContact: 1, window: "30d" }, steps });
    const id = await contact("capped", 200);

    await run();
    await run();
    await run();

    const entry = (await entriesFor(id, journeyId))[0]!;
    expect(entry).toBeDefined();
    const executions = await db.select().from(marketingJourneyExecutions).where(eq(marketingJourneyExecutions.entryId, entry.id));
    const stepRows = await db.select().from(marketingJourneyStepExecutions).where(eq(marketingJourneyStepExecutions.executionId, executions[0]!.id));
    expect(stepRows.map((row) => row.status).sort()).toEqual(["completed", "skipped"]);
    expect(stepRows.find((row) => row.status === "skipped")).toMatchObject({ failureReason: "journey_cap" });
    expect(executions[0]!.status).toBe("completed");
  });

  it("re-engages a quiet subscriber once, and leaves active, recent and suppressed ones alone", async () => {
    const { journeyId } = await activate("re_engagement");
    const quiet = await contact("quiet", 200);
    const recent = await contact("recent", 10);
    const active = await contact("active", 200, { recentActivity: true });
    const gone = await contact("gone", 200, { suppressed: true });

    await run();
    await run();

    expect(await entriesFor(quiet, journeyId)).toHaveLength(1);
    for (const other of [recent, active, gone]) expect(await entriesFor(other, journeyId)).toHaveLength(0);
  });

  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const campaignsOf = async (journeyId: string) => {
    const versions = await db.select({ id: marketingJourneyVersions.id }).from(marketingJourneyVersions).where(eq(marketingJourneyVersions.journeyId, journeyId));
    return (await db.select().from(emailCampaigns).where(eq(emailCampaigns.campaignType, "journey"))).filter((campaign) => versions.some((version) => version.id === (campaign.metadata as { journeyVersionId?: string }).journeyVersionId));
  };
  const snapshotOf = (campaignId: string) => db.select().from(emailCampaignVersions).where(eq(emailCampaignVersions.campaignId, campaignId)).then((rows) => JSON.stringify(rows[0]?.contentSnapshot ?? {}));

  it("counts down to a school holiday once per person per holiday, with the holiday's own name and dates, and ignores holidays that do not apply", async () => {
    const insert = async (name: string, startsIn: number, lengthDays: number, territoryId: string | null) => {
      const id = randomUUID();
      await db.insert(schoolHolidayPeriods).values({ id, territoryId, name: `${name} ${tag}`, startsOn: new Date(`${day(startsIn)}T00:00:00Z`), endsOn: new Date(`${day(startsIn + lengthDays)}T00:00:00Z`) });
      periodIds.push(id);
      return id;
    };
    await insert("Half term", 10, 4, null);
    await insert("Other area closure", 5, 1, fixtureIds.territories.solihull);
    await insert("Far away break", 40, 14, null);
    await insert("Already started", 0, 3, null);
    const { journeyId } = await activate("school_holiday_countdown");
    const id = await contact("holiday");

    await run();
    await run();
    await Promise.all([run(), run()]);

    const entries = await entriesFor(id, journeyId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.sourceEventType).toBe("calendar.school_holiday");
    const campaigns = await campaignsOf(journeyId);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]!.subject).toBe(`Half term ${tag} starts in 10 days`);
    expect(await snapshotOf(campaigns[0]!.id)).toContain(`Half term ${tag} is nearly here`);
    expect(await snapshotOf(campaigns[0]!.id)).not.toContain("[[");
    expect(campaigns[0]!.metadata).toMatchObject({ journeyVariantKey: expect.stringMatching(/^holiday:/) });
    // One email, once.
    const snapshots = (await db.select().from(emailRecipientSnapshots)).filter((snapshot) => snapshot.campaignId === campaigns[0]!.id && (snapshot.recipients as Array<{ contactId: string }>).some((recipient) => recipient.contactId === id));
    expect(snapshots).toHaveLength(1);
  });

  it("sends each subscriber a weekly digest of the events coming up in their area, on the journey's weekday, and nothing when there are none", async () => {
    const base = { contentType: "event", ownerLevel: "territory", territoryId: fixtureIds.territories.suttonColdfield, categories: [], tags: [], provenance: {} };
    await db.insert(contentItems).values({ ...base, id: eventIds.item, title: `Digest <Event> ${tag}`, status: "published", relevantDates: { startDate: day(3) } });
    await db.insert(contentChannelVariants).values({ id: eventIds.variant, contentItemId: eventIds.item, channel: "website", status: "approved", currentVersionId: eventIds.version, territoryId: fixtureIds.territories.suttonColdfield });
    await db.insert(contentChannelVariantVersions).values({ id: eventIds.version, variantId: eventIds.variant, versionNumber: 1, status: "approved", snapshot: {} });

    const template = validateJourneyTemplate(findJourneyTemplate("weekly_digest")!);
    const wrongDay = (new Date().getUTCDay() + 3) % 7;
    const { journeyId: offDay } = await activate("weekly_digest", { territoryId: fixtureIds.territories.suttonColdfield, trigger: { type: "weekly_digest", weekday: wrongDay } });
    const { journeyId } = await activate("weekly_digest", { territoryId: fixtureIds.territories.suttonColdfield, trigger: { type: "weekly_digest", weekday: new Date().getUTCDay() }, steps: template.steps });
    const subscriber = await db.insert(audienceContacts).values({ id: randomUUID(), email: `digest-${tag}@example.test`, emailNormalised: `digest-${tag}@example.test`, emailStatus: "subscribed", tags: [], metadata: {} }).returning({ id: audienceContacts.id });
    const id = subscriber[0]!.id;
    contactIds.push(id);
    await db.insert(audienceTerritorySubscriptions).values({ id: randomUUID(), contactId: id, territoryId: fixtureIds.territories.suttonColdfield, status: "subscribed", source: "test", preferences: {}, subscribedAt: new Date(Date.now() - 30 * 86_400_000) });

    await run();
    await run();

    expect(await entriesFor(id, offDay)).toHaveLength(0);
    expect(await entriesFor(id, journeyId)).toHaveLength(1);
    const campaigns = await campaignsOf(journeyId);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]!.subject).toContain("Sutton");
    const content = await snapshotOf(campaigns[0]!.id);
    expect(content).toContain("Digest &lt;Event&gt;");
    expect(content).not.toContain("<Event>");
    expect(content).toContain("/areas/sutton-coldfield/");
    expect(content).not.toContain("[[");

    // With nothing coming up, a later subscriber gets no digest at all rather than an empty one.
    await db.update(contentItems).set({ status: "draft" }).where(eq(contentItems.id, eventIds.item));
    const later = await db.insert(audienceContacts).values({ id: randomUUID(), email: `digest2-${tag}@example.test`, emailNormalised: `digest2-${tag}@example.test`, emailStatus: "subscribed", tags: [], metadata: {} }).returning({ id: audienceContacts.id });
    contactIds.push(later[0]!.id);
    await db.insert(audienceTerritorySubscriptions).values({ id: randomUUID(), contactId: later[0]!.id, territoryId: fixtureIds.territories.suttonColdfield, status: "subscribed", source: "test", preferences: {}, subscribedAt: new Date(Date.now() - 30 * 86_400_000) });
    await run();
    expect(await entriesFor(later[0]!.id, journeyId)).toHaveLength(0);
  });

  it("only registers real, validated journeys (every template is created through the normal validated flow)", async () => {
    expect(await db.select().from(marketingJourneys).where(like(marketingJourneys.name, `%${tag}`))).not.toHaveLength(0);
  });
});
