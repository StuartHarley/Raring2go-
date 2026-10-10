import Link from "next/link";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { hasJobCapability, hasNetworkJobAccess, readJobConsole } from "../../../../../lib/jobs-runtime";
import type { JobActorContext } from "../../../../../lib/jobs-runtime";
import { readSystemHealth } from "../../../../../lib/health-runtime";
import { formatCode, formatDateTime, formatLabel, formatLabels } from "../../../../../lib/format";
import { EmptyState, FilterTabs, Metrics, Notice, PageHeader, Panel, RecordCard, RecordList, StatusBadge, Table } from "../../../../../lib/page-ui";
import { jobStatuses, retryableLegacySources } from "@raring2go/workflows";
import type { JobSource, JobStatus, TrackedJob } from "@raring2go/workflows";
import { requestFromSearchParamsAndCookies } from "../../page";
import { cancelJobAction, retryJobAction } from "./actions";
import { getPermissionData } from "../../../../../lib/permission-source";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Background jobs" };

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

const statusLabels: Partial<Record<JobStatus, string>> = { dead: "Dead-lettered" };

/** "finance.sync_accounting" → "Finance sync accounting": dotted job kinds read as words. */

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
    return protectedOutcome(result.error);
  }

  const { context, permissions, jobs, counts, registeredKinds, health } = result;
  const resultParam = Array.isArray(params.result) ? params.result[0] : params.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const needsAttention = counts.dead;

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Background jobs"
        intro="The background work behind publishing, email and automation. A job that has used up its retries lands here as dead-lettered, and you can re-run it from the record it belongs to."
      />

      <Panel>
        <Metrics
          items={[
            { label: "Needs attention", value: needsAttention, tone: needsAttention > 0 ? "danger" : "success" },
            { label: "Queued", value: counts.queued, tone: counts.queued > 0 ? "info" : "neutral" },
            { label: "Running", value: counts.running, tone: counts.running > 0 ? "info" : "neutral" },
            { label: "Succeeded", value: counts.succeeded }
          ]}
        />
        {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}
        <FilterTabs
          label="Filter jobs by status"
          items={[
            { label: "All", href: withParams(request, undefined), current: !status },
            ...jobStatuses.map((candidate) => ({
              label: `${statusLabels[candidate] ?? formatLabel(candidate)} (${counts[candidate]})`,
              href: withParams(request, candidate),
              current: status === candidate
            }))
          ]}
        />
      </Panel>

      {health ? (
        <Panel eyebrow="Health" title="Is everything running?">
          <RecordList>
            {health.checks.map((check) => (
              <RecordCard
                key={check.name}
                title={formatLabel(check.name)}
                status={check.status === "ok" ? "healthy" : check.status === "degraded" ? "degraded" : "failed"}
                tone={check.status === "ok" ? "success" : check.status === "degraded" ? "warning" : "danger"}
                lines={[check.detail]}
              />
            ))}
          </RecordList>
        </Panel>
      ) : null}

      <Panel eyebrow="Queue" title="Every job">
        {jobs.length === 0 ? (
          <EmptyState title={status ? `No ${(statusLabels[status] ?? formatLabel(status)).toLowerCase()} jobs` : "No background jobs yet"}>
            Jobs appear here as workers pick up publishing, email and automation work.
            {registeredKinds.length > 0 ? ` Registered job kinds: ${formatLabels(registeredKinds.map((kind) => kind.replace(/\./g, " ")))}.` : ""}
          </EmptyState>
        ) : (
          <Table caption="Background jobs, newest first">
            <thead>
              <tr>
                <th scope="col">Created</th>
                <th scope="col">Source</th>
                <th scope="col">Kind</th>
                <th scope="col">Status</th>
                <th scope="col">Attempts</th>
                <th scope="col">Subject</th>
                <th scope="col">Last error</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={`${job.source}:${job.id}`}>
                  <td>{formatDateTime(job.createdAt)}</td>
                  <td>{sourceLabels[job.source]}</td>
                  <td>
                    {job.source === "jobs" ? (
                      <Link href={detailHref(request, job.id)}>{formatCode(job.kind)}</Link>
                    ) : job.traceHref ? (
                      <Link href={job.traceHref as Route}>{formatCode(job.kind)}</Link>
                    ) : (
                      formatCode(job.kind)
                    )}
                  </td>
                  <td>
                    <StatusBadge
                      status={statusLabels[job.status] ?? job.status}
                      tone={job.status === "dead" ? "danger" : job.status === "succeeded" ? "success" : job.status === "running" ? "info" : undefined}
                    />
                  </td>
                  <td>{job.maxAttempts != null ? `${job.attempts} of ${job.maxAttempts}` : "-"}</td>
                  <td>{job.subjectType ? formatLabel(job.subjectType) : "-"}</td>
                  <td>{job.lastError ?? "-"}</td>
                  <td>
                    {isRetryable(job, registeredKinds) && hasJobCapability(permissions, context, "retry", job) ? (
                      <form action={retryJobAction.bind(null, request, job.source, job.id)}>
                        <button type="submit" className="r2-button r2-button--secondary">
                          Retry
                        </button>
                      </form>
                    ) : null}
                    {job.source === "jobs" && job.status === "queued" && hasJobCapability(permissions, context, "cancel", job) ? (
                      <form action={cancelJobAction.bind(null, request, job.id)}>
                        <button type="submit" className="r2-button r2-button--danger">
                          Cancel
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
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
