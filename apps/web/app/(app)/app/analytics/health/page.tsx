import Link from "next/link";
import type { Route } from "next";
import { metricCatalogue } from "@raring2go/analytics";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readHealthConfigsForActor } from "../../../../../lib/analytics-runtime";
import type { AnalyticsActorContext } from "../../../../../lib/analytics-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { activateAction, saveDraftAction } from "./actions";
import { ConfigEditor } from "./ConfigEditor";

const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  draft_created: { tone: "success", text: "Draft created. Review it, then activate it when you are ready." },
  draft_saved: { tone: "success", text: "Draft saved." },
  activated: { tone: "success", text: "Version activated. The next snapshot and every scorecard now use it." },
  not_allowed: { tone: "error", text: "You do not have permission to do that." },
  wrong_state: { tone: "error", text: "That version is no longer a draft. Refresh and try again." }
};

const scoredMetrics = metricCatalogue.filter((metric) => metric.direction !== "neutral").map((metric) => ({ key: metric.key, label: metric.label }));

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
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Business in a Box</p>
        <h2>Franchise Health Score settings</h2>
        <p>
          The score is a weighted blend of scorecard metrics. Each factor scores 0 to 100 between two anchors; weights set how much each carries. Published versions never change: edit a draft and activate it
          to apply new rules, and every stored score records which version produced it. Money anchors are in pence (for example 500000 is £5,000); percentages are 0 to 100.
        </p>
        <p>
          <Link href={back}>Back to the scorecard</Link>
        </p>
        {banner ? (
          <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>
            {banner.text}
          </p>
        ) : null}
      </section>

      {active ? (
        <section className="app-panel franchise-panel" aria-label="Active version">
          <p className="eyebrow">Active</p>
          <h2>Version {active.versionNumber}</h2>
          <p>
            {active.changeNote ?? "No note"} · Healthy from {active.config.thresholds.green}, watch from {active.config.thresholds.amber}
          </p>
          <ul>
            {active.config.factors.map((factor) => (
              <li key={factor.metric}>
                {metricCatalogue.find((metric) => metric.key === factor.metric)?.label ?? factor.metric}: weight {factor.weight}, 0 at {factor.bad}, 100 at {factor.good}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {drafts.map((draft) => (
        <section key={draft.id} className="app-panel franchise-panel" aria-label={`Draft version ${draft.versionNumber}`}>
          <p className="eyebrow">Draft</p>
          <h2>Version {draft.versionNumber}</h2>
          <ConfigEditor
            action={saveDraftAction.bind(null, request, draft.id)}
            metrics={scoredMetrics}
            factors={draft.config.factors}
            thresholds={draft.config.thresholds}
            changeNote={draft.changeNote ?? ""}
            submitLabel="Save draft"
          />
          <form action={activateAction.bind(null, request, draft.id)}>
            <button type="submit">Activate version {draft.versionNumber}</button>
          </form>
        </section>
      ))}

      {base ? (
        <section className="app-panel franchise-panel" aria-label="New draft">
          <p className="eyebrow">New version</p>
          <h2>Start a new draft from version {base.versionNumber}</h2>
          <ConfigEditor
            action={saveDraftAction.bind(null, request, null)}
            metrics={scoredMetrics}
            factors={base.config.factors}
            thresholds={base.config.thresholds}
            changeNote=""
            submitLabel="Create draft"
          />
        </section>
      ) : null}

      <section className="app-panel franchise-panel" aria-label="Version history">
        <p className="eyebrow">History</p>
        <h2>Earlier versions</h2>
        {retired.length === 0 ? (
          <p>No earlier versions yet.</p>
        ) : (
          <ul>
            {retired.map((config) => (
              <li key={config.id}>
                Version {config.versionNumber}: {config.changeNote ?? "No note"}
                {config.activatedAt ? ` (active from ${config.activatedAt.toLocaleDateString("en-GB")})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
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
