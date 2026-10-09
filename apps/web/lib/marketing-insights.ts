import { createDb } from "@raring2go/db";
import { marketingCapabilities } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";
import { evaluatePermission } from "@raring2go/permissions";
import { advertisingCapabilities } from "@raring2go/advertising";
import { sql } from "drizzle-orm";
import { getPermissionData } from "./permission-source";

/**
 * Cross-channel marketing insight (MKT-008, MKT-009), derived only from records that exist. A metric with no
 * source yet is reported as not tracked, never as zero or an estimate. Every query is scoped to the territories
 * the actor is allowed to see; a territory-scoped actor never receives another territory's rows.
 */
export class InsightAccessError extends Error {
  constructor() {
    super("Not allowed to view marketing insight.");
  }
}

export const ENGAGEMENT_WINDOW_DAYS = 30;

type Scope = { network: boolean; territoryIds: string[] };

async function scopeFor(context: MarketingActorContext): Promise<Scope> {
  const permissions = await getPermissionData();
  const { module, action } = marketingCapabilities.analyticsView;
  const check = (territoryId?: string | null) =>
    evaluatePermission({ userId: context.userId, module, action, context: { organisationId: context.organisationId ?? undefined, territoryId: territoryId ?? undefined } }, permissions).allowed;
  if (!context.territoryId && evaluatePermission({ userId: context.userId, module, action }, permissions).allowed) return { network: true, territoryIds: [] };
  if (context.territoryId && check(context.territoryId)) return { network: false, territoryIds: [context.territoryId] };
  throw new InsightAccessError();
}

/** A SQL fragment limiting `column` to the actor's territories. */
const territoryFilter = (column: string, scope: Scope) =>
  scope.network ? sql`true` : sql`${sql.raw(column)} = ANY(${sql`ARRAY[${sql.join(scope.territoryIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})`;

type Row = Record<string, unknown>;
const rowsOf = (result: unknown) => result as Row[];

export type ContentEngagement = {
  windowDays: number;
  /** Which event kinds have ever been recorded in the window, so an absent metric reads "not tracked", not 0. */
  tracked: { views: boolean; clicks: boolean; signups: boolean };
  totals: { territoryViews: number; contentViews: number; contentClicks: number; placementClicks: number; signupsCompleted: number };
  topContent: Array<{ contentId: string; title: string; views: number; clicks: number }>;
  attribution: Array<{ source: string; visits: number; contentViews: number; signups: number }>;
  notTracked: string[];
};

export async function readContentEngagement(context: MarketingActorContext, now: Date = new Date()): Promise<ContentEngagement> {
  const scope = await scopeFor(context);
  const since = new Date(now.getTime() - ENGAGEMENT_WINDOW_DAYS * 86_400_000).toISOString();
  const { db, sql: client } = createDb();
  try {
    const totalsRows = rowsOf(await db.execute(sql`
      select event_type, count(*)::int as n from public_analytics_events
      where occurred_at >= ${since}::timestamptz and ${territoryFilter("territory_id", scope)}
      group by event_type`));
    const count = (type: string) => Number(totalsRows.find((row) => row.event_type === type)?.n ?? 0);

    const topRows = rowsOf(await db.execute(sql`
      select e.entity_id, coalesce(ci.title, 'Removed content') as title,
        count(*) filter (where e.event_type = 'content_viewed')::int as views,
        count(*) filter (where e.event_type = 'discovery_item_clicked')::int as clicks
      from public_analytics_events e
      left join content_items ci on ci.id::text = e.entity_id
      where e.entity_type = 'content' and e.event_type in ('content_viewed', 'discovery_item_clicked')
        and e.occurred_at >= ${since}::timestamptz and ${territoryFilter("e.territory_id", scope)}
      group by e.entity_id, ci.title
      order by (count(*)) desc, title asc limit 10`));

    const attributionRows = rowsOf(await db.execute(sql`
      select coalesce(nullif(attribution->>'utmSource', ''), nullif(attribution->>'source', ''), 'direct or unknown') as source,
        count(*) filter (where event_type = 'territory_viewed')::int as visits,
        count(*) filter (where event_type = 'content_viewed')::int as content_views,
        count(*) filter (where event_type = 'newsletter_signup_completed')::int as signups
      from public_analytics_events
      where occurred_at >= ${since}::timestamptz and ${territoryFilter("territory_id", scope)}
      group by 1 order by (count(*)) desc, 1 asc limit 15`));

    const contentViews = count("content_viewed");
    const contentClicks = count("discovery_item_clicked");
    const signups = count("newsletter_signup_completed");
    return {
      windowDays: ENGAGEMENT_WINDOW_DAYS,
      tracked: { views: contentViews + count("territory_viewed") > 0, clicks: contentClicks + count("commercial_placement_clicked") > 0, signups: signups > 0 },
      totals: { territoryViews: count("territory_viewed"), contentViews, contentClicks, placementClicks: count("commercial_placement_clicked"), signupsCompleted: signups },
      topContent: topRows.map((row) => ({ contentId: String(row.entity_id), title: String(row.title), views: Number(row.views), clicks: Number(row.clicks) })),
      attribution: attributionRows.map((row) => ({ source: String(row.source), visits: Number(row.visits), contentViews: Number(row.content_views), signups: Number(row.signups) })),
      notTracked: [
        "Impressions (how often a card was shown), so no click-through rate is reported.",
        "Opens and clicks inside emails sent through providers that do not report them.",
        "Social reach and engagement, which need the provider's own reporting."
      ]
    };
  } finally {
    await client.end();
  }
}

export type MarketingExtras = {
  sendExceptions: Array<{ campaignId: string; territoryId: string | null; title: string; problem: string }>;
  contentGaps: Array<{ territoryId: string; territoryName: string; publishedLast30Days: number }>;
  topContent: ContentEngagement["topContent"];
  advertiserObligations: Array<{ territoryId: string; territoryName: string; artworkOutstanding: number; fulfilmentOutstanding: number }> | null;
  aiOpportunities: Array<{ id: string; territoryId: string; title: string; reason: string }>;
};

export async function readMarketingExtras(context: MarketingActorContext, now: Date = new Date()): Promise<MarketingExtras> {
  const scope = await scopeFor(context);
  const permissions = await getPermissionData();
  const advertiserVisible = (() => {
    const { module, action } = advertisingCapabilities.analyticsView;
    return evaluatePermission({ userId: context.userId, module, action, context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } }, permissions).allowed;
  })();
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { db, sql: client } = createDb();
  try {
    const sendRows = rowsOf(await db.execute(sql`
      select c.id, c.territory_id, c.title, c.status, c.scheduled_at,
        (select count(*) from email_delivery_records d where d.campaign_id = c.id and d.status in ('failed', 'bounced'))::int as failed_deliveries
      from email_campaigns c
      where c.deleted_at is null and ${territoryFilter("c.territory_id", scope)}
        and (c.status = 'failed'
          or (c.status = 'scheduled' and c.scheduled_at < ${now.toISOString()}::timestamptz - interval '15 minutes')
          or (c.status in ('sent', 'sending') and c.sent_at >= ${since30}::timestamptz
              and exists (select 1 from email_delivery_records d where d.campaign_id = c.id and d.status in ('failed', 'bounced'))))
      order by c.created_at desc limit 25`));
    const sendExceptions = sendRows.map((row) => ({
      campaignId: String(row.id),
      territoryId: row.territory_id ? String(row.territory_id) : null,
      title: String(row.title),
      problem: row.status === "failed" ? "The send failed." : row.status === "scheduled" ? "Scheduled time has passed and it has not gone out." : `${Number(row.failed_deliveries)} deliveries failed or bounced.`
    }));

    const gapRows = rowsOf(await db.execute(sql`
      select t.id, t.name,
        (select count(*) from content_items ci where ci.territory_id = t.id and ci.deleted_at is null and ci.status = 'published' and ci.published_at >= ${since30.slice(0, 10)}::date)::int as published
      from territories t
      where t.deleted_at is null and ${territoryFilter("t.id", scope)}
      order by t.name`));
    const contentGaps = gapRows.filter((row) => Number(row.published) === 0).map((row) => ({ territoryId: String(row.id), territoryName: String(row.name), publishedLast30Days: 0 }));

    let advertiserObligations: MarketingExtras["advertiserObligations"] = null;
    if (advertiserVisible) {
      const obligationRows = rowsOf(await db.execute(sql`
        select t.id, t.name,
          (select count(*) from artwork_requirements a where a.territory_id = t.id and a.deleted_at is null and a.status <> 'production_ready')::int as artwork,
          (select count(*) from campaign_fulfilments f where f.territory_id = t.id and f.deleted_at is null and f.status not in ('fulfilled', 'cancelled'))::int as fulfilment
        from territories t where t.deleted_at is null and ${territoryFilter("t.id", scope)} order by t.name`));
      advertiserObligations = obligationRows
        .map((row) => ({ territoryId: String(row.id), territoryName: String(row.name), artworkOutstanding: Number(row.artwork), fulfilmentOutstanding: Number(row.fulfilment) }))
        .filter((row) => row.artworkOutstanding + row.fulfilmentOutstanding > 0);
    }

    // Opportunities are suggestions from the gaps above, never AI output: nothing is generated until a person starts it.
    const aiOpportunities = contentGaps.map((gap) => ({
      id: `content-gap-${gap.territoryId}`,
      territoryId: gap.territoryId,
      title: `Draft local stories for ${gap.territoryName}`,
      reason: "Nothing has been published here in the last 30 days. The content assistant can prepare drafts for a person to review and approve."
    }));

    const engagement = await readContentEngagement(context, now);
    return { sendExceptions, contentGaps, topContent: engagement.topContent.slice(0, 5), advertiserObligations, aiOpportunities };
  } finally {
    await client.end();
  }
}
