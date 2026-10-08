import { auditActions } from "@raring2go/audit";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import type { AiAuditRecorder } from "./runner";
import type { AiRunFilter, AiRunRecord, AiRunStore } from "./runs";

export const aiRunCapabilities = {
  view: { module: "ai.run", action: "view" },
  decide: { module: "ai.run", action: "decide" }
} as const;

export type AiActorContext = { userId: string; organisationId?: string | null; territoryId?: string | null };

export class AiRunAccessError extends Error {
  constructor(message = "You do not have access to this AI run.") {
    super(message);
    this.name = "AiRunAccessError";
  }
}

export class AiRunStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRunStateError";
  }
}

function allowed(context: AiActorContext, permissions: PermissionData, capability: keyof typeof aiRunCapabilities, run?: Pick<AiRunRecord, "territoryId" | "organisationId">) {
  const { module, action } = aiRunCapabilities[capability];
  const base = { userId: context.userId, module, action };
  if (!run) return evaluatePermission(base, permissions).allowed;
  return evaluatePermission(
    { ...base, resource: { territoryId: run.territoryId ?? undefined, organisationId: run.territoryId ? undefined : run.organisationId ?? undefined } },
    permissions
  ).allowed;
}

function visibility(context: AiActorContext, permissions: PermissionData, capability: keyof typeof aiRunCapabilities) {
  if (allowed(context, permissions, capability)) return { kind: "all" as const };
  if (context.territoryId && allowed(context, permissions, capability, { territoryId: context.territoryId, organisationId: null })) {
    return { kind: "territory" as const, territoryId: context.territoryId };
  }
  throw new AiRunAccessError(`Missing permission ${aiRunCapabilities[capability].module}.${aiRunCapabilities[capability].action}.`);
}

export async function listAiRunsForActor(context: AiActorContext, permissions: PermissionData, store: AiRunStore, filter: AiRunFilter = {}): Promise<AiRunRecord[]> {
  const scope = visibility(context, permissions, "view");
  if (scope.kind === "territory" && filter.territoryId && filter.territoryId !== scope.territoryId) return [];
  const runs = await store.list(scope.kind === "territory" ? { ...filter, territoryId: scope.territoryId } : filter);
  return runs.filter((run) => scope.kind === "all" || allowed(context, permissions, "view", run));
}

export async function getAiRunForActor(context: AiActorContext, permissions: PermissionData, store: AiRunStore, runId: string): Promise<AiRunRecord> {
  visibility(context, permissions, "view");
  const run = await store.get(runId);
  // Same error for "missing" and "not yours".
  if (!run || !allowed(context, permissions, "view", run)) throw new AiRunAccessError("AI run not found.");
  return run;
}

/**
 * A human accepts or rejects AI output. Rules:
 * - only `pending` runs can be decided, exactly once;
 * - high-risk output needs a different person from the requester (four-eyes);
 * - the decision and who made it are audited.
 */
export async function decideAiRun(
  context: AiActorContext,
  permissions: PermissionData,
  audit: AiAuditRecorder,
  store: AiRunStore,
  runId: string,
  decision: { state: "approved" | "rejected"; note?: string | null },
  now: Date = new Date()
): Promise<AiRunRecord> {
  const run = await store.get(runId);
  if (!run || !allowed(context, permissions, "decide", run)) {
    throw new AiRunAccessError(run ? "Missing permission ai.run.decide for this run." : "AI run not found.");
  }
  if (run.status !== "succeeded") throw new AiRunStateError("A failed run has no output to decide on.");
  if (run.approvalState !== "pending") throw new AiRunStateError(`This run is already ${run.approvalState.replace("_", " ")}.`);
  if (run.risk === "high" && run.actorUserId && run.actorUserId === context.userId) {
    throw new AiRunStateError("High-risk AI output must be decided by someone other than the person who requested it.");
  }

  const decided = await store.decide(runId, { state: decision.state, userId: context.userId, note: decision.note?.trim().slice(0, 500) || null }, now);
  if (!decided) throw new AiRunStateError("This run was decided by someone else first.");

  await audit.record({
    action: decision.state === "approved" ? auditActions.aiApprove : auditActions.aiReject,
    actor: { type: "human", userId: context.userId },
    entity: { type: "ai_run", id: run.id },
    scope: { organisationId: run.organisationId ?? undefined, territoryId: run.territoryId ?? undefined },
    before: { approvalState: run.approvalState },
    after: { approvalState: decided.approvalState },
    metadata: { taskKey: run.taskKey, risk: run.risk, subjectType: run.subjectType, subjectId: run.subjectId, note: decided.decisionNote }
  });
  return decided;
}

/** Called by the feature that applies an approved output to its record, so use is traceable. */
export async function markAiRunApplied(
  context: AiActorContext,
  permissions: PermissionData,
  audit: AiAuditRecorder,
  store: AiRunStore,
  runId: string,
  now: Date = new Date()
): Promise<AiRunRecord> {
  const run = await store.get(runId);
  if (!run || !allowed(context, permissions, "view", run)) throw new AiRunAccessError("AI run not found.");
  if (run.approvalState === "pending") throw new AiRunStateError("This output has not been approved yet.");
  if (run.approvalState === "rejected") throw new AiRunStateError("This output was rejected and cannot be applied.");

  const applied = await store.markApplied(runId, now);
  if (!applied) throw new AiRunStateError("This output has already been applied.");

  await audit.record({
    action: auditActions.aiApply,
    actor: { type: "human", userId: context.userId },
    entity: { type: "ai_run", id: run.id },
    scope: { organisationId: run.organisationId ?? undefined, territoryId: run.territoryId ?? undefined },
    metadata: { taskKey: run.taskKey, subjectType: run.subjectType, subjectId: run.subjectId, approvalState: run.approvalState }
  });
  return applied;
}
