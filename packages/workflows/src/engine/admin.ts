import { auditActions } from "@raring2go/audit";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import { randomUUID } from "node:crypto";
import { JobAccessError, JobStateError } from "../service";
import type { JobActorContext, JobAuditRecorder } from "../service";
import { executeRun } from "./executor";
import type { EngineHooks } from "./executor";
import { automationCapabilities } from "./permissions";
import type { AutomationCapability } from "./permissions";
import type { EngineStore } from "./store";
import { validateWorkflowVersion } from "./validate";
import type { KnownHooks } from "./validate";
import type { RunStepRecord, WorkflowDefinitionRecord, WorkflowRunRecord, WorkflowVersionRecord } from "./types";

/** Workflow definitions are network-level configuration: only a network/system grant may change them. */
function requireNetwork(context: JobActorContext, permissions: PermissionData, capability: AutomationCapability) {
  const { module, action } = automationCapabilities[capability];
  if (!evaluatePermission({ userId: context.userId, module, action }, permissions).allowed) {
    throw new JobAccessError(`Missing permission ${module}.${action}.`);
  }
}

export class WorkflowValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "WorkflowValidationError";
    this.errors = errors;
  }
}

const summarise = (version: Pick<WorkflowVersionRecord, "versionNumber" | "triggerEvent" | "steps" | "settings" | "conditions">) => ({
  versionNumber: version.versionNumber,
  triggerEvent: version.triggerEvent,
  stepCount: version.steps.length,
  conditionCount: version.conditions.length,
  settings: version.settings
});

export async function listWorkflowDefinitionsForActor(context: JobActorContext, permissions: PermissionData, store: EngineStore) {
  requireNetwork(context, permissions, "workflowView");
  const definitions = await store.listDefinitions();
  return Promise.all(definitions.map(async (definition) => ({ definition, versions: await store.listVersions(definition.id) })));
}

export async function getWorkflowDefinitionForActor(context: JobActorContext, permissions: PermissionData, store: EngineStore, definitionId: string) {
  requireNetwork(context, permissions, "workflowView");
  const definition = await store.getDefinition(definitionId);
  if (!definition) throw new JobAccessError("Workflow not found.");
  return { definition, versions: await store.listVersions(definitionId) };
}

/** Starts a new draft from the newest version so an edit never touches the live one. */
export async function createDraftVersion(
  context: JobActorContext,
  permissions: PermissionData,
  audit: JobAuditRecorder,
  store: EngineStore,
  definitionId: string,
  now: Date = new Date()
): Promise<WorkflowVersionRecord> {
  requireNetwork(context, permissions, "workflowManage");
  const definition = await store.getDefinition(definitionId);
  if (!definition) throw new JobAccessError("Workflow not found.");

  const versions = await store.listVersions(definitionId);
  if (versions.some((version) => version.status === "draft")) {
    throw new JobStateError("This workflow already has a draft. Edit or activate it first.");
  }
  const source = versions[0];
  if (!source) throw new JobStateError("This workflow has no version to copy.");

  const draft = await store.createVersion(
    definitionId,
    { triggerEvent: source.triggerEvent, conditions: source.conditions, steps: source.steps, settings: source.settings, changeNote: `Draft from v${source.versionNumber}` },
    context.userId,
    now
  );

  await audit.record({
    action: auditActions.workflowVersionCreate,
    actor: { type: "human", userId: context.userId },
    entity: { type: "workflow_version", id: draft.id },
    after: summarise(draft),
    metadata: { definitionKey: definition.key, copiedFromVersion: source.versionNumber }
  });
  return draft;
}

export async function updateDraftVersion(
  context: JobActorContext,
  permissions: PermissionData,
  audit: JobAuditRecorder,
  store: EngineStore,
  hooks: KnownHooks,
  versionId: string,
  input: unknown,
  changeNote: string | null,
  now: Date = new Date()
): Promise<WorkflowVersionRecord> {
  requireNetwork(context, permissions, "workflowManage");
  const existing = await store.getVersion(versionId);
  if (!existing) throw new JobAccessError("Workflow version not found.");
  if (existing.status !== "draft") throw new JobStateError(`A ${existing.status} version is immutable. Create a new draft to change it.`);

  const validated = validateWorkflowVersion(input, hooks);
  if (!validated.ok) throw new WorkflowValidationError(validated.errors);

  const updated = await store.updateDraftVersion(versionId, { ...validated.value, changeNote: changeNote?.trim().slice(0, 300) || existing.changeNote }, now);
  if (!updated) throw new JobStateError("This version was activated before the change could be saved.");

  await audit.record({
    action: auditActions.workflowVersionUpdate,
    actor: { type: "human", userId: context.userId },
    entity: { type: "workflow_version", id: versionId },
    before: summarise(existing),
    after: summarise(updated),
    metadata: { definitionId: existing.definitionId }
  });
  return updated;
}

export type TestRunResult = { run: WorkflowRunRecord; steps: RunStepRecord[] };

/**
 * Runs a draft against a sample event with no side effects. The run is stored (marked
 * as a test) so what would have happened can be reviewed alongside real runs.
 */
export async function testDraftVersion(
  context: JobActorContext,
  permissions: PermissionData,
  audit: JobAuditRecorder,
  store: EngineStore,
  hooks: EngineHooks,
  versionId: string,
  sample: { payload: Record<string, unknown>; territoryId?: string | null; subjectId?: string | null },
  now: Date = new Date()
): Promise<TestRunResult> {
  requireNetwork(context, permissions, "workflowTest");
  const version = await store.getVersion(versionId);
  if (!version) throw new JobAccessError("Workflow version not found.");

  const validated = validateWorkflowVersion(version, { actions: new Set(Object.keys(hooks.actions)), guards: new Set(Object.keys(hooks.guards)) });
  if (!validated.ok) throw new WorkflowValidationError(validated.errors);

  const { event } = await store.insertEvent(
    {
      eventKey: `test:${randomUUID()}`,
      type: version.triggerEvent,
      source: "manual",
      territoryId: sample.territoryId ?? null,
      subjectId: sample.subjectId ?? null,
      actorUserId: context.userId,
      payload: sample.payload,
      occurredAt: now
    },
    now
  );
  // Mark the synthetic event as handled so the dispatcher never turns it into a live run.
  await store.markEventDispatched(event.id, now);

  const { run } = await store.createRun(
    {
      definitionId: version.definitionId,
      versionId: version.id,
      eventId: event.id,
      organisationId: null,
      territoryId: sample.territoryId ?? null,
      subjectType: null,
      subjectId: sample.subjectId ?? null,
      isTest: true,
      context: {
        event: { type: event.type, subjectType: null, subjectId: sample.subjectId ?? null, actorUserId: context.userId, occurredAt: now.toISOString(), payload: sample.payload }
      }
    },
    now
  );

  await executeRun({ store, hooks, now: () => now }, run.id, { isFinalAttempt: true }).catch(() => undefined);

  await audit.record({
    action: auditActions.workflowRunTest,
    actor: { type: "human", userId: context.userId },
    entity: { type: "workflow_run", id: run.id },
    metadata: { versionId, definitionId: version.definitionId, isTest: true }
  });

  return { run: (await store.getRun(run.id))!, steps: await store.getSteps(run.id) };
}

export async function activateDraftVersion(
  context: JobActorContext,
  permissions: PermissionData,
  audit: JobAuditRecorder,
  store: EngineStore,
  hooks: KnownHooks,
  versionId: string,
  now: Date = new Date()
): Promise<WorkflowVersionRecord> {
  requireNetwork(context, permissions, "workflowActivate");
  const version = await store.getVersion(versionId);
  if (!version) throw new JobAccessError("Workflow version not found.");
  if (version.status !== "draft") throw new JobStateError(`Only a draft can be activated; this version is ${version.status}.`);

  // Re-validate at the moment of activation: hooks may have changed since the draft was saved.
  const validated = validateWorkflowVersion(version, hooks);
  if (!validated.ok) throw new WorkflowValidationError(validated.errors);

  const previous = (await store.listVersions(version.definitionId)).find((candidate) => candidate.status === "active");
  const activated = await store.activateVersion(versionId, context.userId, now);
  if (!activated) throw new JobStateError("This version could not be activated. Refresh and try again.");

  await audit.record({
    action: auditActions.workflowVersionActivate,
    actor: { type: "human", userId: context.userId },
    entity: { type: "workflow_version", id: versionId },
    before: previous ? { activeVersion: previous.versionNumber } : { activeVersion: null },
    after: { activeVersion: activated.versionNumber, ...summarise(activated) },
    metadata: { definitionId: version.definitionId }
  });
  return activated;
}

export async function setWorkflowEnabled(
  context: JobActorContext,
  permissions: PermissionData,
  audit: JobAuditRecorder,
  store: EngineStore,
  definitionId: string,
  enabled: boolean,
  now: Date = new Date()
): Promise<WorkflowDefinitionRecord> {
  requireNetwork(context, permissions, "workflowActivate");
  const before = await store.getDefinition(definitionId);
  if (!before) throw new JobAccessError("Workflow not found.");

  const updated = await store.setDefinitionStatus(definitionId, enabled ? "enabled" : "disabled", now);
  if (!updated) throw new JobAccessError("Workflow not found.");

  await audit.record({
    action: auditActions.workflowDefinitionToggle,
    actor: { type: "human", userId: context.userId },
    entity: { type: "workflow_definition", id: definitionId },
    before: { status: before.status },
    after: { status: updated.status },
    metadata: { key: before.key }
  });
  return updated;
}
