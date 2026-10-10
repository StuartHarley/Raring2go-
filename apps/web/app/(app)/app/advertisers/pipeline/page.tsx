import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readPipeline } from "../../../../../lib/advertising-runtime";
import { AppShell } from "../../../layout";
import { CrmBanner } from "../CrmBanner";
import { ScoreBadge } from "../ScoreBadge";
import { createOpportunityAction, moveOpportunityStageAction, updateOpportunityAction } from "../actions";
import { listAdvertiser360Rows } from "../../../../../lib/advertising-runtime";
import { formatCount, formatDate } from "../../../../../lib/format";
import { EmptyState, FactList, LinkButton, Metrics, PageHeader, Panel, RecordCard, RecordList, type Tone } from "../../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Commercial pipeline" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The colour of an opportunity's attention flag: overdue is a problem, closing soon is worth watching. */
const attentionTone: Record<string, Tone> = {
  overdue_follow_up: "danger",
  closing_soon: "warning",
  stale: "warning",
  normal: "neutral"
};

export default async function AdvertiserPipelinePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const resultCode = Array.isArray(params.result) ? params.result[0] : params.result;
  const result = await loadPipeline(request);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const overdue = result.pipeline.overdueFollowUps.length;
  const closingSoon = result.pipeline.closingSoon.length;

  return (
    <AppShell request={request}>
      <CrmBanner result={resultCode} />
      <PageHeader
        eyebrow="Commercial"
        title="Pipeline"
        intro="Every opportunity you are working on, stage by stage, and the follow-ups that have slipped."
        actions={
          <>
            <LinkButton href={"/app/advertisers/pipeline#new" as Route}>Add an opportunity</LinkButton>
            <LinkButton href={"/app/advertisers" as Route} variant="secondary">
              All advertisers
            </LinkButton>
          </>
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Open stages", value: result.pipeline.stages.length },
            { label: "Overdue follow-ups", value: overdue, tone: overdue > 0 ? "danger" : "success" },
            { label: "Closing soon", value: closingSoon, tone: closingSoon > 0 ? "warning" : "neutral" }
          ]}
        />
      </Panel>

      <Panel eyebrow="Overview" title="Pipeline by stage">
        {result.pipeline.stages.length === 0 ? (
          <EmptyState title="No pipeline stages yet">Stages are configured for your area before opportunities can be tracked.</EmptyState>
        ) : (
          <FactList
            items={result.pipeline.stages.map((stage) => ({
              label: stage.stage.name,
              value: `${formatCount(stage.opportunities.length, "opportunity", "opportunities")} · ${formatMoney(stage.weightedValueMinor)} weighted`
            }))}
          />
        )}
      </Panel>

      <Panel eyebrow="New" title="Add an opportunity" id="new">
        {result.advertisers.length === 0 ? (
          <EmptyState title="No advertisers yet" action={<LinkButton href={"/app/advertisers#new" as Route} variant="secondary">Add an advertiser</LinkButton>}>
            Create an advertiser first, then add an opportunity for them.
          </EmptyState>
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
            <button type="submit" className="r2-button r2-button--primary">Add opportunity</button>
          </form>
        )}
      </Panel>

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
        <Panel key={stage.stage.id} eyebrow="Stage" title={stage.stage.name} intro={formatCount(stage.opportunities.length, "open opportunity", "open opportunities")}>
          {stage.opportunities.length === 0 ? (
            <EmptyState title="Nothing at this stage">Opportunities move here when you change their stage below.</EmptyState>
          ) : (
            <RecordList>
              {stage.opportunities.map((view) => (
                <RecordCard
                  key={view.opportunity.id}
                  title={view.opportunity.title}
                  status={view.attention}
                  tone={attentionTone[view.attention]}
                  lines={[
                    `${view.organisation.name} · ${formatMoney(view.opportunity.estimatedValueMinor)} at ${view.opportunity.probability}%`,
                    `Next: ${view.opportunity.nextAction ?? "none set"}${view.opportunity.nextActionDate ? ` (${formatDate(view.opportunity.nextActionDate)})` : ""}`
                  ]}
                >
                  <form action={moveOpportunityStageAction.bind(null, request, view.opportunity.id)} className="franchise-form">
                    <label>
                      Move to
                      <select name="stageId" defaultValue={view.stage.id}>
                        {result.stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select>
                    </label>
                    <label>If lost, why?<input name="lostReason" maxLength={200} /></label>
                    <button type="submit" className="r2-button r2-button--secondary">Move</button>
                  </form>
                  <form action={updateOpportunityAction.bind(null, request, view.opportunity.id)} className="franchise-form">
                    <label>Next action<input name="nextAction" defaultValue={view.opportunity.nextAction ?? ""} maxLength={160} /></label>
                    <label>Next action date<input name="nextActionDate" type="date" defaultValue={view.opportunity.nextActionDate ?? ""} /></label>
                    <button type="submit" className="r2-button r2-button--secondary">Update</button>
                  </form>
                </RecordCard>
              ))}
            </RecordList>
          )}
        </Panel>
      ))}

      <Panel eyebrow="Attention" title="Overdue follow-ups">
        {result.pipeline.overdueFollowUps.length === 0 ? (
          <EmptyState title="No overdue follow-ups">Every opportunity with a next-action date is on time.</EmptyState>
        ) : (
          <RecordList>
            {result.pipeline.overdueFollowUps.map((view) => (
              <RecordCard
                key={view.opportunity.id}
                title={view.opportunity.title}
                status="overdue"
                lines={[
                  `${view.organisation.name} · next action was due ${formatDate(view.opportunity.nextActionDate)}`,
                  `${formatMoney(view.opportunity.estimatedValueMinor)} at ${view.opportunity.probability}%`
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>
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
