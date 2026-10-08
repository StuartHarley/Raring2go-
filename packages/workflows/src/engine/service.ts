import { auditActions } from "@raring2go/audit";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import { JobAccessError, JobStateError } from "../service";
import type { JobActorContext, JobAuditRecorder } from "../service";
import { runIdempotencyKey } from "./dispatch";
import type { RunScheduler } from "./dispatch";
import { automationCapabilities } from "./permissions";
import type { AutomationCapability } from "./permissions";
import type { EngineStore } from "./store";
import type { NotificationRecord, RunStepRecord, WorkflowApprovalRecord, WorkflowRunRecord, WorkflowTaskRecord } from "./types";

type Scoped = { territoryId: string | null; organisationId: string | null };
/** Items for Head Office carry a territory (what they are about) but are not the territory's to action. */
type Assigned = Scoped & { audience: "territory" | "hq" };

function allowed(context: JobActorContext, permissions: PermissionData, capability: AutomationCapability, item?: Assigned) {
  const { module, action } = automationCapabilities[capability];
  const base = { userId: context.userId, module, action };

  // Network-level check: no context and no resource, so only network/system grants pass.
  if (!item || item.audience === "hq") {
    return evaluatePermission(base, permissions).allowed;
  }

  return evaluatePermission(
    { ...base, resource: { territoryId: item.territoryId ?? undefined, organisationId: item.territoryId ? undefined : item.organisationId ?? undefined } },
    permissions
  ).allowed;
}

/** Network grants see everything; a territory grant narrows queries to the actor's territory. */
function visibility(context: JobActorContext, permissions: PermissionData, capability: AutomationCapability) {
  if (allowed(context, permissions, capability)) return { kind: "all" as const };
  if (context.territoryId) {
    const { module, action } = automationCapabilities[capability];
    const ok = evaluatePermission({ userId: context.userId, module, action, resource: { territoryId: context.territoryId } }, permissions).allowed;
    if (ok) return { kind: "territory" as const, territoryId: context.territoryId };
  }
  throw new JobAccessError(`Missing permission ${automationCapabilities[capability].module}.${automationCapabilities[capability].action}.`);
}

const taskItem = (task: WorkflowTaskRecord): Assigned => ({ territoryId: task.territoryId, organisationId: task.organisationId, audience: task.assigneeScope });
const approvalItem = (approval: WorkflowApprovalRecord): Assigned => ({ territoryId: approval.territoryId, organisationId: approval.organisationId, audience: approval.approverScope });

export async function listTasksForActor(
  context: JobActorContext,
  permissions: PermissionData,
  store: EngineStore,
  filter: { status?: WorkflowTaskRecord["status"]; limit?: number } = {}
): Promise<WorkflowTaskRecord[]> {
  const scope = visibility(context, permissions, "taskView");
  const tasks = await store.listTasks({ ...filter, ...(scope.kind === "territory" ? { territoryId: scope.territoryId, assigneeScope: "territory" as const } : {}) });
  return tasks.filter((task) => allowed(context, permissions, "taskView", taskItem(task)));
}

export async function completeTaskForActor(
  context: JobActorContext,
  permissions: PermissionData,
  audit: JobAuditRecorder,
  store: EngineStore,
  taskId: string,
  now: Date = new Date()
): Promise<WorkflowTaskRecord> {
  const task = await store.getTask(taskId);
  if (!task || !allowed(context, permissions, "taskComplete", taskItem(task))) {
    throw new JobAccessError(task ? "Missing permission automation.task.complete for this task." : "Task not found.");
  }
  if (task.status !== "open") throw new JobStateError(`This task is already ${task.status}.`);

  const done = await store.completeTask(taskId, context.userId, now);
  if (!done) throw new JobStateError("This task was completed by someone else first.");

  await audit.record({
    action: auditActions.workflowTaskComplete,
    actor: { type: "human", userId: context.userId },
    entity: { type: "workflow_task", id: task.id },
    scope: { organisationId: task.organisationId ?? undefined, territoryId: task.territoryId ?? undefined },
    before: { status: task.status },
    after: { status: done.status },
    metadata: { runId: task.runId, title: task.title }
  });
  return done;
}

export async function listApprovalsForActor(
  context: JobActorContext,
  permissions: PermissionData,
  store: EngineStore,
  filter: { status?: WorkflowApprovalRecord["status"]; limit?: number } = {}
): Promise<WorkflowApprovalRecord[]> {
  const scope = visibility(context, permissions, "approvalView");
  const approvals = await store.listApprovals({ ...filter, ...(scope.kind === "territory" ? { territoryId: scope.territoryId, approverScope: "territory" as const } : {}) });
  return approvals.filter((approval) => allowed(context, permissions, "approvalView", approvalItem(approval)));
}

export async function decideApprovalForActor(
  context: JobActorContext,
  permissions: PermissionData,
  audit: JobAuditRecorder,
  store: EngineStore,
  schedule: RunScheduler,
  approvalId: string,
  decision: { status: "approved" | "rejected"; note?: string | null },
  now: Date = new Date()
): Promise<WorkflowApprovalRecord> {
  const approval = await store.getApprovalById(approvalId);
  if (!approval || !allowed(context, permissions, "approvalDecide", approvalItem(approval))) {
    throw new JobAccessError(approval ? "Missing permission automation.approval.decide for this approval." : "Approval not found.");
  }
  if (approval.status !== "pending") throw new JobStateError(`This approval is already ${approval.status}.`);

  const decided = await store.decideApproval(approvalId, { status: decision.status, userId: context.userId, note: decision.note?.trim() || null }, now);
  if (!decided) throw new JobStateError("This approval was decided by someone else first.");

  await audit.record({
    action: decision.status === "approved" ? auditActions.workflowApprovalApprove : auditActions.workflowApprovalReject,
    actor: { type: "human", userId: context.userId },
    entity: { type: "workflow_approval", id: approval.id },
    scope: { organisationId: approval.organisationId ?? undefined, territoryId: approval.territoryId ?? undefined },
    before: { status: approval.status },
    after: { status: decided.status },
    metadata: { runId: approval.runId, title: approval.title, note: decided.decisionNote }
  });

  // Wake the paused run. Keyed per approval, so double-submits collapse to one resume.
  const run = await store.getRun(approval.runId);
  if (run) {
    await schedule({ run, idempotencyKey: `${runIdempotencyKey(run.id)}:approval:${approval.id}`, now });
  }
  return decided;
}

export type RunView = { run: WorkflowRunRecord; steps: RunStepRecord[] };

export async function listRunsForActor(
  context: JobActorContext,
  permissions: PermissionData,
  store: EngineStore,
  filter: { limit?: number } = {}
): Promise<WorkflowRunRecord[]> {
  const scope = visibility(context, permissions, "workflowView");
  const runs = await store.listRuns({ limit: filter.limit ?? 50, ...(scope.kind === "territory" ? { territoryId: scope.territoryId } : {}) });
  return runs.filter((run) => scope.kind === "all" || allowed(context, permissions, "workflowView", { territoryId: run.territoryId, organisationId: run.organisationId, audience: "territory" }));
}

export async function getRunForActor(context: JobActorContext, permissions: PermissionData, store: EngineStore, runId: string): Promise<RunView> {
  const scope = visibility(context, permissions, "workflowView");
  const run = await store.getRun(runId);
  const visible = run && (scope.kind === "all" || allowed(context, permissions, "workflowView", { territoryId: run.territoryId, organisationId: run.organisationId, audience: "territory" }));
  if (!run || !visible) throw new JobAccessError("Workflow run not found.");
  return { run, steps: await store.getSteps(runId) };
}

export async function listNotificationsForActor(
  context: JobActorContext,
  permissions: PermissionData,
  store: EngineStore,
  filter: { unreadOnly?: boolean; limit?: number } = {}
): Promise<NotificationRecord[]> {
  const scope = visibility(context, permissions, "taskView");
  const notes = await store.listNotifications({ ...filter, ...(scope.kind === "territory" ? { territoryId: scope.territoryId, recipientScope: "territory" as const } : {}) });
  return notes.filter((note) => scope.kind === "all" || (note.recipientScope === "territory" && note.territoryId === scope.territoryId));
}
