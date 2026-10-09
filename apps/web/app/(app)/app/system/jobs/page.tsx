import Link from "next/link";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { hasJobCapability, hasNetworkJobAccess, readJobConsole } from "../../../../../lib/jobs-runtime";
import type { JobActorContext } from "../../../../../lib/jobs-runtime";
import { readSystemHealth } from "../../../../../lib/health-runtime";
import { StatusBadge } from "../../../../../lib/workflow-ui";
import { jobStatuses, retryableLegacySources } from "@raring2go/workflows";
import type { JobSource, JobStatus, TrackedJob } from "@raring2go/workflows";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { cancelJobAction, retryJobAction } from "./actions";
import { getPermissionData } from "../../../../../lib/permission-source";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Job console" };

const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  retried: { tone: "success", text: "Job re-queued. It will run on the next worker tick." },
  cancelled: { tone: "success", text: "Job cancelled." },
  not_allowed: { tone: "error", text: "You do not have permission to do that for this job." },
  wrong_state: { tone: "error", text: "That job is no longer in a state where this action applies. Refresh and try again." }
};

const sourceLabels: Record<JobSource, string> = {
  jobs: "Background job",
  email_send: "Email send",
  social_publish: "Social post",
  website_publish: "Website publish",
  publication_output: "Edition output"
};

function isRetryable(job: TrackedJob, registeredKinds: string[]) {
  if (job.source === "jobs") {
    return (job.status === "dead" || job.status === "cancelled") && registeredKinds.includes(job.kind);
  }
  return retryableLegacySources.includes(job.source) && job.status === "dead";
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function JobConsolePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const statusParam = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = jobStatuses.find((candidate) => candidate === statusParam);
  const result = await loadConsole(request, status);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const { context, permissions, jobs, counts, registeredKinds, health } = result;
  const resultParam = Array.isArray(params.result) ? params.result[0] : params.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const needsAttention = counts.dead;

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">System</p>
        <h2>Job console</h2>
        <p>
          Background work for publishing, email and automation. Failed jobs are retried
          with backoff and land here as dead-lettered once their attempts are spent; each
          one links back to the record it belongs to.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Needs attention</span>
            <strong>{needsAttention}</strong>
          </article>
          <article>
            <span>Queued</span>
            <strong>{counts.queued}</strong>
          </article>
          <article>
            <span>Running</span>
            <strong>{counts.running}</strong>
          </article>
          <article>
            <span>Succeeded</span>
            <strong>{counts.succeeded}</strong>
          </article>
        </div>
        {health ? (
          <div className="franchise-list" aria-label="System health">
            {health.checks.map((check) => (
              <div key={check.name}>
                <strong>{check.name.replace("_", " ")}</strong>
                <StatusBadge status={check.status === "ok" ? "completed" : check.status === "degraded" ? "paused" : "failed"} />
                <span>{check.detail}</span>
              </div>
            ))}
          </div>
        ) : null}
        {banner ? (
          <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>
            {banner.text}
          </p>
        ) : null}
        <nav className="filter-tabs" aria-label="Filter jobs by status">
          <Link href={withParams(request, undefined)} aria-current={status ? undefined : "page"}>All</Link>
          {jobStatuses.map((candidate) => (
            <Link key={candidate} href={withParams(request, candidate)} aria-current={status === candidate ? "page" : undefined}>
              {candidate === "dead" ? "Dead-lettered" : candidate}
              {` (${counts[candidate]})`}
            </Link>
          ))}
        </nav>
      </section>

      <section className="app-panel audit-table" aria-label="Background jobs">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Source</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Subject</th>
                <th>Last error</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    {status ? `No ${status} jobs.` : "No background jobs yet."} Registered job kinds: {registeredKinds.join(", ") || "none"}.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={`${job.source}:${job.id}`}>
                    <td>{job.createdAt.toLocaleString("en-GB")}</td>
                    <td>{sourceLabels[job.source]}</td>
                    <td>
                      {job.source === "jobs" ? (
                        <Link href={detailHref(request, job.id)}>{job.kind}</Link>
                      ) : job.traceHref ? (
                        <Link href={job.traceHref as Route}>{job.kind}</Link>
                      ) : (
                        job.kind
                      )}
                    </td>
                    <td>
                      <StatusBadge status={job.status === "dead" ? "failed" : job.status === "succeeded" ? "completed" : job.status} />
                    </td>
                    <td>{job.maxAttempts != null ? `${job.attempts}/${job.maxAttempts}` : "-"}</td>
                    <td>{job.subjectType ? `${job.subjectType}:${job.subjectId ?? ""}` : "-"}</td>
                    <td>{job.lastError ?? "-"}</td>
                    <td>
                      {isRetryable(job, registeredKinds) && hasJobCapability(permissions, context, "retry", job) ? (
                        <form action={retryJobAction.bind(null, request, job.source, job.id)}>
                          <button type="submit">Retry</button>
                        </form>
                      ) : null}
                      {job.source === "jobs" && job.status === "queued" && hasJobCapability(permissions, context, "cancel", job) ? (
                        <form action={cancelJobAction.bind(null, request, job.id)}>
                          <button type="submit">Cancel</button>
                        </form>
                      ) : null}
                    </td>
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

async function loadConsole(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, status: JobStatus | undefined) {
  try {
    const shell = await requireShellPermission(request, { module: "system.jobs", action: "view" });
    const context: JobActorContext = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    const console = await readJobConsole(context, status ? { statuses: [status] } : {});
    // Health aggregates the whole queue, so only viewers with a network-wide grant see it.
    const permissions = await getPermissionData();
    const health = hasNetworkJobAccess(permissions, context.userId) ? await readSystemHealth() : undefined;
    return { context, permissions, ...console, health };
  } catch (error) {
    return { error };
  }
}

function withParams(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, status: JobStatus | undefined) {
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  if (status) query.set("status", status);
  const suffix = query.toString();
  return `/app/system/jobs${suffix ? `?${suffix}` : ""}` as Route;
}

function detailHref(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, id: string) {
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const suffix = query.toString();
  return `/app/system/jobs/${id}${suffix ? `?${suffix}` : ""}` as Route;
}
