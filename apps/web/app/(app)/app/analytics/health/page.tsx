import type { Route } from "next";
import { metricCatalogue } from "@raring2go/analytics";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readHealthConfigsForActor } from "../../../../../lib/analytics-runtime";
import type { AnalyticsActorContext } from "../../../../../lib/analytics-runtime";
import { formatDate, formatLabel } from "../../../../../lib/format";
import { Actions, EmptyState, FactList, LinkButton, Notice, PageHeader, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import { activateAction, saveDraftAction } from "./actions";
import { ConfigEditor } from "./ConfigEditor";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Franchise health settings" };

const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  draft_created: { tone: "success", text: "Draft created. Review it, then activate it when you are ready." },
  draft_saved: { tone: "success", text: "Draft saved." },
  activated: { tone: "success", text: "Version activated. The next snapshot and every scorecard now use it." },
  not_allowed: { tone: "error", text: "You do not have permission to do that." },
  wrong_state: { tone: "error", text: "That version is no longer a draft. Refresh and try again." }
};

const scoredMetrics = metricCatalogue.filter((metric) => metric.direction !== "neutral").map((metric) => ({ key: metric.key, label: metric.label }));

const metricLabel = (key: string) => metricCatalogue.find((metric) => metric.key === key)?.label ?? formatLabel(key);

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function HealthConfigPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);

  let configs;
  try {
    const shell = await requireShellPermission(request, { module: "analytics.health_config", action: "manage" });
    const context: AnalyticsActorContext = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    configs = await readHealthConfigsForActor(context);
  } catch (error) {
    return protectedOutcome(error);
  }

  const resultParam = Array.isArray(params.result) ? params.result[0] : params.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const active = configs.find((config) => config.status === "active");
  const drafts = configs.filter((config) => config.status === "draft");
  const retired = configs.filter((config) => config.status === "retired");
  const base = active ?? configs[0];
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const back = `/app/analytics${query.toString() ? `?${query.toString()}` : ""}` as Route;

  return (
    <>
      <Breadcrumbs items={[{ label: "Franchise scorecard", href: back }, { label: "Franchise health settings" }]} />
      <PageHeader
        eyebrow="Analytics"
        title="Franchise Health Score settings"
        intro="The rules behind the health score: which metrics count, how much each one weighs, and the anchors that turn a figure into a score out of 100."
        actions={
          <LinkButton href={back} variant="secondary">
            Back to the scorecard
          </LinkButton>
        }
      />
      {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}
      <Notice tone="info">
        Published versions never change: edit a draft and activate it to apply new rules, and every stored score records which version produced it. Money anchors are in pence (for example 500000 is £5,000);
        percentages are 0 to 100.
      </Notice>

      {active ? (
        <Panel
          eyebrow="Active"
          title={`Version ${active.versionNumber}`}
          intro={`${active.changeNote ?? "No note"} · Healthy from ${active.config.thresholds.green}, watch from ${active.config.thresholds.amber}`}
        >
          <FactList
            items={active.config.factors.map((factor) => ({
              label: metricLabel(factor.metric),
              value: `Weight ${factor.weight} · scores 0 at ${factor.bad}, 100 at ${factor.good}`
            }))}
          />
        </Panel>
      ) : null}

      {drafts.map((draft) => (
        <Panel key={draft.id} eyebrow="Draft" title={`Version ${draft.versionNumber}`} intro="Save your changes, then activate the version when it is ready to use.">
          <ConfigEditor
            action={saveDraftAction.bind(null, request, draft.id)}
            metrics={scoredMetrics}
            factors={draft.config.factors}
            thresholds={draft.config.thresholds}
            changeNote={draft.changeNote ?? ""}
            submitLabel="Save draft"
          />
          <form action={activateAction.bind(null, request, draft.id)}>
            <Actions>
              <button type="submit" className="r2-button r2-button--secondary">
                Activate version {draft.versionNumber}
              </button>
            </Actions>
          </form>
        </Panel>
      ))}

      {base ? (
        <Panel
          eyebrow="New version"
          title={`Start a new draft from version ${base.versionNumber}`}
          intro="Each factor scores 0 to 100 between its two anchors; the weight sets how much it carries in the final score."
        >
          <ConfigEditor
            action={saveDraftAction.bind(null, request, null)}
            metrics={scoredMetrics}
            factors={base.config.factors}
            thresholds={base.config.thresholds}
            changeNote=""
            submitLabel="Create draft"
          />
        </Panel>
      ) : null}

      <Panel eyebrow="History" title="Earlier versions">
        {retired.length === 0 ? (
          <EmptyState title="No earlier versions yet">Versions you replace by activating a new draft are kept here.</EmptyState>
        ) : (
          <RecordList>
            {retired.map((config) => (
              <RecordCard
                key={config.id}
                title={`Version ${config.versionNumber}`}
                status={config.status}
                lines={[config.changeNote ?? "No note", config.activatedAt ? `Active from ${formatDate(config.activatedAt)}` : null]}
              />
            ))}
          </RecordList>
        )}
      </Panel>
    </>
  );
}
