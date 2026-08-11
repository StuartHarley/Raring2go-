import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { readMarketingCommandCentre } from "../../../../lib/marketing-runtime";
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

    return { command };
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
