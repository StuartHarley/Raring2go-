import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { hasJobCapability, readJobConsole } from "../../../../../lib/jobs-runtime";
import type { JobActorContext } from "../../../../../lib/jobs-runtime";
import { StatusBadge } from "../../../../../lib/workflow-ui";
import { jobStatuses } from "@raring2go/workflows";
import type { JobStatus } from "@raring2go/workflows";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { cancelJobAction, retryJobAction } from "./actions";

const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  retried: { tone: "success", text: "Job re-queued. It will run on the next worker tick." },
  cancelled: { tone: "success", text: "Job cancelled." },
  not_allowed: { tone: "error", text: "You do not have permission to do that for this job." },
  wrong_state: { tone: "error", text: "That job is no longer in a state where this action applies. Refresh and try again." }
};

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
    return protectedOutcome(result.error);
  }

  const { context, jobs, counts, registeredKinds } = result;
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
                  <td colSpan={7}>
                    {status ? `No ${status} jobs.` : "No background jobs yet."} Registered job kinds: {registeredKinds.join(", ") || "none"}.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.createdAt.toLocaleString("en-GB")}</td>
                    <td>
                      <Link href={detailHref(request, job.id)}>{job.kind}</Link>
                    </td>
                    <td>
                      <StatusBadge status={job.status === "dead" ? "failed" : job.status === "succeeded" ? "completed" : job.status} />
                    </td>
                    <td>
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td>{job.subjectType ? `${job.subjectType}:${job.subjectId ?? ""}` : "-"}</td>
                    <td>{job.lastError ?? "-"}</td>
                    <td>
                      {job.status === "dead" || job.status === "cancelled" ? (
                        registeredKinds.includes(job.kind) && hasJobCapability(context, "retry", job) ? (
                          <form action={retryJobAction.bind(null, request, job.id)}>
                            <button type="submit">Retry</button>
                          </form>
                        ) : null
                      ) : null}
                      {job.status === "queued" && hasJobCapability(context, "cancel", job) ? (
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
    return { context, ...(await readJobConsole(context, status ? { statuses: [status] } : {})) };
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
