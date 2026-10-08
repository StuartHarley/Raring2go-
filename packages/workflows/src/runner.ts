import { RetryableJobError } from "./errors";
import { planFailure } from "./policy";
import type { JobRegistry } from "./registry";
import type { JobHandler, JobRecord, JobStore } from "./types";

export type JobRunnerHooks = {
  onSucceeded?: (job: JobRecord) => void | Promise<void>;
  onRetryScheduled?: (job: JobRecord) => void | Promise<void>;
  /** Fired once when a job enters the dead-letter state; use it to audit/alert. */
  onDeadLettered?: (job: JobRecord) => void | Promise<void>;
};

export type RunJobsOptions = {
  workerId: string;
  maxJobs?: number;
  /** Stop claiming new jobs once this much wall time has elapsed. */
  timeBudgetMs?: number;
  now?: () => Date;
  random?: () => number;
  hooks?: JobRunnerHooks;
};

export type RunJobsSummary = {
  claimed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
};

/**
 * Drains due jobs. A handler's side effects may have happened even if recording
 * the outcome fails, so handlers MUST be idempotent: the lease will expire and
 * the job will be re-run.
 */
export async function runDueJobs(store: JobStore, registry: JobRegistry, options: RunJobsOptions): Promise<RunJobsSummary> {
  const now = options.now ?? (() => new Date());
  const maxJobs = options.maxJobs ?? 10;
  const startedAt = now().getTime();
  const summary: RunJobsSummary = { claimed: 0, succeeded: 0, retried: 0, deadLettered: 0 };

  while (summary.claimed < maxJobs) {
    if (options.timeBudgetMs != null && now().getTime() - startedAt >= options.timeBudgetMs) {
      break;
    }

    const claimed = await store.claim({
      workerId: options.workerId,
      now: now(),
      leaseMs: (kind) => registry.get(kind)?.leaseMs ?? 60_000,
      kinds: registry.kinds()
    });

    if (!claimed) {
      break;
    }

    summary.claimed += 1;
    const { job, attempt } = claimed;
    const handler = registry.get(job.kind);

    if (!handler) {
      // Claim is filtered by registered kinds, so this only guards against a race with deploys.
      const failed = await store.fail(
        job.id,
        attempt.id,
        { status: "dead", runAfter: now(), error: `No handler registered for ${job.kind}.`, errorCode: "no_handler" },
        now()
      );
      summary.deadLettered += 1;
      await options.hooks?.onDeadLettered?.(failed);
      continue;
    }

    try {
      const result = await executeWithTimeout(handler, {
        job,
        attemptNumber: attempt.attemptNumber,
        workerId: options.workerId,
        now
      });
      const done = await store.succeed(job.id, attempt.id, (result ?? {}) as Record<string, unknown>, now());
      summary.succeeded += 1;
      await options.hooks?.onSucceeded?.(done);
    } catch (error) {
      const plan = planFailure(job, handler, error, now(), options.random);
      const failed = await store.fail(job.id, attempt.id, plan, now());

      if (plan.status === "dead") {
        summary.deadLettered += 1;
        await options.hooks?.onDeadLettered?.(failed);
      } else {
        summary.retried += 1;
        await options.hooks?.onRetryScheduled?.(failed);
      }
    }
  }

  return summary;
}

async function executeWithTimeout(handler: JobHandler, context: Parameters<JobHandler["handle"]>[0]) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      handler.handle(context),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RetryableJobError(`Handler exceeded its ${handler.leaseMs}ms lease.`, { code: "timeout" })),
          handler.leaseMs
        );
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
