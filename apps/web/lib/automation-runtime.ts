import { recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import {
  activateDraftVersion,
  automationCapabilities,
  completeTaskForActor,
  createDraftVersion,
  createDrizzleEngineStore,
  createDrizzleJobStore,
  createJobRunScheduler,
  decideApprovalForActor,
  getRunForActor,
  getWorkflowDefinitionForActor,
  listApprovalsForActor,
  listNotificationsForActor,
  listRunsForActor,
  listTasksForActor,
  setWorkflowEnabled,
  testDraftVersion,
  updateDraftVersion
} from "@raring2go/workflows";
import type { AutomationCapability, JobActorContext, JobAuditRecorder, WorkflowsDb } from "@raring2go/workflows";
import { engineHooks, knownHooks } from "./automation-hooks";
import { appLogger } from "./logger";
import { getPermissionData } from "./permission-source";

export type { JobActorContext as AutomationActorContext };

export function hasAutomationCapability(permissions: PermissionData, context: JobActorContext, capability: AutomationCapability) {
  const { module, action } = automationCapabilities[capability];
  return evaluatePermission(
    { userId: context.userId, module, action, context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } },
    permissions
  ).allowed;
}

function auditFor(db: Parameters<typeof recordAuditEvent>[0]): JobAuditRecorder {
  return { record: (input) => recordAuditEvent(db, input) };
}

export async function readTasksAndApprovals(context: JobActorContext) {
  const automationPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    const store = createDrizzleEngineStore(db);
    const [tasks, approvals, notifications] = await Promise.all([
      listTasksForActor(context, automationPermissionData, store, { status: "open", limit: 100 }),
      listApprovalsForActor(context, automationPermissionData, store, { status: "pending", limit: 100 }),
      listNotificationsForActor(context, automationPermissionData, store, { limit: 20 })
    ]);
    return { tasks, approvals, notifications };
  } finally {
    await sql.end();
  }
}

export async function completeTaskAsActor(context: JobActorContext, taskId: string) {
  const automationPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    const task = await db.transaction(async (tx) =>
      completeTaskForActor(context, automationPermissionData, auditFor(tx), createDrizzleEngineStore(tx as unknown as WorkflowsDb), taskId)
    );
    appLogger.info("workflow task completed", { taskId, actorUserId: context.userId });
    return task;
  } finally {
    await sql.end();
  }
}

export async function decideApprovalAsActor(context: JobActorContext, approvalId: string, decision: { status: "approved" | "rejected"; note?: string | null }) {
  const automationPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    // Decision, audit event and the job that resumes the run commit together.
    const approval = await db.transaction(async (tx) => {
      const handle = tx as unknown as WorkflowsDb;
      return decideApprovalForActor(
        context,
        automationPermissionData,
        auditFor(tx),
        createDrizzleEngineStore(handle),
        createJobRunScheduler(createDrizzleJobStore(handle)),
        approvalId,
        decision
      );
    });
    appLogger.info("workflow approval decided", { approvalId, decision: decision.status, actorUserId: context.userId });
    return approval;
  } finally {
    await sql.end();
  }
}

export async function readWorkflowOverview(context: JobActorContext) {
  const automationPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    const store = createDrizzleEngineStore(db);
    const [definitions, active, runs] = await Promise.all([
      store.listDefinitions(),
      store.listActiveWorkflows(),
      listRunsForActor(context, automationPermissionData, store, { limit: 50 })
    ]);
    const activeByDefinition = new Map(active.map((entry) => [entry.definition.id, entry.version]));
    const names = new Map(definitions.map((definition) => [definition.id, definition.name]));
    return {
      definitions: definitions.map((definition) => ({ definition, activeVersion: activeByDefinition.get(definition.id) })),
      runs: runs.map((run) => ({ run, workflowName: names.get(run.definitionId) ?? "Unknown workflow" }))
    };
  } finally {
    await sql.end();
  }
}

export async function readWorkflowRun(context: JobActorContext, runId: string) {
  const automationPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    const store = createDrizzleEngineStore(db);
    const view = await getRunForActor(context, automationPermissionData, store, runId);
    const [definition, version] = await Promise.all([store.getDefinition(view.run.definitionId), store.getVersion(view.run.versionId)]);
    return { ...view, definition, version };
  } finally {
    await sql.end();
  }
}

export async function readWorkflowDefinition(context: JobActorContext, definitionId: string) {
  const automationPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await getWorkflowDefinitionForActor(context, automationPermissionData, createDrizzleEngineStore(db), definitionId);
  } finally {
    await sql.end();
  }
}

/** Runs `work` with an audited, transactional engine store. */
async function inTransaction<T>(work: (store: ReturnType<typeof createDrizzleEngineStore>, audit: JobAuditRecorder) => Promise<T>) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => work(createDrizzleEngineStore(tx as unknown as WorkflowsDb), auditFor(tx)));
  } finally {
    await sql.end();
  }
}

export async function createWorkflowDraft(context: JobActorContext, definitionId: string) {
  const automationPermissionData = await getPermissionData();
  return inTransaction((store, audit) => createDraftVersion(context, automationPermissionData, audit, store, definitionId));
}

export async function saveWorkflowDraft(context: JobActorContext, versionId: string, definition: unknown, changeNote: string | null) {
  const automationPermissionData = await getPermissionData();
  return inTransaction((store, audit) => updateDraftVersion(context, automationPermissionData, audit, store, knownHooks, versionId, definition, changeNote));
}

export async function testWorkflowDraft(context: JobActorContext, versionId: string, sample: { payload: Record<string, unknown>; territoryId?: string | null; subjectId?: string | null }) {
  const automationPermissionData = await getPermissionData();
  return inTransaction((store, audit) => testDraftVersion(context, automationPermissionData, audit, store, engineHooks, versionId, sample));
}

export async function activateWorkflowDraft(context: JobActorContext, versionId: string) {
  const automationPermissionData = await getPermissionData();
  return inTransaction((store, audit) => activateDraftVersion(context, automationPermissionData, audit, store, knownHooks, versionId));
}

export async function setWorkflowDefinitionEnabled(context: JobActorContext, definitionId: string, enabled: boolean) {
  const automationPermissionData = await getPermissionData();
  return inTransaction((store, audit) => setWorkflowEnabled(context, automationPermissionData, audit, store, definitionId, enabled));
}
