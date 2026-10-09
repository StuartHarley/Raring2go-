import type { Route } from "next";
import { JobAccessError } from "@raring2go/workflows";
import { ShellAccessError, requireShellPermission } from "../../../../../../lib/app-shell";
import { hasJobCapability, readJobDetail, registeredJobKinds } from "../../../../../../lib/jobs-runtime";
import type { JobActorContext } from "../../../../../../lib/jobs-runtime";
import { Breadcrumbs, StatusBadge } from "../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { cancelJobAction, retryJobAction } from "../actions";
import { getPermissionData } from "../../../../../../lib/permission-source";
import { protectedOutcome } from "../../../../../../lib/protected-outcome";

export const metadata = { title: "Job" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function JobDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadJob(request, id);

  if ("error" in result) {
    // A JobAccessError means the record exists but is outside this actor's scope: shown as a denial, not a crash.
    return protectedOutcome(result.error instanceof JobAccessError ? new ShellAccessError("unauthorised", result.error.message) : result.error, request);
  }

  const { context, permissions, job, attempts } = result;

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Job console", href: "/app/system/jobs" as Route }, { label: job.kind }]} />

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Job</p>
        <h2>{job.kind}</h2>
        <div className="franchise-metrics">
          <article>
            <span>Status</span>
            <strong>
              <StatusBadge status={job.status === "dead" ? "failed" : job.status === "succeeded" ? "completed" : job.status} />
            </strong>
          </article>
          <article>
            <span>Attempts</span>
            <strong>
              {job.attempts}/{job.maxAttempts}
            </strong>
          </article>
          <article>
            <span>Next run</span>
            <strong>{job.status === "queued" ? job.runAfter.toLocaleString("en-GB") : "-"}</strong>
          </article>
          <article>
            <span>Subject</span>
            <strong>{job.subjectType ? `${job.subjectType}` : "-"}</strong>
          </article>
        </div>
        <dl>
          <dt>Job id</dt>
          <dd>{job.id}</dd>
          <dt>Idempotency key</dt>
          <dd>{job.idempotencyKey}</dd>
          {job.subjectId ? (
            <>
              <dt>Subject id</dt>
              <dd>{job.subjectId}</dd>
            </>
          ) : null}
          {job.correlationId ? (
            <>
              <dt>Correlation id</dt>
              <dd>{job.correlationId}</dd>
            </>
          ) : null}
          {job.lastError ? (
            <>
              <dt>Last error ({job.lastErrorCode ?? "error"})</dt>
              <dd>{job.lastError}</dd>
            </>
          ) : null}
        </dl>
        <div className="franchise-actions">
          {(job.status === "dead" || job.status === "cancelled") && registeredJobKinds.includes(job.kind) && hasJobCapability(permissions, context, "retry", job) ? (
            <form action={retryJobAction.bind(null, request, "jobs", job.id)}>
              <button type="submit">Retry job</button>
            </form>
          ) : null}
          {job.status === "queued" && hasJobCapability(permissions, context, "cancel", job) ? (
            <form action={cancelJobAction.bind(null, request, job.id)}>
              <button type="submit">Cancel job</button>
            </form>
          ) : null}
        </div>
      </section>

      <section className="app-panel audit-table" aria-label="Attempts">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Started</th>
                <th>Worker</th>
                <th>Outcome</th>
                <th>Duration</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {attempts.length === 0 ? (
                <tr>
                  <td colSpan={6}>This job has not been attempted yet.</td>
                </tr>
              ) : (
                attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td>{attempt.attemptNumber}</td>
                    <td>{attempt.startedAt.toLocaleString("en-GB")}</td>
                    <td>{attempt.workerId}</td>
                    <td>{attempt.outcome}</td>
                    <td>{attempt.durationMs != null ? `${attempt.durationMs}ms` : "-"}</td>
                    <td>{attempt.error ?? "-"}</td>
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

async function loadJob(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, id: string) {
  try {
    const shell = await requireShellPermission(request, { module: "system.jobs", action: "view" });
    const context: JobActorContext = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    return { context, permissions: await getPermissionData(), ...(await readJobDetail(context, id)) };
  } catch (error) {
    return { error };
  }
}
