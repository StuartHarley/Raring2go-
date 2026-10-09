import type { Route } from "next";
import { JobAccessError } from "@raring2go/workflows";
import { ShellAccessError, requireShellPermission } from "../../../../../../../lib/app-shell";
import { readWorkflowRun } from "../../../../../../../lib/automation-runtime";
import type { AutomationActorContext } from "../../../../../../../lib/automation-runtime";
import { Breadcrumbs, StatusBadge } from "../../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../../page";
import { protectedOutcome } from "../../../../../../../lib/protected-outcome";

export const metadata = { title: "Workflow run" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const stepTone: Record<string, string> = { pending: "queued", completed: "completed", waiting: "paused", skipped: "neutral", failed: "failed" };

export default async function WorkflowRunPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await load(request, id);

  if ("error" in result) {
    // A JobAccessError means the record exists but is outside this actor's scope: shown as a denial, not a crash.
    return protectedOutcome(result.error instanceof JobAccessError ? new ShellAccessError("unauthorised", result.error.message) : result.error, request);
  }

  const { run, steps, definition, version } = result;

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Workflows", href: "/app/system/workflows" as Route }, { label: definition?.name ?? "Run" }]} />

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Workflow run{run.isTest ? " (test)" : ""}</p>
        <h2>{definition?.name ?? "Workflow"}</h2>
        <div className="franchise-metrics">
          <article>
            <span>Status</span>
            <strong>
              <StatusBadge status={run.status === "waiting" ? "paused" : run.status} />
            </strong>
          </article>
          <article>
            <span>Version</span>
            <strong>{version ? `v${version.versionNumber}` : "-"}</strong>
          </article>
          <article>
            <span>Outcome</span>
            <strong>{run.outcome ?? "-"}</strong>
          </article>
          <article>
            <span>Resumes</span>
            <strong>{run.resumeAt ? run.resumeAt.toLocaleString("en-GB") : "-"}</strong>
          </article>
        </div>
        {run.lastError ? <p role="alert" className="notice notice--error">{run.lastError}</p> : null}
      </section>

      <section className="app-panel audit-table" aria-label="Steps">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Step</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Result</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {(version?.steps ?? []).map((step, index) => {
                const saved = steps.find((candidate) => candidate.stepIndex === index);
                return (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{step.type.replace("_", " ")}</td>
                    <td>
                      <StatusBadge status={saved ? stepTone[saved.status] ?? saved.status : "queued"} />
                    </td>
                    <td>{saved?.attempts ?? 0}</td>
                    <td>{saved && Object.keys(saved.result).length > 0 ? JSON.stringify(saved.result) : "-"}</td>
                    <td>{saved?.error ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
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
