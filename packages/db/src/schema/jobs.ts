import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

/**
 * Generic durable job queue (OPS-001). Domain tables with their own job-shaped
 * rows (email sends, social publishes, website publishing) stay authoritative
 * for their own state; this table is for new long-running work and is the
 * target for the workflow engine.
 *
 * Statuses: queued, running, succeeded, dead, cancelled. A failed attempt that
 * still has budget goes back to `queued` with a later `run_after`; one that is
 * out of budget (or failed permanently) becomes `dead` - the dead-letter state.
 */
export const jobs = pgTable(
  "jobs",
  {
    id,
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    correlationId: text("correlation_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastErrorCode: text("last_error_code"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps
  },
  (table) => [
    uniqueIndex("jobs_idempotency_key_uidx").on(table.idempotencyKey),
    index("jobs_claim_idx").on(table.status, table.runAfter),
    index("jobs_kind_status_idx").on(table.kind, table.status),
    index("jobs_organisation_id_idx").on(table.organisationId),
    index("jobs_territory_id_idx").on(table.territoryId),
    index("jobs_subject_idx").on(table.subjectType, table.subjectId),
    index("jobs_lease_idx").on(table.status, table.leaseExpiresAt)
  ]
);

/** One immutable row per execution attempt, so a failure is traceable after a retry succeeds. */
export const jobAttempts = pgTable(
  "job_attempts",
  {
    id,
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    attemptNumber: integer("attempt_number").notNull(),
    workerId: text("worker_id").notNull(),
    outcome: text("outcome").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    error: text("error"),
    errorCode: text("error_code")
  },
  (table) => [
    uniqueIndex("job_attempts_job_attempt_uidx").on(table.jobId, table.attemptNumber),
    index("job_attempts_job_id_idx").on(table.jobId),
    index("job_attempts_outcome_idx").on(table.outcome)
  ]
);
