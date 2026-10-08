import type { JobStatus } from "./types";

/**
 * Read model that lets the job console show one list across the generic `jobs`
 * table and the domain tables that predate it. Each legacy table keeps its own
 * state machine; the console only normalises how they are displayed.
 */
export const jobSources = ["jobs", "email_send", "social_publish", "website_publish", "publication_output"] as const;
export type JobSource = (typeof jobSources)[number];

export type TrackedJob = {
  source: JobSource;
  id: string;
  kind: string;
  status: JobStatus;
  /** The owning table's own status string, shown so normalisation never hides detail. */
  rawStatus: string;
  attempts: number;
  maxAttempts: number | null;
  lastError: string | null;
  organisationId: string | null;
  territoryId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Where the record itself (and its domain-native actions) lives. */
  traceHref: string | null;
};

/** Legacy sources whose failures the console can safely re-queue on the owner's behalf. */
export const retryableLegacySources: JobSource[] = ["email_send"];

export function normaliseLegacyStatus(source: Exclude<JobSource, "jobs">, raw: string): JobStatus {
  switch (source) {
    case "email_send":
      return { queued: "queued", processing: "running", completed: "succeeded", failed: "dead" }[raw] as JobStatus | undefined ?? "queued";
    case "social_publish":
      return { queued: "queued", running: "running", completed: "succeeded", failed: "dead", cancelled: "cancelled" }[raw] as JobStatus | undefined ?? "queued";
    case "website_publish":
      return { ready: "queued", queued: "queued", running: "running", published: "succeeded", completed: "succeeded", failed: "dead", cancelled: "cancelled" }[raw] as JobStatus | undefined ?? "queued";
    case "publication_output":
      return { generating: "running", generated: "succeeded", failed: "dead" }[raw] as JobStatus | undefined ?? "queued";
  }
}

export function traceHrefFor(source: Exclude<JobSource, "jobs">, subjectId: string | null): string | null {
  if (!subjectId) {
    return null;
  }
  switch (source) {
    case "email_send":
      return `/app/newsletters/${subjectId}`;
    case "social_publish":
      return "/app/social";
    case "website_publish":
      return "/app/content";
    case "publication_output":
      return `/app/editions/${subjectId}`;
  }
}

export function trackedFromJob(job: {
  id: string;
  kind: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  organisationId: string | null;
  territoryId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TrackedJob {
  return {
    source: "jobs",
    id: job.id,
    kind: job.kind,
    status: job.status,
    rawStatus: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    organisationId: job.organisationId,
    territoryId: job.territoryId,
    subjectType: job.subjectType,
    subjectId: job.subjectId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    traceHref: null
  };
}
