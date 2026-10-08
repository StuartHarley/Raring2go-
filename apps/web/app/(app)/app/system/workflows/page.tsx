import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readWorkflowOverview } from "../../../../../lib/automation-runtime";
import type { AutomationActorContext } from "../../../../../lib/automation-runtime";
import { StatusBadge } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const runTone: Record<string, string> = { pending: "queued", running: "processing", waiting: "paused", completed: "completed", failed: "failed", cancelled: "rejected" };

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

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Automation</p>
        <h2>Workflows</h2>
        <p>
          Lifecycle automation that reacts to what happens in the platform. Each run records the exact version of the
          rules it used, every step it took, and why it stopped.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Workflows</span>
            <strong>{definitions.length}</strong>
          </article>
          <article>
            <span>Waiting</span>
            <strong>{runs.filter(({ run }) => run.status === "waiting").length}</strong>
          </article>
          <article>
            <span>Failed runs</span>
            <strong>{runs.filter(({ run }) => run.status === "failed").length}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel audit-table" aria-label="Workflow definitions">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Trigger</th>
                <th>Active version</th>
                <th>Steps</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {definitions.map(({ definition, activeVersion }) => (
                <tr key={definition.id}>
                  <td>
                    <strong>{definition.name}</strong>
                    <br />
                    <small>{definition.description}</small>
                  </td>
                  <td>{activeVersion?.triggerEvent ?? "-"}</td>
                  <td>{activeVersion ? `v${activeVersion.versionNumber}` : "none"}</td>
                  <td>{activeVersion?.steps.length ?? 0}</td>
                  <td>
                    <StatusBadge status={definition.status === "enabled" && activeVersion ? "active" : "paused"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="app-panel audit-table" aria-label="Recent runs">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Workflow</th>
                <th>Status</th>
                <th>Outcome</th>
                <th>Step</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6}>No workflow has run yet. Runs appear here as soon as a trigger event happens.</td>
                </tr>
              ) : (
                runs.map(({ run, workflowName }) => (
                  <tr key={run.id}>
                    <td>{run.createdAt.toLocaleString("en-GB")}</td>
                    <td>
                      <Link href={`/app/system/workflows/runs/${run.id}${suffix}` as Route}>{workflowName}</Link>
                      {run.isTest ? " (test)" : ""}
                    </td>
                    <td>
                      <StatusBadge status={runTone[run.status] ?? run.status} />
                    </td>
                    <td>{run.outcome ?? (run.waitingOn ? `waiting on ${run.waitingOn}` : "-")}</td>
                    <td>{run.currentStep + (run.status === "completed" ? 0 : 1)}</td>
                    <td>{run.subjectType ? `${run.subjectType}:${run.subjectId ?? ""}` : "-"}</td>
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

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "automation.workflow", action: "view" });
    const context: AutomationActorContext = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    return await readWorkflowOverview(context);
  } catch (error) {
    return { error };
  }
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
