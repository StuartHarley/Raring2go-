import { jobAttempts, jobs } from "@raring2go/db";
import type { createDb } from "@raring2go/db";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type {
  EnqueueJobInput,
  JobAttemptRecord,
  JobCounts,
  JobFilter,
  JobRecord,
  JobStatus,
  JobStore
} from "./types";
import { jobStatuses } from "./types";

export type WorkflowsDb = ReturnType<typeof createDb>["db"];

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

function toJob(row: typeof jobs.$inferSelect): JobRecord {
  return { ...row, status: row.status as JobStatus };
}

function toAttempt(row: typeof jobAttempts.$inferSelect): JobAttemptRecord {
  return { ...row, outcome: row.outcome as JobAttemptRecord["outcome"] };
}

export function createDrizzleJobStore(db: WorkflowsDb): JobStore {
  return {
    async enqueue(input: EnqueueJobInput, now: Date) {
      const [inserted] = await db
        .insert(jobs)
        .values({
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
          organisationId: input.organisationId ?? null,
          territoryId: input.territoryId ?? null,
          subjectType: input.subjectType ?? null,
          subjectId: input.subjectId ?? null,
          correlationId: input.correlationId ?? null,
          payload: input.payload ?? {},
          priority: input.priority ?? 0,
          maxAttempts: input.maxAttempts ?? 5,
          runAfter: input.runAfter ?? now,
          createdByUserId: input.createdByUserId ?? null,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing({ target: jobs.idempotencyKey })
        .returning();

      if (inserted) {
        return { job: toJob(inserted), created: true };
      }

      const [existing] = await db.select().from(jobs).where(eq(jobs.idempotencyKey, input.idempotencyKey));

      if (!existing) {
        throw new Error("Job enqueue conflicted but the existing job could not be loaded.");
      }

      return { job: toJob(existing), created: false };
    },

    async claim({ workerId, now, leaseMs, kinds }) {
      if (kinds.length === 0) {
        return undefined;
      }

      const leases = JSON.stringify(Object.fromEntries(kinds.map((kind) => [kind, leaseMs(kind)])));
      const nowIso = now.toISOString();

      return db.transaction(async (tx) => {
        // Close the attempt of any worker that went silent before we take its job over.
        await tx.execute(sql`
          UPDATE job_attempts
          SET outcome = 'timed_out', error = 'Worker lease expired.', error_code = 'lease_expired',
              finished_at = ${nowIso}::timestamptz,
              duration_ms = GREATEST(0, (extract(epoch from (${nowIso}::timestamptz - started_at)) * 1000)::int)
          WHERE outcome = 'running'
            AND job_id IN (
              SELECT id FROM jobs
              WHERE status = 'running' AND lease_expires_at <= ${nowIso}::timestamptz
            )
        `);

        const claimed = await tx.execute(sql`
          UPDATE jobs
          SET status = 'running',
              attempts = attempts + 1,
              locked_at = ${nowIso}::timestamptz,
              locked_by = ${workerId},
              lease_expires_at = ${nowIso}::timestamptz
                + ((${leases}::jsonb ->> kind)::int * interval '1 millisecond'),
              updated_at = ${nowIso}::timestamptz
          WHERE id = (
            SELECT id FROM jobs
            WHERE kind = ANY(${sql`ARRAY[${sql.join(kinds.map((kind) => sql`${kind}`), sql`, `)}]::text[]`})
              AND (
                (status = 'queued' AND run_after <= ${nowIso}::timestamptz)
                OR (status = 'running' AND lease_expires_at <= ${nowIso}::timestamptz)
              )
            ORDER BY priority DESC, run_after ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id
        `);

        const claimedId = (claimed as unknown as Array<{ id: string }>)[0]?.id;

        if (!claimedId) {
          return undefined;
        }

        const [row] = await tx.select().from(jobs).where(eq(jobs.id, claimedId));

        if (!row) {
          return undefined;
        }

        const [attempt] = await tx
          .insert(jobAttempts)
          .values({ jobId: row.id, attemptNumber: row.attempts, workerId, startedAt: now })
          .returning();

        if (!attempt) {
          throw new Error("Job attempt was not recorded.");
        }

        return { job: toJob(row), attempt: toAttempt(attempt) };
      });
    },

    async succeed(jobId, attemptId, result, now) {
      return db.transaction(async (tx) => {
        await closeAttempt(tx, attemptId, { outcome: "succeeded" }, now);
        const [row] = await tx
          .update(jobs)
          .set({
            status: "succeeded",
            result,
            completedAt: now,
            lockedAt: null,
            lockedBy: null,
            leaseExpiresAt: null,
            lastError: null,
            lastErrorCode: null,
            updatedAt: now
          })
          .where(eq(jobs.id, jobId))
          .returning();
        return requireRow(row, jobId);
      });
    },

    async fail(jobId, attemptId, outcome, now) {
      return db.transaction(async (tx) => {
        await closeAttempt(
          tx,
          attemptId,
          { outcome: outcome.status === "dead" ? "dead" : "failed", error: outcome.error, errorCode: outcome.errorCode },
          now
        );
        const [row] = await tx
          .update(jobs)
          .set({
            status: outcome.status,
            runAfter: outcome.runAfter,
            lastError: outcome.error,
            lastErrorCode: outcome.errorCode,
            lockedAt: null,
            lockedBy: null,
            leaseExpiresAt: null,
            completedAt: outcome.status === "dead" ? now : null,
            updatedAt: now
          })
          .where(eq(jobs.id, jobId))
          .returning();
        return requireRow(row, jobId);
      });
    },

    async get(jobId) {
      const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      return row ? toJob(row) : undefined;
    },

    async attempts(jobId) {
      const rows = await db.select().from(jobAttempts).where(eq(jobAttempts.jobId, jobId)).orderBy(asc(jobAttempts.attemptNumber));
      return rows.map(toAttempt);
    },

    async list(filter: JobFilter) {
      const rows = await db
        .select()
        .from(jobs)
        .where(and(...jobFilterConditions(filter)))
        .orderBy(desc(jobs.createdAt))
        .limit(Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
      return rows.map(toJob);
    },

    async counts(filter) {
      const conditions = [];
      if (filter.organisationId) conditions.push(eq(jobs.organisationId, filter.organisationId));
      if (filter.territoryId) conditions.push(eq(jobs.territoryId, filter.territoryId));

      const rows = await db
        .select({ status: jobs.status, total: sql<number>`count(*)::int` })
        .from(jobs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(jobs.status);

      const counts = Object.fromEntries(jobStatuses.map((status) => [status, 0])) as JobCounts;
      for (const row of rows) {
        if (row.status in counts) {
          counts[row.status as JobStatus] = row.total;
        }
      }
      return counts;
    },

    async requeue(jobId, { now, maxAttempts }) {
      const [row] = await db
        .update(jobs)
        .set({
          status: "queued",
          runAfter: now,
          maxAttempts,
          completedAt: null,
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          updatedAt: now
        })
        .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["dead", "cancelled"])))
        .returning();
      return row ? toJob(row) : undefined;
    },

    async cancel(jobId, now) {
      const [row] = await db
        .update(jobs)
        .set({ status: "cancelled", completedAt: now, updatedAt: now })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, "queued")))
        .returning();
      return row ? toJob(row) : undefined;
    }
  };
}

type Tx = Parameters<Parameters<WorkflowsDb["transaction"]>[0]>[0];

async function closeAttempt(
  tx: Tx,
  attemptId: string,
  patch: { outcome: string; error?: string; errorCode?: string | null },
  now: Date
) {
  await tx
    .update(jobAttempts)
    .set({
      outcome: patch.outcome,
      error: patch.error ?? null,
      errorCode: patch.errorCode ?? null,
      finishedAt: now,
      durationMs: sql`GREATEST(0, (extract(epoch from (${now.toISOString()}::timestamptz - ${jobAttempts.startedAt})) * 1000)::int)`
    })
    .where(eq(jobAttempts.id, attemptId));
}

function jobFilterConditions(filter: JobFilter) {
  const conditions = [];
  if (filter.statuses && filter.statuses.length > 0) conditions.push(inArray(jobs.status, filter.statuses));
  if (filter.kinds && filter.kinds.length > 0) conditions.push(inArray(jobs.kind, filter.kinds));
  if (filter.organisationId) conditions.push(eq(jobs.organisationId, filter.organisationId));
  if (filter.territoryId) conditions.push(eq(jobs.territoryId, filter.territoryId));
  if (filter.subjectType) conditions.push(eq(jobs.subjectType, filter.subjectType));
  if (filter.subjectId) conditions.push(eq(jobs.subjectId, filter.subjectId));
  return conditions;
}

function requireRow(row: typeof jobs.$inferSelect | undefined, jobId: string): JobRecord {
  if (!row) {
    throw new Error(`Job ${jobId} not found.`);
  }
  return toJob(row);
}

/**
 * Retention: removes finished (succeeded/cancelled) jobs and their attempts older
 * than the cutoff. Dead-lettered jobs are kept until someone resolves them.
 */
export async function pruneFinishedJobs(db: WorkflowsDb, olderThan: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const stale = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(inArray(jobs.status, ["succeeded", "cancelled"]), lt(jobs.completedAt, olderThan)));

    if (stale.length === 0) {
      return 0;
    }

    const ids = stale.map((row) => row.id);
    await tx.delete(jobAttempts).where(inArray(jobAttempts.jobId, ids));
    await tx.delete(jobs).where(inArray(jobs.id, ids));
    return ids.length;
  });
}
