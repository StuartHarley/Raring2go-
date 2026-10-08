import { auditActions } from "@raring2go/audit";
import type { RecordAuditEventInput } from "@raring2go/audit";
import { boundForStorage } from "./bounds";
import { estimateCostMinor } from "./pricing";
import type { AiProvider } from "./provider";
import { ExternalWorkflowError } from "./workflow";
import type { ExternalWorkflow } from "./workflow";
import type { AiRunRecord, AiRunStore } from "./runs";
import { AiOutputError, requiresReview } from "./task";
import type { AiSourceRef, AiTask } from "./task";

export type AiRunActor =
  | { type: "human"; userId: string }
  | { type: "automation"; automationId: string };

export type AiRunScope = { organisationId?: string | null; territoryId?: string | null };

export type AiAuditRecorder = { record: (input: RecordAuditEventInput) => Promise<unknown> };

export type AiRunnerDeps = {
  provider: AiProvider;
  /** Existing workflows exposed as services, keyed by task key. Preferred over the built-in prompt. */
  workflows?: Record<string, ExternalWorkflow>;
  store: AiRunStore;
  audit?: AiAuditRecorder;
  /**
   * Runs before the provider is called: permission, rate limit and spend cap live here
   * (they need the caller's permission data and database). Throwing blocks the call and
   * records nothing, because nothing was asked of the model.
   */
  guard?: () => Promise<void>;
  now?: () => Date;
};

export type AiRunRequest<Input> = {
  input: Input;
  actor: AiRunActor;
  scope: AiRunScope;
  /** The record this output is for (e.g. the email draft being written). */
  subject?: { type: string; id: string };
  extraSources?: AiSourceRef[];
};

/** A model call that failed. The failed run is already recorded; `runId` links to it. */
export class AiRunFailedError extends Error {
  readonly runId: string;

  constructor(message: string, runId: string) {
    super(message);
    this.name = "AiRunFailedError";
    this.runId = runId;
  }
}

const SAFE_FAILURE = "The AI service could not produce a usable result. Try again.";

/**
 * The one way to run AI work. Every call that reaches a model leaves an `ai_runs` row:
 * actor, purpose, source references, bounded input, output, model, usage and approval
 * state; failures are recorded too, so nothing is silently lost.
 */
export async function runAiTask<Input, Output extends Record<string, unknown>>(
  deps: AiRunnerDeps,
  task: AiTask<Input, Output>,
  request: AiRunRequest<Input>
): Promise<{ run: AiRunRecord; output: Output }> {
  const now = deps.now ?? (() => new Date());
  await deps.guard?.();

  const startedAt = now();
  const base = {
    taskKey: task.key,
    purpose: task.purpose,
    promptVersion: task.promptVersion,
    risk: task.risk,
    actorType: request.actor.type,
    actorUserId: request.actor.type === "human" ? request.actor.userId : null,
    organisationId: request.scope.organisationId ?? null,
    territoryId: request.scope.territoryId ?? null,
    subjectType: request.subject?.type ?? null,
    subjectId: request.subject?.id ?? null,
    sourceRefs: [...(task.sources?.(request.input) ?? []), ...(request.extraSources ?? [])].slice(0, 50),
    input: boundForStorage(task.summariseInput(request.input))
  };

  let output: Output;
  let usage = { inputTokens: 0, outputTokens: 0 };
  const workflow = deps.workflows?.[task.key];
  const providerKey = workflow ? "external_workflow" : deps.provider.key;
  let modelReference = workflow ? `external:${task.key}` : deps.provider.deterministic ? `deterministic-${task.key}` : "unknown";

  try {
    if (workflow) {
      if (!task.fromStructured || !task.structuredInput) {
        throw new Error(`Task ${task.key} cannot be routed to an external workflow.`);
      }
      const result = await workflow.run(task.structuredInput(request.input));
      usage = result.usage;
      modelReference = result.modelReference;
      output = task.fromStructured(result.output, request.input);
    } else if (deps.provider.deterministic) {
      output = task.deterministic(request.input);
    } else {
      const completion = await deps.provider.complete({
        system: task.system,
        user: task.buildUserPrompt(request.input),
        maxTokens: task.maxTokens
      });
      usage = completion.usage;
      modelReference = completion.modelReference;
      output = task.parse(completion.text, request.input);
    }
  } catch (error) {
    const failed = await deps.store.insert(
      {
        ...base,
        providerKey,
        modelReference,
        status: "failed",
        approvalState: "not_required",
        output: {},
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimatedCostMinor: estimateCostMinor(modelReference, usage),
        latencyMs: now().getTime() - startedAt.getTime(),
        error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error"
      },
      now()
    );
    // Output problems and external-workflow status are safe to describe; provider/network detail is not.
    throw new AiRunFailedError(error instanceof AiOutputError || error instanceof ExternalWorkflowError ? error.message : SAFE_FAILURE, failed.id);
  }

  const run = await deps.store.insert(
    {
      ...base,
      providerKey,
      modelReference,
      status: "succeeded",
      approvalState: requiresReview(task) ? "pending" : "not_required",
      output,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostMinor: estimateCostMinor(modelReference, usage),
      latencyMs: now().getTime() - startedAt.getTime(),
      error: null
    },
    now()
  );

  await deps.audit?.record({
    action: auditActions.aiGenerate,
    actor: { type: "ai", runId: run.id, model: modelReference, provider: providerKey, mode: "suggested" },
    entity: { type: "ai_run", id: run.id },
    scope: { organisationId: base.organisationId ?? undefined, territoryId: base.territoryId ?? undefined },
    metadata: {
      taskKey: task.key,
      purpose: task.purpose,
      risk: task.risk,
      approvalState: run.approvalState,
      requestedBy: request.actor.type === "human" ? request.actor.userId : request.actor.automationId,
      subjectType: base.subjectType,
      subjectId: base.subjectId
    }
  });

  return { run, output };
}
