import type { Route } from "next";
import { JobAccessError } from "@raring2go/workflows";
import { ShellAccessError, requireShellPermission } from "../../../../../../../lib/app-shell";
import { readWorkflowRun } from "../../../../../../../lib/automation-runtime";
import type { AutomationActorContext } from "../../../../../../../lib/automation-runtime";
import { formatDateTime, formatLabel } from "../../../../../../../lib/format";
import { EmptyState, Metrics, Notice, PageHeader, Panel, StatusBadge, Table } from "../../../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../../../page";
import { protectedOutcome } from "../../../../../../../lib/protected-outcome";

export const metadata = { title: "Workflow run" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const runTone = { pending: "warning", running: "info", waiting: "warning", completed: "success", failed: "danger", cancelled: "neutral" } as const;
const stepTone = { pending: "warning", completed: "success", waiting: "warning", skipped: "neutral", failed: "danger" } as const;

export default async function WorkflowRunPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await load(request, id);

  if ("error" in result) {
    // A JobAccessError means the record exists but is outside this actor's scope: shown as a denial, not a crash.
    return protectedOutcome(result.error instanceof JobAccessError ? new ShellAccessError("unauthorised", result.error.message) : result.error);
  }

  const { run, steps, definition, version } = result;
  const name = definition?.name ?? "Workflow";
  const plannedSteps = version?.steps ?? [];

  return (
    <>
      <Breadcrumbs items={[{ label: "Workflows", href: "/app/system/workflows" as Route }, { label: definition?.name ?? "Run" }]} />

      <PageHeader
        eyebrow={run.isTest ? "Workflow run (test)" : "Workflow run"}
        title={name}
        intro={`Started ${formatDateTime(run.createdAt)}${run.isTest ? ". A test run records what each step would do without sending anything." : "."}`}
      />

      <Panel>
        <Metrics
          items={[
            { label: "Status", value: formatLabel(run.status), tone: runTone[run.status] },
            { label: "Version", value: version ? `Version ${version.versionNumber}` : "-" },
            { label: "Outcome", value: run.outcome ? formatLabel(run.outcome) : run.waitingOn ? `Waiting on ${formatLabel(run.waitingOn).toLowerCase()}` : "-" },
            { label: "Resumes", value: run.resumeAt ? formatDateTime(run.resumeAt) : "-" }
          ]}
        />
        {run.lastError ? <Notice tone="error">{run.lastError}</Notice> : null}
      </Panel>

      <Panel eyebrow="Progress" title="Steps">
        {plannedSteps.length === 0 ? (
          <EmptyState title="No steps recorded">The version this run used has no steps, so there is nothing to show.</EmptyState>
        ) : (
          <Table caption="Steps in this run, in order">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Step</th>
                <th scope="col">Status</th>
                <th scope="col">Attempts</th>
                <th scope="col">Result</th>
                <th scope="col">Error</th>
              </tr>
            </thead>
            <tbody>
              {plannedSteps.map((step, index) => {
                const saved = steps.find((candidate) => candidate.stepIndex === index);
                return (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{formatLabel(step.type)}</td>
                    <td>
                      <StatusBadge status={saved ? saved.status : "pending"} tone={saved ? stepTone[saved.status] : "warning"} />
                    </td>
                    <td>{saved?.attempts ?? 0}</td>
                    <td>{saved && Object.keys(saved.result).length > 0 ? <code>{JSON.stringify(saved.result)}</code> : "-"}</td>
                    <td>{saved?.error ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, id: string) {
  try {
    const shell = await requireShellPermission(request, { module: "automation.workflow", action: "view" });
    const context: AutomationActorContext = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    return await readWorkflowRun(context, id);
  } catch (error) {
    return { error };
  }
}
