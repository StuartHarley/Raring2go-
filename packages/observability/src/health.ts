export type HealthStatus = "ok" | "degraded" | "down";

export type HealthCheckResult = {
  name: string;
  status: HealthStatus;
  detail: string;
  durationMs: number;
  /** Check-specific numbers, e.g. queue depth. Never contains secrets. */
  data?: Record<string, number | string | boolean | null>;
};

export type HealthCheck = {
  name: string;
  /** A critical check being down makes the whole system `down`; otherwise it is `degraded`. */
  critical: boolean;
  run: () => Promise<Omit<HealthCheckResult, "name" | "durationMs">>;
};

export type HealthReport = {
  status: HealthStatus;
  checkedAt: string;
  checks: HealthCheckResult[];
};

const severity: Record<HealthStatus, number> = { ok: 0, degraded: 1, down: 2 };

export async function runHealthChecks(
  checks: HealthCheck[],
  options: { timeoutMs?: number; now?: () => Date } = {}
): Promise<HealthReport> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const now = options.now ?? (() => new Date());

  const results = await Promise.all(
    checks.map(async (check): Promise<HealthCheckResult & { critical: boolean }> => {
      const started = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        const outcome = await Promise.race([
          check.run(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
          })
        ]);
        return { name: check.name, critical: check.critical, durationMs: Date.now() - started, ...outcome };
      } catch (error) {
        return {
          name: check.name,
          critical: check.critical,
          status: "down",
          detail: error instanceof Error ? error.message : "check failed",
          durationMs: Date.now() - started
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    })
  );

  let status: HealthStatus = "ok";
  for (const result of results) {
    // A non-critical check can degrade the system but never take it fully down.
    const effective: HealthStatus = !result.critical && result.status === "down" ? "degraded" : result.status;
    if (severity[effective] > severity[status]) {
      status = effective;
    }
  }

  return {
    status,
    checkedAt: now().toISOString(),
    checks: results.map(({ critical: _critical, ...result }) => result)
  };
}

export type QueueHealthInput = {
  queued: number;
  /** Queued jobs whose run_after passed more than `staleAfterMs` ago: the worker is not draining. */
  overdueQueued: number;
  /** Running jobs whose lease expired: a worker died holding them. */
  expiredLeases: number;
  dead: number;
};

export type QueueHealthThresholds = { deadWarn: number; deadDown: number; overdueWarn: number; overdueDown: number };

export const defaultQueueThresholds: QueueHealthThresholds = { deadWarn: 1, deadDown: 25, overdueWarn: 1, overdueDown: 50 };

/** Pure so the policy is testable without a database. */
export function evaluateQueueHealth(
  input: QueueHealthInput,
  thresholds: QueueHealthThresholds = defaultQueueThresholds
): Omit<HealthCheckResult, "name" | "durationMs"> {
  const data = { ...input };
  const problems: string[] = [];
  let status: HealthStatus = "ok";

  const raise = (next: HealthStatus, problem: string) => {
    problems.push(problem);
    if (severity[next] > severity[status]) status = next;
  };

  if (input.overdueQueued >= thresholds.overdueDown) raise("down", `${input.overdueQueued} jobs are overdue: the worker looks stalled`);
  else if (input.overdueQueued >= thresholds.overdueWarn) raise("degraded", `${input.overdueQueued} jobs are overdue`);

  if (input.expiredLeases > 0) raise("degraded", `${input.expiredLeases} running jobs have an expired lease`);

  if (input.dead >= thresholds.deadDown) raise("down", `${input.dead} dead-lettered jobs need attention`);
  else if (input.dead >= thresholds.deadWarn) raise("degraded", `${input.dead} dead-lettered jobs need attention`);

  return {
    status,
    detail: problems.length > 0 ? problems.join("; ") : `${input.queued} queued, nothing overdue`,
    data
  };
}
