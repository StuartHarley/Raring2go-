import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { listNetworkTerritories, readMarketingAnalytics } from "../../../../lib/marketing-runtime";
import { readContentEngagement } from "../../../../lib/marketing-insights";
import { displayName, formatCount, formatDateTime, formatLabel } from "../../../../lib/format";
import { EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordCard, RecordList, Table } from "../../../../lib/page-ui";
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

  const { analytics, engagement, territories } = result;
  const show = (tracked: boolean, value: number) => (tracked ? value : "Not tracked yet");
  const reported = (value: number | undefined) => (value === undefined ? "not reported" : String(value));
  const areaName = (territoryId: string | null | undefined) =>
    territoryId ? displayName(territories.find((territory) => territory.id === territoryId)?.name, "Area not named yet") : "Whole network";

  return (
    <AppShell request={request}>
      <PageHeader
        eyebrow="Marketing"
        title="Marketing analytics"
        intro="How your audience, newsletters, journeys and social posts are performing, from what the platform records plus provider figures where they exist."
        actions={
          <LinkButton href={"/app/marketing-command" as Route} variant="secondary">
            Command centre
          </LinkButton>
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Active subscribers", value: analytics.audience.activeSubscribers },
            { label: "Emails delivered", value: analytics.email.delivered },
            { label: "Journey entries", value: analytics.journeys.entries },
            { label: "Social posts published", value: analytics.social.published }
          ]}
        />
      </Panel>

      <Panel eyebrow="Channels" title="Channel health" id="channels">
        <RecordList>
          <RecordCard
            title="Email"
            tone={analytics.email.failed > 0 ? "danger" : "success"}
            status={analytics.email.failed > 0 ? "failures" : "healthy"}
            lines={[
              `${formatCount(analytics.email.sends, "send")} · ${analytics.email.failed} failed`,
              `Opens ${reported(analytics.email.opens)} · Clicks ${reported(analytics.email.clicks)}`
            ]}
          />
          <RecordCard
            title="Journeys"
            tone={analytics.journeys.failed > 0 ? "danger" : "success"}
            status={analytics.journeys.failed > 0 ? "failures" : "healthy"}
            lines={[`${analytics.journeys.completed} completed · ${analytics.journeys.failed} failed · ${analytics.journeys.dropOff} dropped off`]}
          />
          <RecordCard
            title="Social"
            tone={analytics.social.failed > 0 ? "danger" : "success"}
            status={analytics.social.failed > 0 ? "failures" : "healthy"}
            lines={[`${analytics.social.scheduled} scheduled · ${analytics.social.published} published · ${analytics.social.failed} failed`]}
          />
        </RecordList>
      </Panel>

      <Panel eyebrow="Campaigns" title="Sent campaigns" id="campaigns">
        {analytics.email.campaigns.length === 0 ? (
          <EmptyState title="No sent campaigns yet">Delivery and engagement figures appear here once a newsletter has gone out.</EmptyState>
        ) : (
          <RecordList>
            {analytics.email.campaigns.map((campaign) => (
              <RecordCard
                key={campaign.campaignId}
                title={campaign.title}
                lines={[
                  campaign.sentAt ? `Sent ${formatDateTime(campaign.sentAt)}` : null,
                  campaign.trackingAvailable
                    ? `${campaign.delivered} delivered · ${campaign.failed} failed · Opens ${reported(campaign.opens)} · Clicks ${reported(campaign.clicks)}`
                    : "Sent via Outlook - delivery, bounce and open tracking is not available for this campaign"
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Attribution" title="Trackable references" id="attribution">
        {analytics.attribution.length === 0 ? (
          <EmptyState title="Nothing to attribute yet" />
        ) : (
          <Table caption="Metrics recorded per channel and where each figure comes from">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">Metric</th>
                <th scope="col">Source</th>
                <th scope="col">Area</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {analytics.attribution.map((item) => (
                <tr key={`${item.channel}-${item.metric}-${item.territoryId ?? "network"}`}>
                  <th scope="row">{formatLabel(item.channel)}</th>
                  <td>{formatLabel(item.metric)}</td>
                  <td>{formatLabel(item.source)}</td>
                  <td>{areaName(item.territoryId)}</td>
                  <td>{item.value}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel eyebrow="Content engagement" title={`What families read and click in the last ${engagement.windowDays} days`} id="engagement">
        <Metrics
          items={[
            { label: "Area page views", value: show(engagement.tracked.views, engagement.totals.territoryViews) },
            { label: "Content views", value: show(engagement.tracked.views, engagement.totals.contentViews) },
            { label: "Content clicks", value: show(engagement.tracked.clicks, engagement.totals.contentClicks) },
            { label: "Sponsored clicks", value: show(engagement.tracked.clicks, engagement.totals.placementClicks) },
            { label: "Newsletter sign-ups", value: show(engagement.tracked.signups, engagement.totals.signupsCompleted) }
          ]}
        />
      </Panel>

      <Panel eyebrow="Content engagement" title="Top content" id="top-content">
        {engagement.topContent.length === 0 ? (
          <EmptyState title="No content activity recorded yet">Views and clicks appear here once families start reading published content.</EmptyState>
        ) : (
          <RecordList>
            {engagement.topContent.map((item) => (
              <RecordCard key={item.contentId} title={item.title} lines={[`${formatCount(item.views, "view")} · ${formatCount(item.clicks, "click")}`]} />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel
        eyebrow="Content engagement"
        title="Where visits come from"
        intro="Credited from campaign tags (utm_source) on the landing link. Visits with no tag are shown as direct or unknown."
        id="sources"
      >
        {engagement.attribution.length === 0 ? (
          <EmptyState title="No visits recorded yet" />
        ) : (
          <Table caption="Visits by campaign source">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Visits</th>
                <th scope="col">Content views</th>
                <th scope="col">Sign-ups</th>
              </tr>
            </thead>
            <tbody>
              {engagement.attribution.map((item) => (
                <tr key={item.source}>
                  <th scope="row">{formatLabel(item.source)}</th>
                  <td>{item.visits}</td>
                  <td>{item.contentViews}</td>
                  <td>{item.signups}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel eyebrow="Content engagement" title="Not measured" intro="Figures we do not collect yet, so they are never shown as zero." id="not-measured">
        <ul>
          {engagement.notTracked.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Panel>
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

    const territories = await listNetworkTerritories();

    return { analytics, engagement, territories };
  } catch (error) {
    return { error };
  }
}
