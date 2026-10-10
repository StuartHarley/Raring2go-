import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readPipeline } from "../../../../../lib/advertising-runtime";
import { AppShell } from "../../../layout";
import { CrmBanner } from "../CrmBanner";
import { ScoreBadge } from "../ScoreBadge";
import { createOpportunityAction, moveOpportunityStageAction, updateOpportunityAction } from "../actions";
import { listAdvertiser360Rows } from "../../../../../lib/advertising-runtime";
import { requestFromSearchParamsAndCookies } from "../../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdvertiserPipelinePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const resultCode = Array.isArray(params.result) ? params.result[0] : params.result;
  const result = await loadPipeline(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const ranked = result.pipeline.stages
    .flatMap((stage) => stage.opportunities)
    .sort((a, b) => (b.score?.score ?? -1) - (a.score?.score ?? -1) || b.opportunity.estimatedValueMinor - a.opportunity.estimatedValueMinor)
    .slice(0, 10);

  return (
    <AppShell request={request}>
      <CrmBanner result={resultCode} />
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
        <p className="eyebrow">New</p>
        <h2>Add an opportunity</h2>
        {result.advertisers.length === 0 ? (
          <p>Create an advertiser first, then add an opportunity for them.</p>
        ) : (
          <form action={createOpportunityAction.bind(null, request)} className="franchise-form">
            <label>
              Advertiser
              <select name="advertiserId" required>
                {result.advertisers.map((row) => <option key={row.advertiser.id} value={row.advertiser.id}>{row.organisation.name}</option>)}
              </select>
            </label>
            <label>
              Stage
              <select name="stageId" required>
                {result.pipeline.stages.filter((stage) => !stage.stage.isClosed).map((stage) => <option key={stage.stage.id} value={stage.stage.id}>{stage.stage.name}</option>)}
              </select>
            </label>
            <label>What are they interested in?<input name="title" required maxLength={160} /></label>
            <label>Estimated value (£)<input name="value" type="number" min="0" step="0.01" required /></label>
            <label>Expected close<input name="expectedCloseDate" type="date" /></label>
            <label>Next action<input name="nextAction" maxLength={160} /></label>
            <label>Next action date<input name="nextActionDate" type="date" /></label>
            <button type="submit">Add opportunity</button>
          </form>
        )}
      </section>

      <section id="priorities" className="app-panel franchise-panel" aria-label="Priorities">
        <p className="eyebrow">Priorities</p>
        <h2>Where to spend today</h2>
        <p>Open opportunities ranked by score. Open a score to see exactly what is behind it.</p>
        <div className="franchise-list">
          {ranked.length === 0 ? <p>No open opportunities.</p> : null}
          {ranked.map((view) => (
            <div key={view.opportunity.id}>
              <strong>{view.opportunity.title}</strong>
              <span>{view.organisation.name} - {formatMoney(view.opportunity.estimatedValueMinor)} - {view.stage.name}</span>
              <ScoreBadge score={view.score} />
            </div>
          ))}
        </div>
      </section>

      {result.pipeline.stages.map((stage) => (
        <section key={stage.stage.id} className="app-panel franchise-panel">
          <p className="eyebrow">{stage.stage.name}</p>
          <h2>{stage.opportunities.length} open</h2>
          {stage.opportunities.length === 0 ? <p>Nothing at this stage.</p> : null}
          <div className="franchise-list">
            {stage.opportunities.map((view) => (
              <div key={view.opportunity.id}>
                <strong>{view.opportunity.title}</strong>
                <span>{view.organisation.name} - {formatMoney(view.opportunity.estimatedValueMinor)} at {view.opportunity.probability}% - {view.attention.replaceAll("_", " ")}</span>
                <ScoreBadge score={view.score} />
                <span>Next: {view.opportunity.nextAction ?? "none set"} {view.opportunity.nextActionDate ? `(${view.opportunity.nextActionDate})` : ""}</span>
                <form action={moveOpportunityStageAction.bind(null, request, view.opportunity.id)} className="franchise-form">
                  <label>
                    Move to
                    <select name="stageId" defaultValue={view.stage.id}>
                      {result.stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                  </label>
                  <label>If lost, why?<input name="lostReason" maxLength={200} /></label>
                  <button type="submit">Move</button>
                </form>
                <form action={updateOpportunityAction.bind(null, request, view.opportunity.id)} className="franchise-form">
                  <label>Next action<input name="nextAction" defaultValue={view.opportunity.nextAction ?? ""} maxLength={160} /></label>
                  <label>Next action date<input name="nextActionDate" type="date" defaultValue={view.opportunity.nextActionDate ?? ""} /></label>
                  <button type="submit">Update</button>
                </form>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Attention</p>
        <h2>Follow-ups</h2>
        <div className="franchise-list">
          {result.pipeline.overdueFollowUps.length === 0 ? <p>No overdue follow-ups.</p> : null}
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
    const actor = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const pipeline = await readPipeline(actor);
    // The form lists whichever advertisers this user can see; a person without that access simply gets an empty list.
    const advertisers = await listAdvertiser360Rows(actor).catch(() => []);

    return { pipeline, advertisers, stages: pipeline.stages.map((stage) => stage.stage) };
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
