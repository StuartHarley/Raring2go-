import { randomUUID } from "node:crypto";
import type {
  EnqueueJobInput,
  JobAttemptRecord,
  JobCounts,
  JobFilter,
  JobRecord,
  JobStore
} from "./types";
import { jobStatuses } from "./types";

/**
 * In-memory JobStore with the same semantics as the Drizzle store. Used by unit
 * tests across the repo so queue behaviour is verifiable without a database.
 */
export function createInMemoryJobStore(): JobStore & { jobs: Map<string, JobRecord>; attemptRows: JobAttemptRecord[] } {
  const jobs = new Map<string, JobRecord>();
  const attemptRows: JobAttemptRecord[] = [];

  function update(jobId: string, patch: Partial<JobRecord>, now: Date) {
    const current = jobs.get(jobId);
    if (!current) {
      throw new Error(`Job ${jobId} not found.`);
    }
    const next = { ...current, ...patch, updatedAt: now };
    jobs.set(jobId, next);
    return next;
  }

  function closeAttempt(attemptId: string, patch: Partial<JobAttemptRecord>, now: Date) {
    const attempt = attemptRows.find((row) => row.id === attemptId);
    if (attempt) {
      Object.assign(attempt, patch, {
        finishedAt: now,
        durationMs: Math.max(0, now.getTime() - attempt.startedAt.getTime())
      });
    }
  }

  return {
    jobs,
    attemptRows,

    async enqueue(input: EnqueueJobInput, now) {
      const existing = [...jobs.values()].find((job) => job.idempotencyKey === input.idempotencyKey);
      if (existing) {
        return { job: existing, created: false };
      }
      const job: JobRecord = {
        id: randomUUID(),
        kind: input.kind,
        status: "queued",
        idempotencyKey: input.idempotencyKey,
        organisationId: input.organisationId ?? null,
        territoryId: input.territoryId ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        correlationId: input.correlationId ?? null,
        payload: input.payload ?? {},
        result: {},
        priority: input.priority ?? 0,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 5,
        runAfter: input.runAfter ?? now,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        completedAt: null,
        lastError: null,
        lastErrorCode: null,
        createdByUserId: input.createdByUserId ?? null,
        createdAt: now,
        updatedAt: now
      };
      jobs.set(job.id, job);
      return { job, created: true };
    },

    async claim({ workerId, now, leaseMs, kinds }) {
      const candidate = [...jobs.values()]
        .filter((job) => kinds.includes(job.kind))
        .filter(
          (job) =>
            (job.status === "queued" && job.runAfter <= now) ||
            (job.status === "running" && job.leaseExpiresAt != null && job.leaseExpiresAt <= now)
        )
        .sort((a, b) => b.priority - a.priority || a.runAfter.getTime() - b.runAfter.getTime())[0];

      if (!candidate) {
        return undefined;
      }

      if (candidate.status === "running") {
        const abandoned = attemptRows.find((row) => row.jobId === candidate.id && row.outcome === "running");
        if (abandoned) {
          closeAttempt(abandoned.id, { outcome: "timed_out", error: "Worker lease expired.", errorCode: "lease_expired" }, now);
        }
      }

      const job = update(
        candidate.id,
        {
          status: "running",
          attempts: candidate.attempts + 1,
          lockedAt: now,
          lockedBy: workerId,
          leaseExpiresAt: new Date(now.getTime() + leaseMs(candidate.kind))
        },
        now
      );
      const attempt: JobAttemptRecord = {
        id: randomUUID(),
        jobId: job.id,
        attemptNumber: job.attempts,
        workerId,
        outcome: "running",
        startedAt: now,
        finishedAt: null,
        durationMs: null,
        error: null,
        errorCode: null
      };
      attemptRows.push(attempt);
      return { job, attempt };
    },

    async succeed(jobId, attemptId, result, now) {
      closeAttempt(attemptId, { outcome: "succeeded" }, now);
      return update(
        jobId,
        { status: "succeeded", result, completedAt: now, lockedAt: null, lockedBy: null, leaseExpiresAt: null, lastError: null, lastErrorCode: null },
        now
      );
    },

    async fail(jobId, attemptId, outcome, now) {
      closeAttempt(
        attemptId,
        { outcome: outcome.status === "dead" ? "dead" : "failed", error: outcome.error, errorCode: outcome.errorCode },
        now
      );
      return update(
        jobId,
        {
          status: outcome.status,
          runAfter: outcome.runAfter,
          lastError: outcome.error,
          lastErrorCode: outcome.errorCode,
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          completedAt: outcome.status === "dead" ? now : null
        },
        now
      );
    },

    async get(jobId) {
      return jobs.get(jobId);
    },

    async attempts(jobId) {
      return attemptRows.filter((row) => row.jobId === jobId).sort((a, b) => a.attemptNumber - b.attemptNumber);
    },

    async list(filter: JobFilter) {
      return [...jobs.values()]
        .filter((job) => !filter.statuses || filter.statuses.includes(job.status))
        .filter((job) => !filter.kinds || filter.kinds.includes(job.kind))
        .filter((job) => !filter.organisationId || job.organisationId === filter.organisationId)
        .filter((job) => !filter.territoryId || job.territoryId === filter.territoryId)
        .filter((job) => !filter.subjectType || job.subjectType === filter.subjectType)
        .filter((job) => !filter.subjectId || job.subjectId === filter.subjectId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, filter.limit ?? 100);
    },

    async counts(filter) {
      const counts = Object.fromEntries(jobStatuses.map((status) => [status, 0])) as JobCounts;
      for (const job of jobs.values()) {
        if (filter.organisationId && job.organisationId !== filter.organisationId) continue;
        if (filter.territoryId && job.territoryId !== filter.territoryId) continue;
        counts[job.status] += 1;
      }
      return counts;
    },

    async requeue(jobId, { now, maxAttempts }) {
      const job = jobs.get(jobId);
      if (!job || (job.status !== "dead" && job.status !== "cancelled")) {
        return undefined;
      }
      return update(
        jobId,
        { status: "queued", runAfter: now, maxAttempts, completedAt: null, lockedAt: null, lockedBy: null, leaseExpiresAt: null },
        now
      );
    },

    async cancel(jobId, now) {
      const job = jobs.get(jobId);
      if (!job || job.status !== "queued") {
        return undefined;
      }
      return update(jobId, { status: "cancelled", completedAt: now }, now);
    }
  };
}
