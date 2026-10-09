import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { readMarketingCommandCentre } from "../../../../lib/marketing-runtime";
import { readMarketingExtras } from "../../../../lib/marketing-insights";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MarketingCommandPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadCommandCentre(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const command = result.command;
  const extras = result.extras;

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Marketing command centre</p>
        <h2>Network operating view</h2>
        <p>
          Audience, newsletter, journey and social health in one place, scoped
          by the active organisation and territory context.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Subscribers</span>
            <strong>{command.analytics.audience.activeSubscribers}</strong>
          </article>
          <article>
            <span>Actions</span>
            <strong>{command.actionItems.length}</strong>
          </article>
          <article>
            <span>Territories</span>
            <strong>{command.territoryHealth.length}</strong>
          </article>
          <article>
            <span>Failed runs</span>
            <strong>{command.analytics.journeys.failed}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Action queue</p>
        <h2>Territories needing attention</h2>
        <div className="franchise-list">
          {command.actionItems.length === 0 ? (
            <div>
              <strong>No marketing exceptions</strong>
              <span>Known channel and automation records are healthy.</span>
            </div>
          ) : (
            command.actionItems.map((item) => (
              <div key={item.id}>
                <strong>{item.title}</strong>
                <span>{item.severity} - {item.source} - {item.territoryId ?? "network"}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Territory health</p>
        <h2>Coverage</h2>
        <div className="franchise-list">
          {command.territoryHealth.map((territory) => (
            <div key={territory.territoryId}>
              <strong>{territory.territoryId}</strong>
              <span>
                {territory.subscribers} subscribers - {territory.upcomingNewsletterSends} newsletter sends -{" "}
                {territory.activeJourneys} active journeys - {territory.scheduledSocial} social posts
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Send exceptions</p>
        <h2>Newsletters that need attention</h2>
        {extras.sendExceptions.length === 0 ? <p>No failed, overdue or bouncing sends.</p> : (
          <div className="franchise-list">
            {extras.sendExceptions.map((item) => (
              <div key={item.campaignId}><strong>{item.title}</strong><span>{item.problem} - {item.territoryId ?? "network"}</span></div>
            ))}
          </div>
        )}
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Content</p>
        <h2>Gaps and top content</h2>
        {extras.contentGaps.length === 0 ? <p>Every territory has published in the last 30 days.</p> : (
          <div className="franchise-list">
            {extras.contentGaps.map((gap) => (
              <div key={gap.territoryId}><strong>{gap.territoryName}</strong><span>Nothing published in the last 30 days</span></div>
            ))}
          </div>
        )}
        <h3>Top content (30 days)</h3>
        {extras.topContent.length === 0 ? <p>No content activity recorded yet.</p> : (
          <div className="franchise-list">
            {extras.topContent.map((item) => (
              <div key={item.contentId}><strong>{item.title}</strong><span>{item.views} views - {item.clicks} clicks</span></div>
            ))}
          </div>
        )}
      </section>

      {extras.advertiserObligations ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Advertiser obligations</p>
          <h2>Booked work still to deliver</h2>
          {extras.advertiserObligations.length === 0 ? <p>No outstanding artwork or fulfilment.</p> : (
            <div className="franchise-list">
              {extras.advertiserObligations.map((row) => (
                <div key={row.territoryId}><strong>{row.territoryName}</strong><span>{row.artworkOutstanding} artwork outstanding - {row.fulfilmentOutstanding} fulfilments open</span></div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Optimisation opportunities</p>
        <h2>Suggestions, not actions</h2>
        <p>These come from the gaps above. Nothing is generated or published until a person starts it and approves the result.</p>
        {extras.aiOpportunities.length === 0 ? <p>No opportunities right now.</p> : (
          <div className="franchise-list">
            {extras.aiOpportunities.map((item) => (
              <div key={item.id}><strong>{item.title}</strong><span>{item.reason}</span></div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
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

    return { command, extras };
  } catch (error) {
    return { error };
  }
}

function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return (
      <main className={`app-outcome app-outcome-${error.kind}`}>
        <section>
          <p className="eyebrow">{error.kind.replace("_", " ")}</p>
          <h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1>
          <p>{error.message}</p>
        </section>
      </main>
    );
  }

  throw error;
}
