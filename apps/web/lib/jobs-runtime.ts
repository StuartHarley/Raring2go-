import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb, fixtureIds } from "@raring2go/db";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import {
  auditDeadLetter,
  cancelJob,
  createDrizzleJobStore,
  createDrizzleLegacyJobReader,
  createJobRegistry,
  createPruneJobHistoryHandler,
  enqueueJob,
  getJobDetailForActor,
  getTrackedJobCountsForActor,
  jobCapabilities,
  listTrackedJobsForActor,
  pruneJobHistoryIdempotencyKey,
  PRUNE_JOB_HISTORY_KIND,
  retryJob,
  retryLegacyJob,
  runDueJobs
} from "@raring2go/workflows";
import type { JobActorContext, JobAuditRecorder, JobCapability, JobFilter, JobSource, WorkflowsDb } from "@raring2go/workflows";
import { appLogger } from "./logger";

export type { JobActorContext };

const grant = (roleId: string, permissionId: string, scope: string) => ({
  roleId,
  permission: permissionRef(permissionId),
  scope,
  constraints: {}
});

function permissionRef(permissionId: string) {
  const row = jobPermissionRows.find((candidate) => candidate.id === permissionId);
  if (!row) {
    throw new Error(`Unknown job permission ${permissionId}.`);
  }
  return row;
}

const jobPermissionRows = [
  { id: fixtureIds.permissions.jobsView, module: jobCapabilities.view.module, action: jobCapabilities.view.action },
  { id: fixtureIds.permissions.jobsRetry, module: jobCapabilities.retry.module, action: jobCapabilities.retry.action },
  { id: fixtureIds.permissions.jobsCancel, module: jobCapabilities.cancel.module, action: jobCapabilities.cancel.action }
];

export const jobsPermissionData: PermissionData = {
  roleAssignments: [
    {
      id: "fixture_assignment_hq",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.hqAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_franchisee",
      userId: fixtureIds.users.franchisee,
      roleId: fixtureIds.roles.franchisee,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield
    }
  ],
  rolePermissions: [
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.jobsView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.jobsRetry, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.jobsCancel, "network"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.jobsView, "own_territory")
  ]
};

export function hasJobCapability(context: JobActorContext, capability: JobCapability, resource?: { territoryId?: string | null }) {
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
    jobsPermissionData
  ).allowed;
}

/** Network/system-wide view, i.e. a grant that does not depend on any single territory. */
export function hasNetworkJobAccess(userId: string) {
  const required = jobCapabilities.view;
  return evaluatePermission({ userId, module: required.module, action: required.action }, jobsPermissionData).allowed;
}

/**
 * Every kind with a registered handler. Kept as data next to the registry so pages can
 * decide whether to offer Retry without building a DB-backed registry; a unit test
 * asserts the two never drift apart.
 */
export const registeredJobKinds: string[] = [PRUNE_JOB_HISTORY_KIND];

/** Handlers need a live DB handle, so the registry is built per request/tick. */
export function buildJobRegistry(db: WorkflowsDb) {
  return createJobRegistry([createPruneJobHistoryHandler(db)]);
}

function auditFor(db: Parameters<typeof recordAuditEvent>[0]): JobAuditRecorder {
  return { record: (input) => recordAuditEvent(db, input) };
}

export async function readJobConsole(context: JobActorContext, filter: JobFilter = {}) {
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
  const { db, sql } = createDb();

  try {
    return await getJobDetailForActor(context, jobsPermissionData, createDrizzleJobStore(db), jobId);
  } finally {
    await sql.end();
  }
}

export async function retryJobAsActor(context: JobActorContext, jobId: string, source: JobSource = "jobs") {
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
