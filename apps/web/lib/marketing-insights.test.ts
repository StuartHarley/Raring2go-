import { randomUUID } from "node:crypto";
import { collectMetrics } from "@raring2go/analytics";
import { createDb, fixtureIds, publicAnalyticsEvents } from "@raring2go/db";
import { sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCommercialCommandCentre } from "./advertising-runtime";
import { InsightAccessError, readContentEngagement, readMarketingExtras } from "./marketing-insights";


/** Real database: engagement and command-centre insight come from real records, scoped to the actor's territories. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("marketing insight (postgres)", () => {
  const { db, sql } = createDb();
  const tag = `ins${randomUUID().slice(0, 8)}`;
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const contentA = `content-${tag}-a`;
  const contentB = `content-${tag}-b`;
  const now = new Date();
  const event = (territoryId: string, eventType: string, entityId: string | null, attribution: Record<string, unknown> = {}) => ({
    eventType, territoryId, path: "/areas/test", entityType: entityId ? "content" : null, entityId, attribution, metadata: {}, privacy: {},
    occurredAt: now, retainUntil: new Date(now.getTime() + 86_400_000)
  });

  beforeAll(async () => {
    await db.insert(publicAnalyticsEvents).values([
      ...Array.from({ length: 5 }, () => event(fixtureIds.territories.suttonColdfield, "content_viewed", contentA, { utmSource: `${tag}-newsletter` })),
      ...Array.from({ length: 2 }, () => event(fixtureIds.territories.suttonColdfield, "discovery_item_clicked", contentA)),
      event(fixtureIds.territories.suttonColdfield, "content_viewed", contentB),
      event(fixtureIds.territories.suttonColdfield, "newsletter_signup_completed", null, { utmSource: `${tag}-newsletter` }),
      // Another territory's activity must never reach a Sutton franchisee.
      ...Array.from({ length: 4 }, () => event(fixtureIds.territories.solihull, "content_viewed", `content-${tag}-solihull`, { utmSource: `${tag}-solihull-ad` }))
    ]);
  });

  afterAll(async () => {
    await db.delete(publicAnalyticsEvents).where(dsql`${publicAnalyticsEvents.entityId} like ${`content-${tag}%`} or ${publicAnalyticsEvents.attribution}->>'utmSource' like ${`${tag}%`}`);
    await sql.end();
  });

  it("reports clicks, views and campaign-credited visits from real events", async () => {
    const engagement = await readContentEngagement(hq, now);
    const a = engagement.topContent.find((item) => item.contentId === contentA);
    expect(a).toMatchObject({ views: 5, clicks: 2 });
    expect(engagement.tracked).toMatchObject({ views: true, clicks: true, signups: true });
    const newsletter = engagement.attribution.find((row) => row.source === `${tag}-newsletter`);
    expect(newsletter).toMatchObject({ contentViews: 5, signups: 1 });
    expect(engagement.notTracked.length).toBeGreaterThan(0);
  });

  it("never shows a territory user another territory's activity, but the network sees both", async () => {
    const local = await readContentEngagement(sutton, now);
    expect(JSON.stringify(local)).not.toContain(tag + "-solihull");
    expect(local.attribution.some((row) => row.source === `${tag}-newsletter`)).toBe(true);
    const network = await readContentEngagement(hq, now);
    expect(network.attribution.some((row) => row.source === `${tag}-solihull-ad`)).toBe(true);
  });

  it("refuses insight to someone with no marketing analytics permission", async () => {
    await expect(readContentEngagement({ userId: randomUUID(), organisationId: fixtureIds.organisations.hq }, now)).rejects.toBeInstanceOf(InsightAccessError);
    await expect(readMarketingExtras({ userId: randomUUID(), organisationId: fixtureIds.organisations.hq }, now)).rejects.toBeInstanceOf(InsightAccessError);
  });

  it("builds the command-centre extras from records, scoped, without inventing AI output", async () => {
    const network = await readMarketingExtras(hq, now);
    expect(Array.isArray(network.sendExceptions)).toBe(true);
    for (const gap of network.contentGaps) expect(network.aiOpportunities.some((item) => item.territoryId === gap.territoryId)).toBe(true);
    expect(network.aiOpportunities.every((item) => /person|review/i.test(item.reason))).toBe(true);
    const local = await readMarketingExtras(sutton, now);
    expect(local.contentGaps.every((gap) => gap.territoryId === fixtureIds.territories.suttonColdfield)).toBe(true);
    expect((local.advertiserObligations ?? []).every((row) => row.territoryId === fixtureIds.territories.suttonColdfield)).toBe(true);
  });

  it("gives the same churn and sales mix on the command centre as the analytics catalogue", async () => {
    const collected = await collectMetrics(db, now);
    const centre = await readCommercialCommandCentre(hq);
    expect(centre.churn.baseAYearAgo).toBe(collected.network["commercial.customer_base_12m_ago"]);
    expect(centre.churn.lost).toBe(collected.network["commercial.churned_12m"]);
    expect(centre.churn.ratePercent).toBe(collected.network["commercial.churn_rate_12m"]);
    expect(centre.mix.soldMinor).toBe(collected.network["commercial.sold_value_90d"]);
    expect(centre.mix.packageMinor).toBe(collected.network["commercial.package_value_90d"]);
    expect(centre.mix.digitalMinor).toBe(collected.network["commercial.digital_value_90d"]);
  });
});
