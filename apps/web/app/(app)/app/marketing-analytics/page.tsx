import { requireShellPermission } from "../../../../lib/app-shell";
import { readMarketingAnalytics } from "../../../../lib/marketing-runtime";
import { readContentEngagement } from "../../../../lib/marketing-insights";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Marketing analytics" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MarketingAnalyticsPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadAnalytics(request);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const analytics = result.analytics;
  const engagement = result.engagement;
  const show = (tracked: boolean, value: number) => (tracked ? String(value) : "Not tracked yet");

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Marketing analytics</p>
        <h2>Audience and channel performance</h2>
        <p>
          Reporting derived from platform records, with provider-reported
          metrics shown only when available.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Audience</span>
            <strong>{analytics.audience.activeSubscribers}</strong>
          </article>
          <article>
            <span>Email delivered</span>
            <strong>{analytics.email.delivered}</strong>
          </article>
          <article>
            <span>Journey entries</span>
            <strong>{analytics.journeys.entries}</strong>
          </article>
          <article>
            <span>Social published</span>
            <strong>{analytics.social.published}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Channel health</p>
        <h2>Known metrics</h2>
        <div className="franchise-list">
          <div>
            <strong>Email</strong>
            <span>
              {analytics.email.sends} sends - {analytics.email.failed} failed - opens{" "}
              {analytics.email.opens ?? "not reported"} - clicks {analytics.email.clicks ?? "not reported"}
            </span>
          </div>
          <div>
            <strong>Journeys</strong>
            <span>
              {analytics.journeys.completed} completed - {analytics.journeys.failed} failed -{" "}
              {analytics.journeys.dropOff} drop-off
            </span>
          </div>
          <div>
            <strong>Social</strong>
            <span>
              {analytics.social.scheduled} scheduled - {analytics.social.published} published -{" "}
              {analytics.social.failed} failed
            </span>
          </div>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Campaign performance</p>
        <h2>Sent campaigns</h2>
        <div className="franchise-list">
          {analytics.email.campaigns.length === 0 ? (
            <div>
              <span>No sent campaigns in scope yet.</span>
            </div>
          ) : (
            analytics.email.campaigns.map((campaign) => (
              <div key={campaign.campaignId}>
                <strong>{campaign.title}</strong>
                {campaign.trackingAvailable ? (
                  <span>
                    {campaign.delivered} delivered - {campaign.failed} failed - opens{" "}
                    {campaign.opens ?? "not reported"} - clicks {campaign.clicks ?? "not reported"}
                  </span>
                ) : (
                  <span>Sent via Outlook - delivery, bounce and open tracking is not available for this campaign</span>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Attribution foundation</p>
        <h2>Trackable references</h2>
        <div className="franchise-list">
          {analytics.attribution.map((item) => (
            <div key={`${item.channel}-${item.metric}-${item.territoryId ?? "network"}`}>
              <strong>{item.channel} / {item.metric}</strong>
              <span>{item.source} - {item.territoryId ?? "network"} - {item.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Content engagement</p>
        <h2>What families read and click (last {engagement.windowDays} days)</h2>
        <div className="franchise-metrics">
          <article><span>Area page views</span><strong>{show(engagement.tracked.views, engagement.totals.territoryViews)}</strong></article>
          <article><span>Content views</span><strong>{show(engagement.tracked.views, engagement.totals.contentViews)}</strong></article>
          <article><span>Content clicks</span><strong>{show(engagement.tracked.clicks, engagement.totals.contentClicks)}</strong></article>
          <article><span>Sponsored clicks</span><strong>{show(engagement.tracked.clicks, engagement.totals.placementClicks)}</strong></article>
          <article><span>Newsletter sign-ups</span><strong>{show(engagement.tracked.signups, engagement.totals.signupsCompleted)}</strong></article>
          <article><span>Items saved</span><strong>{show(engagement.tracked.saves, engagement.totals.saves)}</strong></article>
          <article><span>Magazine opens</span><strong>{show(engagement.tracked.magazine, engagement.totals.magazineOpens)}</strong></article>
          <article><span>Magazine page turns</span><strong>{show(engagement.tracked.magazine, engagement.totals.magazinePageTurns)}</strong></article>
        </div>
        <h3>Top content</h3>
        {engagement.topContent.length === 0 ? <p>No content activity recorded yet.</p> : (
          <div className="franchise-list">
            {engagement.topContent.map((item) => (
              <div key={item.contentId}><strong>{item.title}</strong><span>{item.views} views - {item.clicks} clicks</span></div>
            ))}
          </div>
        )}
        <h3>Where visits come from</h3>
        <p>Credited from campaign tags (utm_source) on the landing link. Visits with no tag are shown as direct or unknown.</p>
        {engagement.attribution.length === 0 ? <p>No visits recorded yet.</p> : (
          <div className="franchise-list">
            {engagement.attribution.map((item) => (
              <div key={item.source}><strong>{item.source}</strong><span>{item.visits} visits - {item.contentViews} content views - {item.signups} sign-ups</span></div>
            ))}
          </div>
        )}
        <h3>Not measured</h3>
        <ul>{engagement.notTracked.map((note) => <li key={note}>{note}</li>)}</ul>
      </section>
    </AppShell>
  );
}

async function loadAnalytics(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.analytics",
      action: "view"
    });
    const analytics = await readMarketingAnalytics({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    const engagement = await readContentEngagement({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { analytics, engagement };
  } catch (error) {
    return { error };
  }
}
