import Link from "next/link";
import type { Route } from "next";
import { MIN_PEER_COHORT, metricCatalogue } from "@raring2go/analytics";
import type { ScorecardMetric } from "@raring2go/analytics";
import { requireShellPermission } from "../../../../lib/app-shell";
import { hasAnalyticsCapability, readScorecardForActor } from "../../../../lib/analytics-runtime";
import type { AnalyticsActorContext } from "../../../../lib/analytics-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { generateSnapshotAction } from "./actions";
import { bandLabels, benchmarkLabels, formatChange, formatMetric } from "./format";
import { getPermissionData } from "../../../../lib/permission-source";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Scorecard" };

const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  snapshot_generated: { tone: "success", text: "Snapshot generated for today." },
  not_allowed: { tone: "error", text: "You do not have permission to do that." }
};

const domainLabels: Record<string, string> = {
  commercial: "Commercial",
  audience: "Audience",
  publishing: "Publishing",
  franchise: "Franchise",
  operations: "Operations"
};

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ScorecardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);

  let loaded;
  try {
    const shell = await requireShellPermission(request, { module: "analytics.scorecard", action: "view" });
    const context: AnalyticsActorContext = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    loaded = { context, ...(await readScorecardForActor(context)) };
  } catch (error) {
    return protectedOutcome(error, request);
  }

  const { context, view, history } = loaded;
  const resultParam = Array.isArray(params.result) ? params.result[0] : params.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const permissions = await getPermissionData();
  const canGenerate = hasAnalyticsCapability(permissions, context, "snapshotGenerate");
  const canConfigure = hasAnalyticsCapability(permissions, context, "healthConfigManage");
  const query = withContext(request);
  const byDomain = Object.keys(domainLabels).map((domain) => ({ domain, metrics: view.metrics.filter((metric) => metric.definition.domain === domain) }));

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Business in a Box</p>
        <h2>{view.scope === "network" ? "Network scorecard" : `${view.territory?.name ?? "Territory"} scorecard`}</h2>
        <p>
          Every figure here comes from one shared set of definitions (version {view.definitionsVersion}), so the Head Office and territory views always reconcile.
          Calculated {view.collectedAt.toLocaleString("en-GB")}.
        </p>
        {banner ? (
          <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>
            {banner.text}
          </p>
        ) : null}
        <div className="franchise-actions">
          {canConfigure ? <Link href={`/app/analytics/health${query}` as Route}>Health score settings</Link> : null}
          {canGenerate ? (
            <form action={generateSnapshotAction.bind(null, request)}>
              <button type="submit">Generate today&apos;s snapshot</button>
            </form>
          ) : null}
        </div>
      </section>

      {view.health ? (
        <section className="app-panel franchise-panel" aria-label="Franchise health score">
          <p className="eyebrow">Franchise Health Score</p>
          <h2>
            {view.health.result.score == null ? "Not enough data yet" : `${Math.round(view.health.result.score)} / 100`}{" "}
            <span className={`status-badge status-${view.health.result.band}`}>{bandLabels[view.health.result.band]}</span>
          </h2>
          <p>
            Healthy from {view.health.thresholds.green}, watch from {view.health.thresholds.amber}. Scoring configuration version {view.health.configVersion}. Factors with no data are left out and the rest re-weighted, never counted as zero.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Factor</th>
                  <th>Your value</th>
                  <th>Factor score</th>
                  <th>Weight</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {view.health.result.factors.map((factor) => {
                  const definition = metricCatalogue.find((metric) => metric.key === factor.metric);
                  return (
                    <tr key={factor.metric}>
                      <td>{factor.label}</td>
                      <td>{formatMetric(factor.raw, definition?.unit ?? "count")}</td>
                      <td>{factor.normalised == null ? "No data" : `${Math.round(factor.normalised)} / 100`}</td>
                      <td>{factor.state === "scored" ? `${Math.round(factor.effectiveWeight * 10) / 10}%` : "Excluded"}</td>
                      <td>{factor.state === "scored" ? Math.round(factor.contribution * 10) / 10 : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {history.length > 1 ? (
            <p>
              Recent scores:{" "}
              {[...history]
                .reverse()
                .map((point) => `${Math.round(point.score)} (${point.snapshotDate.toISOString().slice(5, 10)})`)
                .join(" → ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {view.distribution && view.territories ? (
        <section className="app-panel franchise-panel" aria-label="Territory health">
          <p className="eyebrow">Territories</p>
          <h2>Franchise health across the network</h2>
          <div className="franchise-metrics">
            {(["red", "amber", "green", "unrated"] as const).map((band) => (
              <article key={band}>
                <span>{bandLabels[band]}</span>
                <strong>{view.distribution?.[band] ?? 0}</strong>
              </article>
            ))}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Territory</th>
                  <th>Score</th>
                  <th>Band</th>
                  <th>Bookings (30d)</th>
                  <th>Subscribers</th>
                  <th>Overdue compliance</th>
                </tr>
              </thead>
              <tbody>
                {view.territories.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No territories yet.</td>
                  </tr>
                ) : (
                  view.territories.map((row) => (
                    <tr key={row.territoryId}>
                      <td>{row.name}</td>
                      <td>{row.score == null ? "—" : Math.round(row.score)}</td>
                      <td>{bandLabels[row.band]}</td>
                      <td>{formatMetric(row.metrics["commercial.bookings_value_30d"] ?? null, "minor_currency")}</td>
                      <td>{formatMetric(row.metrics["audience.subscribers"] ?? null, "count")}</td>
                      <td>{formatMetric(row.metrics["franchise.overdue_compliance_actions"] ?? null, "count")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {view.benchmarks ? (
        <section className="app-panel franchise-panel" aria-label="Peer benchmarks">
          <p className="eyebrow">Peer benchmarks</p>
          <h2>How you compare</h2>
          <p>
            Comparisons use the middle of the network and its quartiles only. No other territory&apos;s figures or names are ever shown, and a comparison is withheld when fewer than {MIN_PEER_COHORT} peers have data.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>You</th>
                  <th>Network median</th>
                  <th>Middle half of peers</th>
                  <th>Position</th>
                </tr>
              </thead>
              <tbody>
                {view.benchmarks.map((benchmark) => {
                  const definition = metricCatalogue.find((metric) => metric.key === benchmark.metric);
                  const unit = definition?.unit ?? "count";
                  return (
                    <tr key={benchmark.metric}>
                      <td>{definition?.label ?? benchmark.metric}</td>
                      {benchmark.suppressed ? (
                        <td colSpan={4}>Not enough peer data to compare yet.</td>
                      ) : (
                        <>
                          <td>{formatMetric(benchmark.own, unit)}</td>
                          <td>{formatMetric(benchmark.median, unit)}</td>
                          <td>
                            {formatMetric(benchmark.lowerQuartile, unit)} to {formatMetric(benchmark.upperQuartile, unit)}
                          </td>
                          <td>{benchmarkLabels[benchmark.band]}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {byDomain.map(({ domain, metrics }) => (
        <section key={domain} className="app-panel franchise-panel" aria-label={`${domainLabels[domain]} metrics`}>
          <p className="eyebrow">{domainLabels[domain]}</p>
          <div className="franchise-list">
            {metrics.map((metric) => (
              <MetricRow key={metric.definition.key} metric={metric} />
            ))}
          </div>
        </section>
      ))}
    </AppShell>
  );
}

function MetricRow({ metric }: { metric: ScorecardMetric }) {
  const { definition } = metric;
  const change = formatChange(metric.value, metric.previous, definition.unit);
  return (
    <div>
      <strong>{definition.label}</strong>
      <span>
        {formatMetric(metric.value, definition.unit)}
        {change ? ` · ${change}` : ""}
      </span>
      <details>
        <summary>How this is calculated</summary>
        <p>{definition.description}</p>
        <p>
          <strong>Formula:</strong> {definition.formula}
        </p>
        <p>
          <strong>Source:</strong> {definition.source} · <strong>Window:</strong> {definition.window}
        </p>
      </details>
    </div>
  );
}

function withContext(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const text = query.toString();
  return text ? `?${text}` : "";
}
