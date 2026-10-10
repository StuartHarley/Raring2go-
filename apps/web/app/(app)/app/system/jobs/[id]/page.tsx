import type { Route } from "next";
import { JobAccessError } from "@raring2go/workflows";
import { ShellAccessError, requireShellPermission } from "../../../../../../lib/app-shell";
import { hasJobCapability, readJobDetail, registeredJobKinds } from "../../../../../../lib/jobs-runtime";
import type { JobActorContext } from "../../../../../../lib/jobs-runtime";
import { formatCode, formatDateTime, formatLabel } from "../../../../../../lib/format";
import { Actions, EmptyState, FactList, Metrics, Notice, PageHeader, Panel, StatusBadge, Table } from "../../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { cancelJobAction, retryJobAction } from "../actions";
import { getPermissionData } from "../../../../../../lib/permission-source";
import { protectedOutcome } from "../../../../../../lib/protected-outcome";

export const metadata = { title: "Job" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** "finance.sync_accounting" → "Finance sync accounting": dotted job kinds read as words. */

export default async function JobDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadJob(request, id);

  if ("error" in result) {
    // A JobAccessError means the record exists but is outside this actor's scope: shown as a denial, not a crash.
    return protectedOutcome(result.error instanceof JobAccessError ? new ShellAccessError("unauthorised", result.error.message) : result.error);
  }

  const { context, permissions, job, attempts } = result;
  const statusLabel = job.status === "dead" ? "Dead-lettered" : formatLabel(job.status);
  const statusTone = job.status === "dead" ? "danger" : job.status === "succeeded" ? "success" : job.status === "running" ? "info" : job.status === "queued" ? "warning" : "neutral";
  const canRetry = (job.status === "dead" || job.status === "cancelled") && registeredJobKinds.includes(job.kind) && hasJobCapability(permissions, context, "retry", job);
  const canCancel = job.status === "queued" && hasJobCapability(permissions, context, "cancel", job);

  return (
    <>
      <Breadcrumbs items={[{ label: "Background jobs", href: "/app/system/jobs" as Route }, { label: formatCode(job.kind) }]} />

      <PageHeader eyebrow="Job" title={formatCode(job.kind)} intro={`Created ${formatDateTime(job.createdAt)}.`} />

      <Panel>
        <Metrics
          items={[
            { label: "Status", value: statusLabel, tone: statusTone },
            { label: "Attempts", value: `${job.attempts} of ${job.maxAttempts}`, tone: job.attempts >= job.maxAttempts && job.status === "dead" ? "danger" : "neutral" },
            { label: "Next run", value: job.status === "queued" ? formatDateTime(job.runAfter) : "-" },
            { label: "Subject", value: job.subjectType ? formatLabel(job.subjectType) : "-" }
          ]}
        />
        {job.lastError ? (
          <Notice tone="error">
            {formatLabel(job.lastErrorCode, "Error")}: {job.lastError}
          </Notice>
        ) : null}
        <FactList
          items={[
            { label: "Kind", value: <code>{job.kind}</code> },
            { label: "Job id", value: <code>{job.id}</code> },
            { label: "Idempotency key", value: <code>{job.idempotencyKey}</code> },
            ...(job.subjectId ? [{ label: "Subject id", value: <code>{job.subjectId}</code> }] : []),
            ...(job.correlationId ? [{ label: "Correlation id", value: <code>{job.correlationId}</code> }] : [])
          ]}
        />
        {canRetry || canCancel ? (
          <Actions>
            {canRetry ? (
              <form action={retryJobAction.bind(null, request, "jobs", job.id)}>
                <button type="submit" className="r2-button r2-button--primary">
                  Retry job
                </button>
              </form>
            ) : null}
            {canCancel ? (
              <form action={cancelJobAction.bind(null, request, job.id)}>
                <button type="submit" className="r2-button r2-button--danger">
                  Cancel job
                </button>
              </form>
            ) : null}
          </Actions>
        ) : null}
      </Panel>

      <Panel eyebrow="History" title="Attempts">
        {attempts.length === 0 ? (
          <EmptyState title="Not attempted yet">A worker has not picked this job up. Each attempt is listed here with its outcome and how long it took.</EmptyState>
        ) : (
          <Table caption="Attempts at running this job">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Started</th>
                <th scope="col">Worker</th>
                <th scope="col">Outcome</th>
                <th scope="col">Duration</th>
                <th scope="col">Error</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={attempt.id}>
                  <td>{attempt.attemptNumber}</td>
                  <td>{formatDateTime(attempt.startedAt)}</td>
                  <td>{attempt.workerId}</td>
                  <td>
                    <StatusBadge
                      status={attempt.outcome}
                      tone={attempt.outcome === "succeeded" ? "success" : attempt.outcome === "running" ? "info" : attempt.outcome === "failed" || attempt.outcome === "dead" || attempt.outcome === "timed_out" ? "danger" : "neutral"}
                    />
                  </td>
                  <td>{attempt.durationMs != null ? `${attempt.durationMs}ms` : "-"}</td>
                  <td>{attempt.error ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
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
