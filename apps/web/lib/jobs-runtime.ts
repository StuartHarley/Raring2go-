import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb, fixtureIds } from "@raring2go/db";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import {
  auditDeadLetter,
  cancelJob,
  createDrizzleJobStore,
  createJobRegistry,
  createPruneJobHistoryHandler,
  enqueueJob,
  getJobCountsForActor,
  getJobDetailForActor,
  jobCapabilities,
  listJobsForActor,
  pruneJobHistoryIdempotencyKey,
  PRUNE_JOB_HISTORY_KIND,
  retryJob,
  runDueJobs
} from "@raring2go/workflows";
import type { JobActorContext, JobAuditRecorder, JobCapability, JobFilter, WorkflowsDb } from "@raring2go/workflows";

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
    const [jobs, counts] = await Promise.all([
      listJobsForActor(context, jobsPermissionData, store, { limit: 200, ...filter }),
      getJobCountsForActor(context, jobsPermissionData, store)
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

export async function retryJobAsActor(context: JobActorContext, jobId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) =>
      retryJob(context, jobsPermissionData, auditFor(tx), createDrizzleJobStore(tx as unknown as WorkflowsDb), buildJobRegistry(db), jobId)
    );
  } finally {
    await sql.end();
  }
}

export async function cancelJobAsActor(context: JobActorContext, jobId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) =>
      cancelJob(context, jobsPermissionData, auditFor(tx), createDrizzleJobStore(tx as unknown as WorkflowsDb), jobId)
    );
  } finally {
    await sql.end();
  }
}

/** One cron tick: schedule the daily maintenance job, then drain what is due. */
export async function runJobWorkerTick(options: { workerId?: string; maxJobs?: number; timeBudgetMs?: number } = {}) {
  const { db, sql } = createDb();

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

    return await runDueJobs(store, buildJobRegistry(db), {
      workerId: options.workerId ?? `web-${randomUUID().slice(0, 8)}`,
      maxJobs: options.maxJobs ?? 10,
      timeBudgetMs: options.timeBudgetMs ?? 45_000,
      hooks: { onDeadLettered: (job) => auditDeadLetter(audit, job) }
    });
  } finally {
    await sql.end();
  }
}
