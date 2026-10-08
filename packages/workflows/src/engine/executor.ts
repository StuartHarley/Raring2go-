import { PermanentJobError } from "../errors";
import { sanitiseErrorMessage } from "../policy";
import { renderTemplate, resolveNumber } from "./evaluate";
import type { EngineStore } from "./store";
import type { EvaluationContext, WorkflowRunRecord, WorkflowStep, WorkflowVersionRecord } from "./types";

export type HookContext = {
  run: WorkflowRunRecord;
  evaluation: EvaluationContext;
  stepIndex: number;
  /** Stable per run+step. Use it as the idempotency key for any side effect. */
  idempotencyKey: string;
  now: Date;
};

export type EngineHooks = {
  /** Side-effecting domain actions. MUST be idempotent on `idempotencyKey`. */
  actions: Record<string, (context: HookContext, params: Record<string, unknown>) => Promise<Record<string, unknown> | void>>;
  /** Read-only checks. Returning false ends the run early (e.g. the invoice was paid meanwhile). */
  guards: Record<string, (context: HookContext, params: Record<string, unknown>) => Promise<boolean>>;
};

export type ExecuteDeps = { store: EngineStore; hooks: EngineHooks; now?: () => Date };

export type ExecuteOutcome =
  | { status: "noop"; reason: string }
  | { status: "completed"; outcome: string }
  | { status: "cancelled"; outcome: string }
  | { status: "waiting"; waitingOn: "timer" | "approval"; resumeAt: Date | null; stepIndex: number };

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export function evaluationContextFor(run: WorkflowRunRecord, version: Pick<WorkflowVersionRecord, "settings">): EvaluationContext {
  const event = (run.context.event ?? {}) as EvaluationContext["event"];
  return {
    event: {
      type: event.type ?? "",
      subjectType: event.subjectType ?? null,
      subjectId: event.subjectId ?? null,
      actorUserId: event.actorUserId ?? null,
      occurredAt: event.occurredAt ?? "",
      payload: event.payload ?? {}
    },
    scope: { organisationId: run.organisationId, territoryId: run.territoryId },
    settings: version.settings
  };
}

/**
 * Executes (or resumes) a run. Re-entrant by design: completed steps are skipped, each
 * side effect is keyed by run+step, and waits/approvals persist their own state, so
 * a retried or duplicated job produces the same end state as a single clean run.
 *
 * Throws on a step failure after recording it; the job runner owns retry/backoff.
 */
export async function executeRun(deps: ExecuteDeps, runId: string, options: { isFinalAttempt?: boolean } = {}): Promise<ExecuteOutcome> {
  const { store, hooks } = deps;
  const now = deps.now ?? (() => new Date());

  const initial = await store.getRun(runId);
  if (!initial) throw new Error(`Workflow run ${runId} not found.`);
  if (initial.status === "completed" || initial.status === "failed" || initial.status === "cancelled") {
    return { status: "noop", reason: `run already ${initial.status}` };
  }

  const version = await store.getVersion(initial.versionId);
  if (!version) throw new Error(`Workflow version ${initial.versionId} not found.`);

  let run = await store.updateRun(runId, { status: "running", waitingOn: null, startedAt: initial.startedAt ?? now() }, now());
  const evaluation = evaluationContextFor(run, version);
  const existingSteps = new Map((await store.getSteps(runId)).map((step) => [step.stepIndex, step]));

  for (let index = run.currentStep; index < version.steps.length; index += 1) {
    const step = version.steps[index]!;
    const saved = existingSteps.get(index);

    if (saved && (saved.status === "completed" || saved.status === "skipped")) {
      continue;
    }

    const context: HookContext = { run, evaluation, stepIndex: index, idempotencyKey: `wf:${run.id}:${index}`, now: now() };
    const attempts = (saved?.attempts ?? 0) + 1;

    try {
      const result = await runStep(deps, run, version, step, context, saved?.status === "waiting");

      if (result.kind === "wait") {
        await store.saveStep({
          runId,
          stepIndex: index,
          action: step.type,
          status: "waiting",
          attempts,
          result: result.detail,
          error: null,
          startedAt: saved?.startedAt ?? now(),
          completedAt: null
        });
        await store.updateRun(runId, { status: "waiting", waitingOn: result.waitingOn, resumeAt: result.resumeAt, currentStep: index }, now());
        return { status: "waiting", waitingOn: result.waitingOn, resumeAt: result.resumeAt, stepIndex: index };
      }

      await store.saveStep({
        runId,
        stepIndex: index,
        action: step.type,
        status: "completed",
        attempts,
        result: result.detail,
        error: null,
        startedAt: saved?.startedAt ?? now(),
        completedAt: now()
      });
      run = await store.updateRun(runId, { currentStep: index + 1, resumeAt: null }, now());

      if (result.kind === "stop") {
        await store.updateRun(runId, { status: result.status, outcome: result.outcome, completedAt: now(), waitingOn: null, resumeAt: null }, now());
        return { status: result.status, outcome: result.outcome };
      }
    } catch (error) {
      const message = sanitiseErrorMessage(error);
      await store.saveStep({
        runId,
        stepIndex: index,
        action: step.type,
        status: "failed",
        attempts,
        result: {},
        error: message,
        startedAt: saved?.startedAt ?? now(),
        completedAt: null
      });
      await store.updateRun(
        runId,
        options.isFinalAttempt || error instanceof PermanentJobError ? { status: "failed", lastError: message, outcome: "failed", completedAt: now() } : { status: "running", lastError: message },
        now()
      );
      throw error;
    }
  }

  await store.updateRun(runId, { status: "completed", outcome: "completed", completedAt: now(), waitingOn: null, resumeAt: null, lastError: null }, now());
  return { status: "completed", outcome: "completed" };
}

type StepResult =
  | { kind: "done"; detail: Record<string, unknown> }
  | { kind: "wait"; waitingOn: "timer" | "approval"; resumeAt: Date | null; detail: Record<string, unknown> }
  | { kind: "stop"; status: "completed" | "cancelled"; outcome: string; detail: Record<string, unknown> };

async function runStep(
  deps: ExecuteDeps,
  run: WorkflowRunRecord,
  version: WorkflowVersionRecord,
  step: WorkflowStep,
  context: HookContext,
  alreadyWaiting: boolean
): Promise<StepResult> {
  const { store, hooks } = deps;
  const { evaluation, idempotencyKey, now } = context;
  const render = (text: string | undefined) => (text === undefined ? undefined : renderTemplate(text, evaluation));
  const dry = run.isTest;

  switch (step.type) {
    case "create_task": {
      const days = resolveNumber(step.dueInDays, version.settings);
      const dueDate = days === undefined ? null : new Date(now.getTime() + days * DAY_MS);
      const input = {
        title: render(step.title) ?? "",
        description: render(step.description) ?? null,
        assigneeScope: step.assignee,
        organisationId: run.organisationId,
        territoryId: run.territoryId,
        dueDate,
        runId: run.id,
        stepIndex: context.stepIndex,
        subjectType: run.subjectType,
        subjectId: run.subjectId,
        link: render(step.link) ?? null,
        idempotencyKey
      };
      if (dry) return { kind: "done", detail: { dryRun: true, wouldCreateTask: { title: input.title, assignee: step.assignee, dueDate: dueDate?.toISOString() ?? null } } };
      const { task, created } = await store.createTask(input, now);
      return { kind: "done", detail: { taskId: task.id, created } };
    }

    case "notify": {
      const input = {
        recipientScope: step.audience,
        organisationId: run.organisationId,
        territoryId: run.territoryId,
        title: render(step.title) ?? "",
        body: render(step.body) ?? null,
        link: render(step.link) ?? null,
        sourceType: "workflow_run",
        sourceId: run.id,
        idempotencyKey
      } as const;
      if (dry) return { kind: "done", detail: { dryRun: true, wouldNotify: { audience: step.audience, title: input.title } } };
      const { notification, created } = await store.createNotification(input, now);
      return { kind: "done", detail: { notificationId: notification.id, created } };
    }

    case "wait": {
      if (dry) return { kind: "done", detail: { dryRun: true, skippedWait: true } };
      const duration = (resolveNumber(step.days, version.settings) ?? 0) * DAY_MS + (resolveNumber(step.hours, version.settings) ?? 0) * HOUR_MS;
      // Resuming: the persisted wake-up time wins so a re-run never extends the wait.
      const wakeAt = alreadyWaiting && run.resumeAt ? run.resumeAt : new Date(now.getTime() + duration);
      if (wakeAt > now) {
        return { kind: "wait", waitingOn: "timer", resumeAt: wakeAt, detail: { wakeAt: wakeAt.toISOString() } };
      }
      return { kind: "done", detail: { waitedUntil: wakeAt.toISOString() } };
    }

    case "request_approval": {
      if (dry) return { kind: "done", detail: { dryRun: true, wouldRequestApproval: { approver: step.approver, title: render(step.title) } } };
      const days = resolveNumber(step.expiresInDays, version.settings);
      const { approval } = await store.createApproval(
        {
          runId: run.id,
          stepIndex: context.stepIndex,
          title: render(step.title) ?? "",
          description: render(step.description) ?? null,
          approverScope: step.approver,
          organisationId: run.organisationId,
          territoryId: run.territoryId,
          expiresAt: days === undefined ? null : new Date(now.getTime() + days * DAY_MS)
        },
        now
      );

      if (approval.status === "pending") {
        return { kind: "wait", waitingOn: "approval", resumeAt: approval.expiresAt, detail: { approvalId: approval.id } };
      }
      if (approval.status === "approved") {
        return { kind: "done", detail: { approvalId: approval.id, decision: "approved" } };
      }
      // Rejected or expired: the gated work must not happen.
      return { kind: "stop", status: "cancelled", outcome: approval.status === "rejected" ? "approval_rejected" : "approval_expired", detail: { approvalId: approval.id, decision: approval.status } };
    }

    case "guard": {
      const guard = hooks.guards[step.check];
      if (!guard) throw new Error(`Unknown guard "${step.check}".`);
      const passed = await guard(context, step.params ?? {});
      return passed
        ? { kind: "done", detail: { guard: step.check, passed: true } }
        : { kind: "stop", status: "completed", outcome: "guard_stopped", detail: { guard: step.check, passed: false } };
    }

    case "run_action": {
      const action = hooks.actions[step.action];
      if (!action) throw new Error(`Unknown action "${step.action}".`);
      if (dry) return { kind: "done", detail: { dryRun: true, wouldRun: step.action } };
      const result = await action(context, step.params ?? {});
      return { kind: "done", detail: { action: step.action, ...(result ?? {}) } };
    }
  }
}
