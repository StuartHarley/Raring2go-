import type { Route } from "next";
import { MIN_PEER_COHORT, metricCatalogue } from "@raring2go/analytics";
import type { ScorecardMetric } from "@raring2go/analytics";
import { requireShellPermission } from "../../../../lib/app-shell";
import { hasAnalyticsCapability, readScorecardForActor } from "../../../../lib/analytics-runtime";
import type { AnalyticsActorContext } from "../../../../lib/analytics-runtime";
import { formatDate, formatDateTime, formatLabel } from "../../../../lib/format";
import { EmptyState, LinkButton, Metrics, Notice, PageHeader, Panel, RecordCard, RecordList, Table } from "../../../../lib/page-ui";
import type { Tone } from "../../../../lib/page-ui";
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

/** The colour a health band carries: at risk is danger, watch is warning, healthy is success. */
const bandTones: Record<keyof typeof bandLabels, Tone> = { green: "success", amber: "warning", red: "danger", unrated: "neutral" };

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
  const health = view.health;

  return (
    <AppShell request={request}>
      <PageHeader
        eyebrow="Analytics"
        title={view.scope === "network" ? "Network scorecard" : `${view.territory?.name ?? "Territory"} scorecard`}
        intro={`How the business is doing, from one shared set of definitions (version ${view.definitionsVersion}) so Head Office and territory views always agree; last calculated ${formatDateTime(view.collectedAt)}.`}
        actions={
          canGenerate || canConfigure ? (
            <>
              {canGenerate ? (
                <form action={generateSnapshotAction.bind(null, request)}>
                  <button type="submit" className="r2-button r2-button--primary">
                    Generate today&apos;s snapshot
                  </button>
                </form>
              ) : null}
              {canConfigure ? (
                <LinkButton href={`/app/analytics/health${query}` as Route} variant="secondary">
                  Health score settings
                </LinkButton>
              ) : null}
            </>
          ) : undefined
        }
      />
      {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}

      {health ? (
        <Panel
          eyebrow="Franchise health"
          title="Franchise Health Score"
          intro={`Healthy from ${health.thresholds.green}, watch from ${health.thresholds.amber} (scoring version ${health.configVersion}). Factors with no data are left out and the rest re-weighted, never counted as zero.`}
        >
          <Metrics
            items={[
              {
                label: "Score",
                value: health.result.score == null ? "No score yet" : `${Math.round(health.result.score)} / 100`,
                detail: health.result.score == null ? "Not enough data yet" : bandLabels[health.result.band],
                tone: bandTones[health.result.band]
              }
            ]}
          />
          <Table caption="How each factor contributes to the score">
            <thead>
              <tr>
                <th scope="col">Factor</th>
                <th scope="col">Your value</th>
                <th scope="col">Factor score</th>
                <th scope="col">Weight</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              {health.result.factors.map((factor) => {
                const definition = metricCatalogue.find((metric) => metric.key === factor.metric);
                return (
                  <tr key={factor.metric}>
                    <th scope="row">{factor.label}</th>
                    <td>{formatMetric(factor.raw, definition?.unit ?? "count")}</td>
                    <td>{factor.normalised == null ? "No data" : `${Math.round(factor.normalised)} / 100`}</td>
                    <td>{factor.state === "scored" ? `${Math.round(factor.effectiveWeight * 10) / 10}%` : "Excluded"}</td>
                    <td>{factor.state === "scored" ? Math.round(factor.contribution * 10) / 10 : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {history.length > 1 ? (
            <p>
              Recent scores:{" "}
              {[...history]
                .reverse()
                .map((point) => `${Math.round(point.score)} (${formatDate(point.snapshotDate)})`)
                .join(" → ")}
            </p>
          ) : null}
        </Panel>
      ) : null}

      {view.distribution && view.territories ? (
        <Panel eyebrow="Territories" title="Franchise health across the network">
          <Metrics
            items={(["red", "amber", "green", "unrated"] as const).map((band) => {
              const count = view.distribution?.[band] ?? 0;
              return { label: bandLabels[band], value: count, tone: band === "unrated" || count === 0 ? "neutral" : bandTones[band] };
            })}
          />
          {view.territories.length === 0 ? (
            <EmptyState title="No territories yet">Territory scores appear here once the first snapshot has been generated.</EmptyState>
          ) : (
            <Table caption="Each territory's score and the figures behind it">
              <thead>
                <tr>
                  <th scope="col">Territory</th>
                  <th scope="col">Score</th>
                  <th scope="col">Band</th>
                  <th scope="col">Bookings (30d)</th>
                  <th scope="col">Subscribers</th>
                  <th scope="col">Overdue compliance</th>
                </tr>
              </thead>
              <tbody>
                {view.territories.map((row) => (
                  <tr key={row.territoryId}>
                    <th scope="row">{row.name}</th>
                    <td>{row.score == null ? "—" : Math.round(row.score)}</td>
                    <td>{bandLabels[row.band]}</td>
                    <td>{formatMetric(row.metrics["commercial.bookings_value_30d"] ?? null, "minor_currency")}</td>
                    <td>{formatMetric(row.metrics["audience.subscribers"] ?? null, "count")}</td>
                    <td>{formatMetric(row.metrics["franchise.overdue_compliance_actions"] ?? null, "count")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      ) : null}

      {view.benchmarks ? (
        <Panel
          eyebrow="Peer benchmarks"
          title="How you compare"
          intro={`Comparisons use the middle of the network and its quartiles only. No other territory's figures or names are ever shown, and a comparison is withheld when fewer than ${MIN_PEER_COHORT} peers have data.`}
        >
          <Table caption="Your figures against the network median and middle half of peers">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">You</th>
                <th scope="col">Network median</th>
                <th scope="col">Middle half of peers</th>
                <th scope="col">Position</th>
              </tr>
            </thead>
            <tbody>
              {view.benchmarks.map((benchmark) => {
                const definition = metricCatalogue.find((metric) => metric.key === benchmark.metric);
                const unit = definition?.unit ?? "count";
                return (
                  <tr key={benchmark.metric}>
                    <th scope="row">{definition?.label ?? formatLabel(benchmark.metric)}</th>
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
          </Table>
        </Panel>
      ) : null}

      {byDomain.map(({ domain, metrics }) => (
        <Panel key={domain} eyebrow="Metrics" title={domainLabels[domain]}>
          {metrics.length === 0 ? (
            <EmptyState title={`No ${domainLabels[domain]?.toLowerCase()} metrics yet`}>Figures appear here once a snapshot has been generated.</EmptyState>
          ) : (
            <RecordList>
              {metrics.map((metric) => (
                <MetricRow key={metric.definition.key} metric={metric} />
              ))}
            </RecordList>
          )}
        </Panel>
      ))}
    </AppShell>
  );
}

function MetricRow({ metric }: { metric: ScorecardMetric }) {
  const { definition } = metric;
  const change = formatChange(metric.value, metric.previous, definition.unit);
  return (
    <RecordCard title={definition.label} lines={[`${formatMetric(metric.value, definition.unit)}${change ? ` · ${change}` : ""}`]}>
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
    </RecordCard>
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
