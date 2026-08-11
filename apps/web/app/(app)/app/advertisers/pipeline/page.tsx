import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readPipeline } from "../../../../../lib/advertising-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdvertiserPipelinePage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadPipeline(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Commercial pipeline</p>
        <h2>Opportunities</h2>
        <p>Territory-aware lead and opportunity management with configurable stages.</p>
        <div className="franchise-metrics">
          <article>
            <span>Open stages</span>
            <strong>{result.pipeline.stages.length}</strong>
          </article>
          <article>
            <span>Overdue follow-ups</span>
            <strong>{result.pipeline.overdueFollowUps.length}</strong>
          </article>
          <article>
            <span>Closing soon</span>
            <strong>{result.pipeline.closingSoon.length}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Kanban</p>
        <h2>Pipeline by stage</h2>
        <div className="franchise-facts">
          {result.pipeline.stages.map((stage) => (
            <div key={stage.stage.id}>
              <dt>{stage.stage.name}</dt>
              <dd>{stage.opportunities.length} opportunities</dd>
              <small>{formatMoney(stage.weightedValueMinor)} weighted</small>
            </div>
          ))}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Attention</p>
        <h2>Follow-ups</h2>
        <div className="franchise-list">
          {result.pipeline.overdueFollowUps.map((view) => (
            <div key={view.opportunity.id}>
              <strong>{view.opportunity.title}</strong>
              <span>{view.organisation.name} - next action {view.opportunity.nextActionDate}</span>
              <span>{formatMoney(view.opportunity.estimatedValueMinor)} at {view.opportunity.probability}%</span>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function loadPipeline(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "advertiser.opportunity",
      action: "view"
    });
    const pipeline = await readPipeline({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { pipeline };
  } catch (error) {
    return { error };
  }
}

function formatMoney(valueMinor: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(valueMinor / 100);
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
