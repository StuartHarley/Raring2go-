export const jobStatuses = ["queued", "running", "succeeded", "dead", "cancelled"] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const attemptOutcomes = ["running", "succeeded", "failed", "timed_out", "dead"] as const;
export type AttemptOutcome = (typeof attemptOutcomes)[number];

export type JobRecord = {
  id: string;
  kind: string;
  status: JobStatus;
  idempotencyKey: string;
  organisationId: string | null;
  territoryId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  correlationId: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  leaseExpiresAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  lastErrorCode: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JobAttemptRecord = {
  id: string;
  jobId: string;
  attemptNumber: number;
  workerId: string;
  outcome: AttemptOutcome;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  error: string | null;
  errorCode: string | null;
};

export type EnqueueJobInput = {
  kind: string;
  idempotencyKey: string;
  organisationId?: string | null;
  territoryId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  correlationId?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date;
  createdByUserId?: string | null;
};

export type JobFilter = {
  statuses?: JobStatus[];
  kinds?: string[];
  organisationId?: string;
  territoryId?: string;
  subjectType?: string;
  subjectId?: string;
  limit?: number;
};

export type JobCounts = Record<JobStatus, number>;

/** What a handler sees. Handlers must be safe to run more than once for the same job. */
export type JobContext = {
  job: JobRecord;
  attemptNumber: number;
  workerId: string;
  now: () => Date;
};

export type JobHandlerResult = Record<string, unknown> | void;

export type JobHandler = {
  kind: string;
  /** Attempts before the job is dead-lettered. */
  maxAttempts: number;
  /** First retry delay; doubles each attempt up to `maxBackoffMs`. */
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** A running job whose worker has gone silent is reclaimable after this long. */
  leaseMs: number;
  handle: (context: JobContext) => Promise<JobHandlerResult>;
};

/**
 * Persistence port. The Drizzle implementation lives in repository.ts; tests use
 * an in-memory implementation so runner semantics are verified without a database.
 */
export type JobStore = {
  enqueue(input: EnqueueJobInput, now: Date): Promise<{ job: JobRecord; created: boolean }>;
  /**
   * Atomically claims the next runnable job (queued and due, or running with an
   * expired lease) and begins an attempt. Expired-lease claims close the abandoned
   * attempt as `timed_out`.
   */
  claim(input: { workerId: string; now: Date; leaseMs: (kind: string) => number; kinds: string[] }): Promise<
    { job: JobRecord; attempt: JobAttemptRecord } | undefined
  >;
  succeed(jobId: string, attemptId: string, result: Record<string, unknown>, now: Date): Promise<JobRecord>;
  fail(
    jobId: string,
    attemptId: string,
    outcome: { status: "queued" | "dead"; runAfter: Date; error: string; errorCode: string | null },
    now: Date
  ): Promise<JobRecord>;
  get(jobId: string): Promise<JobRecord | undefined>;
  attempts(jobId: string): Promise<JobAttemptRecord[]>;
  list(filter: JobFilter): Promise<JobRecord[]>;
  counts(filter: Pick<JobFilter, "organisationId" | "territoryId">): Promise<JobCounts>;
  requeue(jobId: string, input: { now: Date; maxAttempts: number }): Promise<JobRecord | undefined>;
  cancel(jobId: string, now: Date): Promise<JobRecord | undefined>;
};
