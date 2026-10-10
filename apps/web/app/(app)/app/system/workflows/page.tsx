import Link from "next/link";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readWorkflowOverview } from "../../../../../lib/automation-runtime";
import type { AutomationActorContext } from "../../../../../lib/automation-runtime";
import { formatCode, formatDateTime, formatLabel } from "../../../../../lib/format";
import { EmptyState, Metrics, PageHeader, Panel, StatusBadge, Table } from "../../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Workflows" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** "finance.invoice.overdue" → "Finance invoice overdue": dotted event codes read as words. */

const runTone = { pending: "warning", running: "info", waiting: "warning", completed: "success", failed: "danger", cancelled: "neutral" } as const;

export default async function WorkflowsPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await load(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { definitions, runs } = result;
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const waiting = runs.filter(({ run }) => run.status === "waiting").length;
  const failed = runs.filter(({ run }) => run.status === "failed").length;

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title="Workflows"
        intro="The automations that react to what happens in the platform. Each run keeps the exact version of the rules it used, every step it took and why it stopped."
      />

      <Panel>
        <Metrics
          items={[
            { label: "Workflows", value: definitions.length },
            { label: "Waiting", value: waiting, tone: waiting > 0 ? "warning" : "neutral" },
            { label: "Failed runs", value: failed, tone: failed > 0 ? "danger" : "success" }
          ]}
        />
      </Panel>

      <Panel eyebrow="Definitions" title="Workflows">
        {definitions.length === 0 ? (
          <EmptyState title="No workflows yet">Workflows are created from the builder and appear here with their trigger and active version.</EmptyState>
        ) : (
          <Table caption="Workflow definitions">
            <thead>
              <tr>
                <th scope="col">Workflow</th>
                <th scope="col">Trigger</th>
                <th scope="col">Active version</th>
                <th scope="col">Steps</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {definitions.map(({ definition, activeVersion }) => (
                <tr key={definition.id}>
                  <td>
                    <Link href={`/app/system/workflows/${definition.id}${suffix}` as Route}>
                      <strong>{definition.name}</strong>
                    </Link>
                    <br />
                    <small>{definition.description}</small>
                  </td>
                  <td>{activeVersion ? formatCode(activeVersion.triggerEvent) : "-"}</td>
                  <td>{activeVersion ? `Version ${activeVersion.versionNumber}` : "None"}</td>
                  <td>{activeVersion?.steps.length ?? 0}</td>
                  <td>
                    <StatusBadge status={definition.status === "enabled" && activeVersion ? "active" : "paused"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel eyebrow="History" title="Recent runs">
        {runs.length === 0 ? (
          <EmptyState title="No workflow has run yet">Runs appear here as soon as a trigger event happens.</EmptyState>
        ) : (
          <Table caption="Recent workflow runs, newest first">
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Workflow</th>
                <th scope="col">Status</th>
                <th scope="col">Outcome</th>
                <th scope="col">Step</th>
                <th scope="col">Subject</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(({ run, workflowName }) => (
                <tr key={run.id}>
                  <td>{formatDateTime(run.createdAt)}</td>
                  <td>
                    <Link href={`/app/system/workflows/runs/${run.id}${suffix}` as Route}>{workflowName}</Link>
                    {run.isTest ? " (test)" : ""}
                  </td>
                  <td>
                    <StatusBadge status={run.status} tone={runTone[run.status]} />
                  </td>
                  <td>{run.outcome ? formatLabel(run.outcome) : run.waitingOn ? `Waiting on ${formatLabel(run.waitingOn).toLowerCase()}` : "-"}</td>
                  <td>Step {run.currentStep + (run.status === "completed" ? 0 : 1)}</td>
                  <td>{run.subjectType ? formatLabel(run.subjectType) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "automation.workflow", action: "view" });
    const context: AutomationActorContext = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    return await readWorkflowOverview(context);
  } catch (error) {
    return { error };
  }
}
