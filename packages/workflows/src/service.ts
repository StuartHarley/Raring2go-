import { auditActions } from "@raring2go/audit";
import type { RecordAuditEventInput } from "@raring2go/audit";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import { jobCapabilities } from "./permissions";
import type { JobCapability } from "./permissions";
import { canCancel, canRetryManually, retryBudget } from "./policy";
import type { JobRegistry } from "./registry";
import type {
  EnqueueJobInput,
  JobAttemptRecord,
  JobCounts,
  JobFilter,
  JobRecord,
  JobStore
} from "./types";

export type JobActorContext = {
  userId: string;
  organisationId?: string | null;
  territoryId?: string | null;
};

export type JobAuditRecorder = {
  record: (input: RecordAuditEventInput) => Promise<unknown>;
};

export class JobAccessError extends Error {
  constructor(message = "You do not have access to this job.") {
    super(message);
    this.name = "JobAccessError";
  }
}

export class JobStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobStateError";
  }
}

/**
 * Enqueue is a system-side operation (domain services call it from their own
 * authorised mutations), so it is idempotency-keyed rather than permission-gated.
 * A repeated key returns the original job and records nothing new.
 */
export async function enqueueJob(
  store: JobStore,
  audit: JobAuditRecorder | undefined,
  input: EnqueueJobInput,
  now: Date = new Date()
) {
  if (!input.idempotencyKey.trim()) {
    throw new Error("Jobs require an idempotency key.");
  }

  const result = await store.enqueue(input, now);

  if (result.created && audit) {
    await audit.record({
      action: auditActions.opsJobEnqueue,
      actor: input.createdByUserId
        ? { type: "human", userId: input.createdByUserId }
        : { type: "system", systemId: "job-queue" },
      entity: { type: "job", id: result.job.id },
      scope: scopeOf(result.job),
      context: { idempotencyKey: input.idempotencyKey, correlationId: input.correlationId ?? undefined },
      metadata: { kind: input.kind, subjectType: input.subjectType, subjectId: input.subjectId }
    });
  }

  return result;
}

function allowed(
  context: JobActorContext,
  permissions: PermissionData,
  capability: JobCapability,
  resource?: { organisationId?: string | null; territoryId?: string | null }
) {
  const { module, action } = jobCapabilities[capability];
  return evaluatePermission(
    {
      userId: context.userId,
      module,
      action,
      // Context is deliberately omitted when checking a concrete job: the job's own
      // territory/organisation must satisfy the grant, not the actor's active context.
      ...(resource
        ? {
            resource: {
              territoryId: resource.territoryId ?? undefined,
              organisationId: resource.territoryId ? undefined : resource.organisationId ?? undefined
            }
          }
        : {})
    },
    permissions
  ).allowed;
}

/**
 * Network/system grants see every job; territory-scoped grants are narrowed to the
 * actor's own territory in the query itself, then re-checked per job.
 */
function resolveVisibility(context: JobActorContext, permissions: PermissionData, capability: JobCapability) {
  if (allowed(context, permissions, capability)) {
    return { kind: "all" as const };
  }

  if (context.territoryId && allowed(context, permissions, capability, { territoryId: context.territoryId })) {
    return { kind: "territory" as const, territoryId: context.territoryId };
  }

  throw new JobAccessError(`Missing permission ${jobCapabilities[capability].module}.${jobCapabilities[capability].action}.`);
}

export async function listJobsForActor(
  context: JobActorContext,
  permissions: PermissionData,
  store: JobStore,
  filter: JobFilter = {}
): Promise<JobRecord[]> {
  const visibility = resolveVisibility(context, permissions, "view");
  if (visibility.kind === "territory" && filter.territoryId && filter.territoryId !== visibility.territoryId) {
    return [];
  }
  const scoped: JobFilter = visibility.kind === "territory" ? { ...filter, territoryId: visibility.territoryId } : filter;
  const jobs = await store.list(scoped);
  return jobs.filter((job) => visibility.kind === "all" || allowed(context, permissions, "view", job));
}

export async function getJobCountsForActor(
  context: JobActorContext,
  permissions: PermissionData,
  store: JobStore
): Promise<JobCounts> {
  const visibility = resolveVisibility(context, permissions, "view");
  return store.counts(visibility.kind === "territory" ? { territoryId: visibility.territoryId } : {});
}

export async function getJobDetailForActor(
  context: JobActorContext,
  permissions: PermissionData,
  store: JobStore,
  jobId: string
): Promise<{ job: JobRecord; attempts: JobAttemptRecord[] }> {
  resolveVisibility(context, permissions, "view");
  const job = await store.get(jobId);

  // Same error for "missing" and "not yours": do not confirm ids across scopes.
  if (!job || !allowed(context, permissions, "view", job)) {
    throw new JobAccessError("Job not found.");
  }

  return { job, attempts: await store.attempts(jobId) };
}

export async function retryJob(
  context: JobActorContext,
  permissions: PermissionData,
  audit: JobAuditRecorder,
  store: JobStore,
  registry: JobRegistry,
  jobId: string,
  now: Date = new Date()
): Promise<JobRecord> {
  const job = await store.get(jobId);

  if (!job || !allowed(context, permissions, "retry", job)) {
    throw new JobAccessError(job ? "Missing permission system.jobs.retry for this job." : "Job not found.");
  }

  if (!canRetryManually(job.status)) {
    throw new JobStateError(`A ${job.status} job cannot be retried. Only dead-lettered or cancelled jobs can.`);
  }

  const handler = registry.get(job.kind);

  if (!handler) {
    throw new JobStateError(`No handler is registered for ${job.kind}, so it cannot be retried safely.`);
  }

  const requeued = await store.requeue(jobId, { now, maxAttempts: retryBudget(job, handler.maxAttempts) });

  if (!requeued) {
    throw new JobStateError("The job changed state before it could be retried.");
  }

  await audit.record({
    action: auditActions.opsJobRetry,
    actor: { type: "human", userId: context.userId },
    entity: { type: "job", id: job.id },
    scope: scopeOf(job),
    before: { status: job.status, attempts: job.attempts, lastError: job.lastError },
    after: { status: requeued.status, maxAttempts: requeued.maxAttempts },
    metadata: { kind: job.kind, subjectType: job.subjectType, subjectId: job.subjectId }
  });

  return requeued;
}

export async function cancelJob(
  context: JobActorContext,
  permissions: PermissionData,
  audit: JobAuditRecorder,
  store: JobStore,
  jobId: string,
  now: Date = new Date()
): Promise<JobRecord> {
  const job = await store.get(jobId);

  if (!job || !allowed(context, permissions, "cancel", job)) {
    throw new JobAccessError(job ? "Missing permission system.jobs.cancel for this job." : "Job not found.");
  }

  if (!canCancel(job.status)) {
    throw new JobStateError(`A ${job.status} job cannot be cancelled. Only queued jobs can.`);
  }

  const cancelled = await store.cancel(jobId, now);

  if (!cancelled) {
    throw new JobStateError("The job started running before it could be cancelled.");
  }

  await audit.record({
    action: auditActions.opsJobCancel,
    actor: { type: "human", userId: context.userId },
    entity: { type: "job", id: job.id },
    scope: scopeOf(job),
    before: { status: job.status },
    after: { status: cancelled.status },
    metadata: { kind: job.kind, subjectType: job.subjectType, subjectId: job.subjectId }
  });

  return cancelled;
}

/** Records a dead-letter transition; wire into `runDueJobs` hooks. */
export async function auditDeadLetter(audit: JobAuditRecorder, job: JobRecord) {
  await audit.record({
    action: auditActions.opsJobDeadLettered,
    actor: { type: "system", systemId: "job-runner" },
    entity: { type: "job", id: job.id },
    scope: scopeOf(job),
    context: { idempotencyKey: job.idempotencyKey, correlationId: job.correlationId ?? undefined, jobId: job.id },
    metadata: {
      kind: job.kind,
      attempts: job.attempts,
      errorCode: job.lastErrorCode,
      error: job.lastError,
      subjectType: job.subjectType,
      subjectId: job.subjectId
    }
  });
}

function scopeOf(job: Pick<JobRecord, "organisationId" | "territoryId">) {
  return {
    organisationId: job.organisationId ?? undefined,
    territoryId: job.territoryId ?? undefined
  };
}
