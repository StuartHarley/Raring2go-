import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import {
  auditDeadLetter,
  cancelJob,
  createDrizzleJobStore,
  createDrizzleEngineStore,
  createDrizzleLegacyJobReader,
  createJobRegistry,
  createPruneJobHistoryHandler,
  createWorkflowJobHandlers,
  enqueueJob,
  ensureBuiltinWorkflows,
  EXECUTE_RUN_KIND,
  getJobDetailForActor,
  getTrackedJobCountsForActor,
  jobCapabilities,
  listTrackedJobsForActor,
  pruneJobHistoryIdempotencyKey,
  PRUNE_JOB_HISTORY_KIND,
  retryJob,
  retryLegacyJob,
  runDueJobs,
  WORKFLOW_TICK_KIND,
  workflowTickIdempotencyKey
} from "@raring2go/workflows";
import type { JobActorContext, JobAuditRecorder, JobCapability, JobFilter, JobSource, WorkflowsDb } from "@raring2go/workflows";
import { createPublishSocialHandler, PUBLISH_SOCIAL_KIND, publishSocialIdempotencyKey } from "./social-jobs";
import { createGenerateRenewalsHandler, GENERATE_RENEWALS_KIND, generateRenewalsIdempotencyKey } from "./advertising-jobs";
import { createOverdueInvoiceScanner, engineHooks, knownHooks, SCAN_OVERDUE_INVOICES_KIND, scanOverdueInvoicesIdempotencyKey } from "./automation-hooks";
import { createSnapshotMetricsHandler, SNAPSHOT_METRICS_KIND, snapshotMetricsIdempotencyKey } from "./analytics-runtime";
import { appLogger } from "./logger";
import { createEnforceRetentionHandler, ENFORCE_RETENTION_KIND, enforceRetentionIdempotencyKey } from "./security-runtime";
import { getPermissionData } from "./permission-source";

export type { JobActorContext };

export function hasJobCapability(permissions: PermissionData, context: JobActorContext, capability: JobCapability, resource?: { territoryId?: string | null }) {
  const required = jobCapabilities[capability];
  return evaluatePermission(
    {
      userId: context.userId,
      module: required.module,
      action: required.action,
      ...(resource
        ? { resource: { territoryId: resource.territoryId ?? undefined } }
        : { context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } })
    },
    permissions
  ).allowed;
}

/** Network/system-wide view, i.e. a grant that does not depend on any single territory. */
export function hasNetworkJobAccess(permissions: PermissionData, userId: string) {
  const required = jobCapabilities.view;
  return evaluatePermission({ userId, module: required.module, action: required.action }, permissions).allowed;
}

/**
 * Every kind with a registered handler. Kept as data next to the registry so pages can
 * decide whether to offer Retry without building a DB-backed registry; a unit test
 * asserts the two never drift apart.
 */
export const registeredJobKinds: string[] = [PRUNE_JOB_HISTORY_KIND, EXECUTE_RUN_KIND, WORKFLOW_TICK_KIND, SCAN_OVERDUE_INVOICES_KIND, SNAPSHOT_METRICS_KIND, ENFORCE_RETENTION_KIND, GENERATE_RENEWALS_KIND, PUBLISH_SOCIAL_KIND];

/** Handlers need a live DB handle, so the registry is built per request/tick. */
export function buildJobRegistry(db: WorkflowsDb) {
  const engine = createDrizzleEngineStore(db);
  return createJobRegistry([
    createPruneJobHistoryHandler(db),
    ...createWorkflowJobHandlers({ store: engine, hooks: engineHooks, jobs: createDrizzleJobStore(db) }),
    createOverdueInvoiceScanner(engine),
    createSnapshotMetricsHandler(),
    createEnforceRetentionHandler(),
    createGenerateRenewalsHandler(),
    createPublishSocialHandler()
  ]);
}

function auditFor(db: Parameters<typeof recordAuditEvent>[0]): JobAuditRecorder {
  return { record: (input) => recordAuditEvent(db, input) };
}

export async function readJobConsole(context: JobActorContext, filter: JobFilter = {}) {
  const jobsPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    const store = createDrizzleJobStore(db);
    const legacy = createDrizzleLegacyJobReader(db);
    const [jobs, counts] = await Promise.all([
      listTrackedJobsForActor(context, jobsPermissionData, store, legacy, { limit: 200, ...filter }),
      getTrackedJobCountsForActor(context, jobsPermissionData, store, legacy)
    ]);
    return { jobs, counts, registeredKinds: registeredJobKinds };
  } finally {
    await sql.end();
  }
}

export async function readJobDetail(context: JobActorContext, jobId: string) {
  const jobsPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await getJobDetailForActor(context, jobsPermissionData, createDrizzleJobStore(db), jobId);
  } finally {
    await sql.end();
  }
}

export async function retryJobAsActor(context: JobActorContext, jobId: string, source: JobSource = "jobs") {
  const jobsPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    const result = await db.transaction(async (tx) =>
      source === "jobs"
        ? retryJob(context, jobsPermissionData, auditFor(tx), createDrizzleJobStore(tx as unknown as WorkflowsDb), buildJobRegistry(db), jobId)
        : retryLegacyJob(context, jobsPermissionData, auditFor(tx), createDrizzleLegacyJobReader(tx as unknown as WorkflowsDb), source, jobId)
    );
    appLogger.info("job retried by operator", { jobId, source, actorUserId: context.userId });
    return result;
  } finally {
    await sql.end();
  }
}

export async function cancelJobAsActor(context: JobActorContext, jobId: string) {
  const jobsPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    const result = await db.transaction(async (tx) =>
      cancelJob(context, jobsPermissionData, auditFor(tx), createDrizzleJobStore(tx as unknown as WorkflowsDb), jobId)
    );
    appLogger.info("job cancelled by operator", { jobId, actorUserId: context.userId });
    return result;
  } finally {
    await sql.end();
  }
}

/** One cron tick: schedule the daily maintenance job, then drain what is due. */
export async function runJobWorkerTick(options: { workerId?: string; maxJobs?: number; timeBudgetMs?: number; correlationId?: string } = {}) {
  const { db, sql } = createDb();
  const log = appLogger.child({ component: "job-worker", correlationId: options.correlationId });

  try {
    const store = createDrizzleJobStore(db);
    const audit = auditFor(db);
    const now = new Date();

    await enqueueJob(store, audit, {
      kind: PRUNE_JOB_HISTORY_KIND,
      idempotencyKey: pruneJobHistoryIdempotencyKey(now),
      payload: { retentionDays: 30 },
      correlationId: `cron:${now.toISOString()}`
    });

    // Install defaults once (never overwrites admin edits), then keep the engine and scanner ticking.
    await ensureBuiltinWorkflows(createDrizzleEngineStore(db), knownHooks, now);
    await enqueueJob(store, undefined, { kind: WORKFLOW_TICK_KIND, idempotencyKey: workflowTickIdempotencyKey(now), correlationId: options.correlationId }, now);
    await enqueueJob(store, undefined, { kind: SCAN_OVERDUE_INVOICES_KIND, idempotencyKey: scanOverdueInvoicesIdempotencyKey(now), correlationId: options.correlationId }, now);
    await enqueueJob(store, undefined, { kind: SNAPSHOT_METRICS_KIND, idempotencyKey: snapshotMetricsIdempotencyKey(now), correlationId: options.correlationId }, now);
    await enqueueJob(store, undefined, { kind: ENFORCE_RETENTION_KIND, idempotencyKey: enforceRetentionIdempotencyKey(now), correlationId: options.correlationId }, now);
    await enqueueJob(store, undefined, { kind: PUBLISH_SOCIAL_KIND, idempotencyKey: publishSocialIdempotencyKey(now), correlationId: options.correlationId }, now);
    await enqueueJob(store, undefined, { kind: GENERATE_RENEWALS_KIND, idempotencyKey: generateRenewalsIdempotencyKey(now), correlationId: options.correlationId }, now);

    const summary = await runDueJobs(store, buildJobRegistry(db), {
      workerId: options.workerId ?? `web-${randomUUID().slice(0, 8)}`,
      maxJobs: options.maxJobs ?? 10,
      timeBudgetMs: options.timeBudgetMs ?? 45_000,
      hooks: {
        onSucceeded: (job) => log.info("job succeeded", { jobId: job.id, kind: job.kind, attempts: job.attempts }),
        onRetryScheduled: (job) =>
          log.warn("job failed, retry scheduled", { jobId: job.id, kind: job.kind, attempts: job.attempts, errorCode: job.lastErrorCode, error: job.lastError }),
        onDeadLettered: async (job) => {
          log.error("job dead-lettered", { jobId: job.id, kind: job.kind, attempts: job.attempts, errorCode: job.lastErrorCode, error: job.lastError });
          await auditDeadLetter(audit, job);
        }
      }
    });
    log.info("job worker tick complete", summary);
    return summary;
  } finally {
    await sql.end();
  }
}
