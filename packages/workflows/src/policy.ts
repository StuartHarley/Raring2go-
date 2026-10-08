import { PermanentJobError, RetryableJobError } from "./errors";
import type { JobHandler, JobRecord, JobStatus } from "./types";

const MAX_ERROR_LENGTH = 2000;

/**
 * Exponential backoff with deterministic "full jitter" in [50%, 100%] of the
 * ceiling. `random` is injectable so tests (and replays) are deterministic.
 */
export function computeBackoffMs(
  attemptNumber: number,
  handler: Pick<JobHandler, "baseBackoffMs" | "maxBackoffMs">,
  random: () => number = Math.random
) {
  const exponent = Math.max(0, attemptNumber - 1);
  const ceiling = Math.min(handler.maxBackoffMs, handler.baseBackoffMs * 2 ** exponent);
  return Math.round(ceiling * (0.5 + random() * 0.5));
}

export type FailurePlan = {
  status: "queued" | "dead";
  runAfter: Date;
  error: string;
  errorCode: string | null;
};

/** Decides what happens after an attempt throws. Pure: no clock, no I/O. */
export function planFailure(
  job: Pick<JobRecord, "attempts" | "maxAttempts">,
  handler: Pick<JobHandler, "baseBackoffMs" | "maxBackoffMs">,
  error: unknown,
  now: Date,
  random: () => number = Math.random
): FailurePlan {
  const message = sanitiseErrorMessage(error);

  if (error instanceof PermanentJobError) {
    return { status: "dead", runAfter: now, error: message, errorCode: error.code };
  }

  const errorCode = error instanceof RetryableJobError ? error.code : "error";

  if (job.attempts >= job.maxAttempts) {
    return { status: "dead", runAfter: now, error: message, errorCode: "attempts_exhausted" };
  }

  const delay =
    error instanceof RetryableJobError && error.retryAfterMs != null
      ? Math.min(Math.max(0, error.retryAfterMs), handler.maxBackoffMs)
      : computeBackoffMs(job.attempts, handler, random);

  return { status: "queued", runAfter: new Date(now.getTime() + delay), error: message, errorCode };
}

/**
 * Error text is shown in the console, so keep it bounded and strip anything that
 * looks like a credential before it is persisted.
 */
export function sanitiseErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  const scrubbed = raw
    .replace(/(bearer|basic)\s+[a-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/(token|secret|password|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1$2[redacted]");
  return scrubbed.length > MAX_ERROR_LENGTH ? `${scrubbed.slice(0, MAX_ERROR_LENGTH)}…` : scrubbed;
}

export function isLeaseExpired(job: Pick<JobRecord, "status" | "leaseExpiresAt">, now: Date) {
  return job.status === "running" && job.leaseExpiresAt != null && job.leaseExpiresAt.getTime() <= now.getTime();
}

const manuallyRetryable: JobStatus[] = ["dead", "cancelled"];
const cancellable: JobStatus[] = ["queued"];

/** Only terminal-failure states may be retried by hand; running/succeeded jobs never can. */
export function canRetryManually(status: JobStatus) {
  return manuallyRetryable.includes(status);
}

export function canCancel(status: JobStatus) {
  return cancellable.includes(status);
}

export const retryBudget = (job: Pick<JobRecord, "attempts">, handlerMaxAttempts: number) =>
  job.attempts + Math.max(1, handlerMaxAttempts);
