import { defineJobHandler } from "./registry";
import { pruneFinishedJobs } from "./repository";
import type { WorkflowsDb } from "./repository";

export const PRUNE_JOB_HISTORY_KIND = "ops.prune_job_history";
const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 7;

/**
 * Daily retention sweep for the job tables themselves. Idempotent by nature:
 * deleting already-deleted rows is a no-op.
 */
export function createPruneJobHistoryHandler(db: WorkflowsDb) {
  return defineJobHandler({
    kind: PRUNE_JOB_HISTORY_KIND,
    maxAttempts: 3,
    handle: async ({ job, now }) => {
      const requested = Number(job.payload.retentionDays ?? DEFAULT_RETENTION_DAYS);
      const retentionDays = Number.isFinite(requested) ? Math.max(MIN_RETENTION_DAYS, Math.floor(requested)) : DEFAULT_RETENTION_DAYS;
      const cutoff = new Date(now().getTime() - retentionDays * 86_400_000);
      const pruned = await pruneFinishedJobs(db, cutoff);
      return { pruned, retentionDays, cutoff: cutoff.toISOString() };
    }
  });
}

/** Stable per-day key so the sweep is enqueued once a day however often the runner ticks. */
export function pruneJobHistoryIdempotencyKey(now: Date) {
  return `${PRUNE_JOB_HISTORY_KIND}:${now.toISOString().slice(0, 10)}`;
}
