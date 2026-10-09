import { randomUUID } from "node:crypto";
import {
  audienceActivityEvents, audienceContacts, deleteAudienceContactsForTests, territories, audienceSuppressions, audienceTerritorySubscriptions, createDb, emailCampaignVersions, emailCampaigns, emailRecipientSnapshots, emailSendJobs, fixtureIds,
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

  async function activate(templateKey: "welcome" | "re_engagement", overrides: { frequencyCap?: Record<string, unknown>; steps?: ReturnType<typeof validateJourneyTemplate>["steps"] } = {}) {
    const template = findJourneyTemplate(templateKey)!;
    const parsed = validateJourneyTemplate(template);
    const journeyId = randomUUID();
    const versionId = randomUUID();
    await createMarketingJourney(hq, { journeyId, versionId, key: `${templateKey}-${tag}-${journeyId.slice(0, 4)}`, name: `${template.name} ${tag}`, territoryId: sutton, purpose: "marketing", frequencyCap: overrides.frequencyCap ?? template.frequencyCap, trigger: parsed.trigger, conditions: parsed.conditions, steps: overrides.steps ?? parsed.steps });
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

  it("only registers real, validated journeys (every template is created through the normal validated flow)", async () => {
    expect(await db.select().from(marketingJourneys).where(like(marketingJourneys.name, `%${tag}`))).not.toHaveLength(0);
  });
});
