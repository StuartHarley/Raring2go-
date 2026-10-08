import { PermanentJobError } from "../errors";
import { defineJobHandler } from "../registry";
import type { JobHandler, JobStore } from "../types";
import { enqueueJob } from "../service";
import type { JobAuditRecorder } from "../service";
import { dispatchPendingEvents, resumeDueRuns } from "./dispatch";
import type { RunScheduler } from "./dispatch";
import { executeRun } from "./executor";
import type { EngineHooks } from "./executor";
import { ingestAuditEvents } from "./ingest";
import type { EngineStore } from "./store";

export const EXECUTE_RUN_KIND = "workflows.execute_run";
export const WORKFLOW_TICK_KIND = "workflows.tick";

/** Schedules run execution on the durable job queue, keyed so duplicates collapse. */
export function createJobRunScheduler(jobs: JobStore, audit?: JobAuditRecorder): RunScheduler {
  return async ({ run, idempotencyKey, runAfter, now }) => {
    await enqueueJob(
      jobs,
      audit,
      {
        kind: EXECUTE_RUN_KIND,
        idempotencyKey,
        organisationId: run.organisationId,
        territoryId: run.territoryId,
        subjectType: "workflow_run",
        subjectId: run.id,
        payload: { runId: run.id },
        runAfter
      },
      now
    );
  };
}

export const workflowTickIdempotencyKey = (now: Date) => `${WORKFLOW_TICK_KIND}:${now.toISOString().slice(0, 16)}`;

export function createWorkflowJobHandlers(deps: { store: EngineStore; hooks: EngineHooks; jobs: JobStore }): JobHandler[] {
  const { store, hooks, jobs } = deps;
  const schedule = createJobRunScheduler(jobs);

  return [
    defineJobHandler({
      kind: EXECUTE_RUN_KIND,
      maxAttempts: 5,
      baseBackoffMs: 30_000,
      handle: async ({ job, attemptNumber, now }) => {
        const runId = typeof job.payload.runId === "string" ? job.payload.runId : "";
        if (!runId) throw new PermanentJobError("Workflow job has no runId.", "invalid_payload");

        const run = await store.getRun(runId);
        if (!run) throw new PermanentJobError(`Workflow run ${runId} no longer exists.`, "run_not_found");

        const outcome = await executeRun({ store, hooks, now }, runId, { isFinalAttempt: attemptNumber >= job.maxAttempts });
        return { ...outcome, resumeAt: "resumeAt" in outcome && outcome.resumeAt ? outcome.resumeAt.toISOString() : null };
      }
    }),
    defineJobHandler({
      kind: WORKFLOW_TICK_KIND,
      maxAttempts: 3,
      baseBackoffMs: 15_000,
      handle: async ({ now }) => {
        const at = now();
        const ingest = await ingestAuditEvents(store, at);
        const dispatch = await dispatchPendingEvents(store, schedule, at);
        const resumed = await resumeDueRuns(store, schedule, at);
        return { ...ingest, ...dispatch, ...resumed };
      }
    })
  ];
}
