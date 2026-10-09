import Link from "next/link";
import type { Route } from "next";
import type { AiApprovalState } from "@raring2go/ai";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readAiRuns } from "../../../../../lib/ai-runtime";
import { StatusBadge } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "AI runs" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATES: AiApprovalState[] = ["pending", "approved", "rejected", "not_required"];
const stateLabel: Record<AiApprovalState, string> = { pending: "Awaiting decision", approved: "Approved", rejected: "Rejected", not_required: "Informational" };
const stateTone: Record<AiApprovalState, string> = { pending: "paused", approved: "completed", rejected: "failed", not_required: "draft" };

export default async function AiRunsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const stateParam = Array.isArray(params.state) ? params.state[0] : params.state;
  const state = STATES.find((candidate) => candidate === stateParam);
  const result = await load(request, state);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const { runs } = result;
  const base = new URLSearchParams();
  if (request.sessionKey) base.set("session", request.sessionKey);
  if (request.organisationId) base.set("organisationId", request.organisationId);
  if (request.territoryId) base.set("territoryId", request.territoryId);
  const link = (extra?: Record<string, string>) => {
    const query = new URLSearchParams(base);
    for (const [key, value] of Object.entries(extra ?? {})) query.set(key, value);
    return query.toString() ? `?${query.toString()}` : "";
  };
  const spend = runs.reduce((total, run) => total + run.estimatedCostMinor, 0);

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">AI</p>
        <h2>AI runs</h2>
        <p>
          Every AI call that matters is recorded here: who asked, why, which records it used, what it returned and
          whether a person accepted it. AI prepares and suggests; people decide.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Awaiting decision</span>
            <strong>{runs.filter((run) => run.approvalState === "pending").length}</strong>
          </article>
          <article>
            <span>Failed calls</span>
            <strong>{runs.filter((run) => run.status === "failed").length}</strong>
          </article>
          <article>
            <span>Estimated cost (shown runs)</span>
            <strong>${(spend / 100).toFixed(2)}</strong>
          </article>
        </div>
        <nav className="filter-tabs" aria-label="Filter by decision">
          <Link href={`/app/system/ai${link()}` as Route} aria-current={state ? undefined : "page"}>All</Link>
          {STATES.map((candidate) => (
            <Link key={candidate} href={`/app/system/ai${link({ state: candidate })}` as Route} aria-current={state === candidate ? "page" : undefined}>
              {stateLabel[candidate]}
            </Link>
          ))}
        </nav>
      </section>

      <section className="app-panel audit-table" aria-label="AI runs">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Purpose</th>
                <th>Requested by</th>
                <th>Model</th>
                <th>Decision</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6}>No AI runs match. They appear here as soon as AI assist is used.</td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.createdAt.toLocaleString("en-GB")}</td>
                    <td>
                      <Link href={`/app/system/ai/${run.id}${link()}` as Route}>{run.purpose}</Link>
                      <br />
                      <small>{run.taskKey}{run.risk === "high" ? " · high risk" : ""}</small>
                    </td>
                    <td>{run.actorType === "automation" ? "Automation" : run.actorUserId ?? "-"}</td>
                    <td>{run.providerKey} / {run.modelReference}</td>
                    <td>
                      {run.status === "failed" ? <StatusBadge status="failed" /> : <StatusBadge status={stateTone[run.approvalState]} />}{" "}
                      <small>{run.status === "failed" ? "Call failed" : stateLabel[run.approvalState]}{run.appliedAt ? " · applied" : ""}</small>
                    </td>
                    <td>${(run.estimatedCostMinor / 100).toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, state: AiApprovalState | undefined) {
  try {
    const shell = await requireShellPermission(request, { module: "ai.run", action: "view" });
    const context = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    return { runs: await readAiRuns(context, state ? { approvalStates: [state] } : {}) };
  } catch (error) {
    return { error };
  }
}
