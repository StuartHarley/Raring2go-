import { evaluateConditions } from "./evaluate";
import { evaluationContextFor } from "./executor";
import type { EngineStore } from "./store";
import type { EvaluationContext, WorkflowEventRecord, WorkflowRunRecord, WorkflowVersionRecord } from "./types";

/** Called for every run that should be (re)executed. Must be idempotent on `idempotencyKey`. */
export type RunScheduler = (input: { run: WorkflowRunRecord; idempotencyKey: string; now: Date; runAfter?: Date }) => Promise<void>;

export type DispatchResult = { events: number; matched: number; runsCreated: number };

export function evaluationContextForEvent(event: WorkflowEventRecord, version: Pick<WorkflowVersionRecord, "settings">): EvaluationContext {
  return {
    event: {
      type: event.type,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      actorUserId: event.actorUserId,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload
    },
    scope: { organisationId: event.organisationId, territoryId: event.territoryId },
    settings: version.settings
  };
}

export const runIdempotencyKey = (runId: string) => `workflow-run:${runId}`;

/**
 * Turns undispatched events into runs. One run per (definition, event), enforced by
 * the store, so replaying or double-dispatching an event cannot execute it twice.
 * Safe to crash anywhere: an event stays pending until its runs are scheduled.
 */
export async function dispatchPendingEvents(
  store: EngineStore,
  schedule: RunScheduler,
  now: Date,
  options: { limit?: number } = {}
): Promise<DispatchResult> {
  const events = await store.pendingEvents(options.limit ?? 100);
  const active = await store.listActiveWorkflows();
  const result: DispatchResult = { events: events.length, matched: 0, runsCreated: 0 };

  for (const event of events) {
    for (const { definition, version } of active) {
      if (version.triggerEvent !== event.type) continue;
      if (!evaluateConditions(version.conditions, evaluationContextForEvent(event, version))) continue;

      result.matched += 1;
      const { run, created } = await store.createRun(
        {
          definitionId: definition.id,
          versionId: version.id,
          eventId: event.id,
          organisationId: event.organisationId,
          territoryId: event.territoryId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          context: {
            event: {
              type: event.type,
              subjectType: event.subjectType,
              subjectId: event.subjectId,
              actorUserId: event.actorUserId,
              occurredAt: event.occurredAt.toISOString(),
              payload: event.payload
            }
          }
        },
        now
      );
      if (created) result.runsCreated += 1;
      await schedule({ run, idempotencyKey: runIdempotencyKey(run.id), now });
    }

    await store.markEventDispatched(event.id, now);
  }

  return result;
}

/** Wakes runs whose timer elapsed, and runs gated by approvals that expired without a decision. */
export async function resumeDueRuns(store: EngineStore, schedule: RunScheduler, now: Date): Promise<{ timers: number; expiredApprovals: number }> {
  const due = await store.dueTimerRuns(now, 100);
  for (const run of due) {
    await schedule({ run, idempotencyKey: `${runIdempotencyKey(run.id)}:resume:${run.currentStep}:${run.resumeAt!.getTime()}`, now });
  }

  const expired = await store.expireApprovals(now);
  for (const approval of expired) {
    const run = await store.getRun(approval.runId);
    if (run) {
      await schedule({ run, idempotencyKey: `${runIdempotencyKey(run.id)}:approval:${approval.id}`, now });
    }
  }

  return { timers: due.length, expiredApprovals: expired.length };
}

export { evaluationContextFor };
