import Link from "next/link";
import type { Route } from "next";
import type { AiApprovalState } from "@raring2go/ai";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readAiRuns } from "../../../../../lib/ai-runtime";
import { getDirectory } from "../../../../../lib/directory";
import { displayName, formatCode, formatDateTime, formatLabel } from "../../../../../lib/format";
import { EmptyState, FilterTabs, Metrics, PageHeader, Panel, StatusBadge, Table } from "../../../../../lib/page-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "AI runs" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATES: AiApprovalState[] = ["pending", "approved", "rejected", "not_required"];
const stateLabel: Record<AiApprovalState, string> = { pending: "Awaiting decision", approved: "Approved", rejected: "Rejected", not_required: "No decision needed" };

/** "content.draft_article" → "Content draft article": dotted task codes read as words. */

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
  const awaiting = runs.filter((run) => run.approvalState === "pending").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const requesterNames = await resolveNames(runs.map((run) => run.actorUserId));

  return (
    <AppShell request={request}>
      <PageHeader
        eyebrow="AI"
        title="AI runs"
        intro="Every AI call that matters: who asked, why, which records it used, what came back and whether a person accepted it. AI suggests; people decide."
      />

      <Panel>
        <Metrics
          items={[
            { label: "Awaiting decision", value: awaiting, tone: awaiting > 0 ? "warning" : "success" },
            { label: "Failed calls", value: failed, tone: failed > 0 ? "danger" : "success" },
            { label: "Estimated cost of the runs shown", value: formatMoney(spend) }
          ]}
        />
        <FilterTabs
          label="Filter by decision"
          items={[
            { label: "All", href: `/app/system/ai${link()}` as Route, current: !state },
            ...STATES.map((candidate) => ({
              label: stateLabel[candidate],
              href: `/app/system/ai${link({ state: candidate })}` as Route,
              current: state === candidate
            }))
          ]}
        />
      </Panel>

      <Panel eyebrow="History" title="Runs">
        {runs.length === 0 ? (
          <EmptyState title="No AI runs match">Runs appear here as soon as AI assist is used somewhere in the platform.</EmptyState>
        ) : (
          <Table caption="AI runs, newest first">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Purpose</th>
                <th scope="col">Requested by</th>
                <th scope="col">Model</th>
                <th scope="col">Decision</th>
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{formatDateTime(run.createdAt)}</td>
                  <td>
                    <Link href={`/app/system/ai/${run.id}${link()}` as Route}>{run.purpose}</Link>
                    <br />
                    <small>
                      {formatCode(run.taskKey)}
                      {run.risk === "high" ? " · High risk" : ""}
                    </small>
                  </td>
                  <td>{run.actorType === "automation" ? "Automation" : displayName(run.actorUserId ? requesterNames.get(run.actorUserId) : undefined, "A person")}</td>
                  <td>
                    {formatLabel(run.providerKey)} <small>{run.modelReference}</small>
                  </td>
                  <td>
                    <StatusBadge status={run.status === "failed" ? "failed" : run.approvalState} />{" "}
                    <small>
                      {run.status === "failed" ? "Call failed" : stateLabel[run.approvalState]}
                      {run.appliedAt ? " · Applied" : ""}
                    </small>
                  </td>
                  <td>{formatMoney(run.estimatedCostMinor)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </AppShell>
  );
}

function formatMoney(minor: number) {
  return `$${(minor / 100).toFixed(2)}`;
}

/** The display names behind the user ids in a list, looked up once per distinct id. */
async function resolveNames(userIds: Array<string | null | undefined>) {
  const directory = getDirectory();
  const distinct = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const names = await Promise.all(distinct.map(async (id) => [id, await directory.userName(id)] as const));
  return new Map(names);
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
