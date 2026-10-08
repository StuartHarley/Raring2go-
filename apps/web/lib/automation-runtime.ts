import { recordAuditEvent } from "@raring2go/audit";
import { createDb, fixtureIds } from "@raring2go/db";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import {
  automationCapabilities,
  completeTaskForActor,
  createDrizzleEngineStore,
  createDrizzleJobStore,
  createJobRunScheduler,
  decideApprovalForActor,
  getRunForActor,
  listApprovalsForActor,
  listNotificationsForActor,
  listRunsForActor,
  listTasksForActor
} from "@raring2go/workflows";
import type { AutomationCapability, JobActorContext, JobAuditRecorder, WorkflowsDb } from "@raring2go/workflows";
import { appLogger } from "./logger";

export type { JobActorContext as AutomationActorContext };

const permission = (key: AutomationCapability) => ({ id: `${automationCapabilities[key].module}.${automationCapabilities[key].action}`, ...automationCapabilities[key] });
const grant = (roleId: string, key: AutomationCapability, scope: string) => ({ roleId, permission: permission(key), scope, constraints: {} });

const hqCapabilities: AutomationCapability[] = ["taskView", "taskComplete", "approvalView", "approvalDecide", "workflowView", "workflowManage", "workflowActivate", "workflowTest"];
const territoryCapabilities: AutomationCapability[] = ["taskView", "taskComplete", "approvalView", "approvalDecide", "workflowView"];

export const automationPermissionData: PermissionData = {
  roleAssignments: [
    { id: "fixture_assignment_hq", userId: fixtureIds.users.superAdmin, roleId: fixtureIds.roles.hqAdmin, organisationId: fixtureIds.organisations.hq },
    {
      id: "fixture_assignment_franchisee",
      userId: fixtureIds.users.franchisee,
      roleId: fixtureIds.roles.franchisee,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield
    }
  ],
  territories: [
    { id: fixtureIds.territories.suttonColdfield, franchiseOrganisationId: fixtureIds.organisations.franchise },
    { id: fixtureIds.territories.solihull, franchiseOrganisationId: null }
  ],
  rolePermissions: [
    ...hqCapabilities.map((key) => grant(fixtureIds.roles.hqAdmin, key, "network")),
    ...territoryCapabilities.map((key) => grant(fixtureIds.roles.franchisee, key, "own_territory"))
  ]
};

export function hasAutomationCapability(context: JobActorContext, capability: AutomationCapability) {
  const { module, action } = automationCapabilities[capability];
  return evaluatePermission(
    { userId: context.userId, module, action, context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } },
    automationPermissionData
  ).allowed;
}

function auditFor(db: Parameters<typeof recordAuditEvent>[0]): JobAuditRecorder {
  return { record: (input) => recordAuditEvent(db, input) };
}

export async function readTasksAndApprovals(context: JobActorContext) {
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
