import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { listNetworkTerritories, readMarketingCommandCentre } from "../../../../lib/marketing-runtime";
import { readMarketingExtras } from "../../../../lib/marketing-insights";
import { displayName, formatCount, formatLabel } from "../../../../lib/format";
import { EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordCard, RecordList, Table } from "../../../../lib/page-ui";
import type { Tone } from "../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../page";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Marketing overview" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SEVERITY_TONE: Record<string, Tone> = { critical: "danger", warning: "warning", info: "info" };

export default async function MarketingCommandPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadCommandCentre(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { command, extras, territories } = result;
  const areaName = (territoryId: string | null | undefined) =>
    territoryId ? displayName(territories.find((territory) => territory.id === territoryId)?.name, "Area not named yet") : "Whole network";

  return (
    <>
      <PageHeader
        eyebrow="Marketing"
        title="Marketing overview"
        intro="How audience, newsletters, journeys and social are doing across the areas you look after, and what needs attention first."
        actions={
          <>
            <LinkButton href={"/app/marketing-analytics" as Route}>Open analytics</LinkButton>
            <LinkButton href={"/app/newsletters" as Route} variant="secondary">
              Newsletters
            </LinkButton>
            <LinkButton href={"/app/journeys" as Route} variant="secondary">
              Journeys
            </LinkButton>
          </>
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Subscribers", value: command.analytics.audience.activeSubscribers },
            { label: "Needs attention", value: command.actionItems.length, tone: command.actionItems.length > 0 ? "warning" : "success" },
            { label: "Areas", value: command.territoryHealth.length },
            { label: "Failed journey runs", value: command.analytics.journeys.failed, tone: command.analytics.journeys.failed > 0 ? "danger" : "success" }
          ]}
        />
      </Panel>

      <Panel eyebrow="Action queue" title="What needs attention" id="actions">
        {command.actionItems.length === 0 ? (
          <EmptyState title="Nothing needs attention">Audience, newsletter, journey and social records are all healthy.</EmptyState>
        ) : (
          <RecordList>
            {command.actionItems.map((item) => (
              <RecordCard
                key={item.id}
                title={item.title}
                status={item.severity}
                tone={SEVERITY_TONE[item.severity]}
                lines={[`${formatLabel(item.source)} · ${areaName(item.territoryId)}`]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Area health" title="Coverage by area" id="coverage">
        {command.territoryHealth.length === 0 ? (
          <EmptyState title="No areas in scope">Area health appears here once a territory has audience or marketing activity.</EmptyState>
        ) : (
          <Table caption="Audience and marketing activity by area">
            <thead>
              <tr>
                <th scope="col">Area</th>
                <th scope="col">Subscribers</th>
                <th scope="col">Upcoming newsletter sends</th>
                <th scope="col">Active journeys</th>
                <th scope="col">Failed journey runs</th>
                <th scope="col">Scheduled social posts</th>
              </tr>
            </thead>
            <tbody>
              {command.territoryHealth.map((territory) => (
                <tr key={territory.territoryId}>
                  <th scope="row">{areaName(territory.territoryId)}</th>
                  <td>{territory.subscribers}</td>
                  <td>{territory.upcomingNewsletterSends}</td>
                  <td>{territory.activeJourneys}</td>
                  <td>{territory.failedJourneyRuns}</td>
                  <td>{territory.scheduledSocial}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel eyebrow="Send exceptions" title="Newsletters that need attention" id="send-exceptions">
        {extras.sendExceptions.length === 0 ? (
          <EmptyState title="No send problems">No newsletter has failed, missed its scheduled time or bounced heavily.</EmptyState>
        ) : (
          <RecordList>
            {extras.sendExceptions.map((item) => (
              <RecordCard key={item.campaignId} title={item.title} lines={[item.problem, areaName(item.territoryId)]} />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Content" title="Areas with nothing published recently" id="content-gaps">
        {extras.contentGaps.length === 0 ? (
          <EmptyState title="Every area has published in the last 30 days" />
        ) : (
          <RecordList>
            {extras.contentGaps.map((gap) => (
              <RecordCard key={gap.territoryId} title={displayName(gap.territoryName, "Area not named yet")} lines={["Nothing published in the last 30 days"]} />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Content" title="Top content in the last 30 days" id="top-content">
        {extras.topContent.length === 0 ? (
          <EmptyState title="No content activity recorded yet">Views and clicks appear here once families start reading published content.</EmptyState>
        ) : (
          <RecordList>
            {extras.topContent.map((item) => (
              <RecordCard key={item.contentId} title={item.title} lines={[`${formatCount(item.views, "view")} · ${formatCount(item.clicks, "click")}`]} />
            ))}
          </RecordList>
        )}
      </Panel>

      {extras.advertiserObligations ? (
        <Panel eyebrow="Advertisers" title="Booked work still to deliver" id="obligations">
          {extras.advertiserObligations.length === 0 ? (
            <EmptyState title="Nothing outstanding">No artwork or fulfilment is waiting on any area.</EmptyState>
          ) : (
            <Table caption="Outstanding advertiser work by area">
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  <th scope="col">Artwork outstanding</th>
                  <th scope="col">Fulfilments open</th>
                </tr>
              </thead>
              <tbody>
                {extras.advertiserObligations.map((row) => (
                  <tr key={row.territoryId}>
                    <th scope="row">{displayName(row.territoryName, "Area not named yet")}</th>
                    <td>{row.artworkOutstanding}</td>
                    <td>{row.fulfilmentOutstanding}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      ) : null}

      <Panel
        eyebrow="Suggestions"
        title="Things worth doing next"
        intro="These come from the gaps above. Nothing is generated or published until a person starts it and approves the result."
        id="opportunities"
      >
        {extras.aiOpportunities.length === 0 ? (
          <EmptyState title="No suggestions right now" />
        ) : (
          <RecordList>
            {extras.aiOpportunities.map((item) => (
              <RecordCard key={item.id} title={item.title} lines={[item.reason]} />
            ))}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

async function loadCommandCentre(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.analytics",
      action: "view"
    });
    const command = await readMarketingCommandCentre({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    const extras = await readMarketingExtras({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    const territories = await listNetworkTerritories();

    return { command, extras, territories };
  } catch (error) {
    return { error };
  }
}
