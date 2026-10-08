import { describe, expect, it, vi } from "vitest";
import { createInMemoryJobStore } from "../memory-store";
import { createJobRegistry } from "../registry";
import { runDueJobs } from "../runner";
import { enqueueJob } from "../service";
import { dispatchPendingEvents, resumeDueRuns } from "./dispatch";
import { executeRun } from "./executor";
import type { EngineHooks } from "./executor";
import { ingestAuditEvents } from "./ingest";
import { createJobRunScheduler, createWorkflowJobHandlers, WORKFLOW_TICK_KIND, workflowTickIdempotencyKey } from "./jobs";
import { createInMemoryEngineStore } from "./memory-store";
import type { AuditEventRow } from "./store";
import type { WorkflowStep } from "./types";

const T0 = new Date("2026-03-01T09:00:00Z");
const DAY = 86_400_000;

function auditRow(overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    id: crypto.randomUUID(),
    action: "franchise.agreement.executed",
    actorUserId: null,
    entityType: "franchise_agreement",
    entityId: crypto.randomUUID(),
    organisationId: "org-1",
    territoryId: "t-sutton",
    payload: { after: { franchiseName: "Sutton Coldfield" }, metadata: {}, actor: { type: "system" } },
    createdAt: new Date(T0.getTime() + 1_000),
    ...overrides
  };
}

async function setup(options: { steps: WorkflowStep[]; conditions?: never[] | object[]; settings?: Record<string, number>; trigger?: string; hooks?: Partial<EngineHooks>; audit?: AuditEventRow[] }) {
  const store = createInMemoryEngineStore({ auditEvents: options.audit ?? [] });
  const jobs = createInMemoryJobStore();
  const hooks: EngineHooks = { actions: {}, guards: {}, ...options.hooks };
  const definition = await store.upsertDefinition({ key: "demo.flow", name: "Demo" }, T0);
  const draft = await store.createVersion(
    definition.id,
    { triggerEvent: options.trigger ?? "franchise.agreement.executed", conditions: (options.conditions ?? []) as never, steps: options.steps, settings: options.settings ?? {} },
    null,
    T0
  );
  await store.activateVersion(draft.id, null, T0);
  const registry = createJobRegistry(createWorkflowJobHandlers({ store, hooks, jobs }));
  const clock = { now: T0 };

  async function tick(at: Date) {
    clock.now = at;
    await enqueueJob(jobs, undefined, { kind: WORKFLOW_TICK_KIND, idempotencyKey: workflowTickIdempotencyKey(at) }, at);
  }

  async function drain(at: Date, maxJobs = 50) {
    clock.now = at;
    return runDueJobs(jobs, registry, { workerId: "w", now: () => at, maxJobs, random: () => 1 });
  }

  return { store, jobs, registry, hooks, definition, version: draft, tick, drain };
}

const notifyStep: WorkflowStep = { type: "notify", audience: "hq", title: "Agreement signed: {{event.payload.franchiseName}}" };
const taskStep: WorkflowStep = { type: "create_task", title: "File {{event.payload.franchiseName}} agreement", assignee: "hq", dueInDays: 2 };

describe("end to end: audit -> event -> run -> steps", () => {
  it("creates exactly one task and notification, however often the pipeline replays", async () => {
    const row = auditRow();
    const s = await setup({ steps: [notifyStep, taskStep], audit: [] });
    // Engine is "switched on": cursor is created, history is not replayed.
    await ingestAuditEvents(s.store, T0);
    s.store.auditEvents.push(row);

    for (let minute = 1; minute <= 4; minute += 1) {
      const at = new Date(T0.getTime() + minute * 60_000);
      await s.tick(at);
      await s.drain(at);
    }
    // Force a full re-scan of the same audit rows from scratch.
    await s.store.setCursor("audit", { lastCreatedAt: new Date(T0.getTime() - 3_600_000), lastId: null }, T0);
    const later = new Date(T0.getTime() + 10 * 60_000);
    await s.tick(later);
    await s.drain(later);

    expect([...s.store.events.values()]).toHaveLength(1);
    expect([...s.store.runs.values()]).toHaveLength(1);
    expect([...s.store.tasks.values()]).toHaveLength(1);
    expect([...s.store.notifications.values()]).toHaveLength(1);

    const run = [...s.store.runs.values()][0]!;
    expect(run).toMatchObject({ status: "completed", outcome: "completed", territoryId: "t-sutton" });
    const [task] = [...s.store.tasks.values()];
    expect(task).toMatchObject({ title: "File Sutton Coldfield agreement", assigneeScope: "hq", territoryId: "t-sutton", status: "open" });
    expect(task!.dueDate!.getTime()).toBeGreaterThan(T0.getTime());
    expect([...s.store.notifications.values()][0]!.title).toBe("Agreement signed: Sutton Coldfield");
  });

  it("does not replay audit history when first switched on", async () => {
    const s = await setup({ steps: [notifyStep], audit: [auditRow({ createdAt: new Date(T0.getTime() - 60_000) })] });
    const result = await ingestAuditEvents(s.store, T0);
    expect(result).toEqual({ scanned: 0, ingested: 0 });
    await s.tick(new Date(T0.getTime() + 60_000));
    await s.drain(new Date(T0.getTime() + 60_000));
    expect(s.store.runs.size).toBe(0);
  });

  it("the overlap window never reaches back before the moment ingestion was switched on", async () => {
    const s = await setup({ steps: [notifyStep], audit: [auditRow({ createdAt: new Date(T0.getTime() - 5 * 60_000) })] });
    await ingestAuditEvents(s.store, T0);
    // Several ticks later the 10-minute overlap would include the old row if unbounded.
    for (let minute = 1; minute <= 3; minute += 1) {
      await ingestAuditEvents(s.store, new Date(T0.getTime() + minute * 60_000));
    }
    expect(s.store.events.size).toBe(0);
  });

  it("only ingests audit actions some active workflow listens for", async () => {
    const s = await setup({ steps: [notifyStep] });
    await ingestAuditEvents(s.store, T0);
    s.store.auditEvents.push(auditRow({ action: "record.update" }), auditRow({ action: "franchise.agreement.executed" }));
    const result = await ingestAuditEvents(s.store, new Date(T0.getTime() + 60_000));
    expect(result).toEqual({ scanned: 1, ingested: 1 });
  });

  it("picks up an audit row that committed late, inside the overlap window", async () => {
    const s = await setup({ steps: [notifyStep] });
    await ingestAuditEvents(s.store, T0);
    const early = auditRow({ createdAt: new Date(T0.getTime() + 10_000) });
    s.store.auditEvents.push(auditRow({ createdAt: new Date(T0.getTime() + 20_000) }));
    await ingestAuditEvents(s.store, new Date(T0.getTime() + 60_000));
    // A slower transaction that started earlier only becomes visible now.
    s.store.auditEvents.push(early);
    const result = await ingestAuditEvents(s.store, new Date(T0.getTime() + 120_000));
    expect(result.ingested).toBe(1);
  });
});

describe("matching", () => {
  it("only runs when conditions hold", async () => {
    const s = await setup({
      steps: [notifyStep],
      conditions: [{ field: "event.payload.franchiseName", op: "eq", value: "Solihull" }]
    });
    await ingestAuditEvents(s.store, T0);
    s.store.auditEvents.push(auditRow());
    const at = new Date(T0.getTime() + 60_000);
    await s.tick(at);
    await s.drain(at);
    expect(s.store.events.size).toBe(1);
    expect(s.store.runs.size).toBe(0);
  });

  it("a disabled definition never matches, and a retired version is replaced by the new active one", async () => {
    const s = await setup({ steps: [notifyStep] });
    await s.store.setDefinitionStatus(s.definition.id, "disabled", T0);
    expect(await s.store.listActiveWorkflows()).toHaveLength(0);
    await s.store.setDefinitionStatus(s.definition.id, "enabled", T0);

    const v2 = await s.store.createVersion(s.definition.id, { triggerEvent: "franchise.agreement.executed", conditions: [], steps: [taskStep], settings: {} }, null, T0);
    await s.store.activateVersion(v2.id, "user-1", T0);
    const active = await s.store.listActiveWorkflows();
    expect(active).toHaveLength(1);
    expect(active[0]!.version.versionNumber).toBe(2);
    expect((await s.store.getVersion(s.version.id))!.status).toBe("retired");
  });

  it("active versions are immutable: only drafts can be edited", async () => {
    const s = await setup({ steps: [notifyStep] });
    expect(await s.store.updateDraftVersion(s.version.id, { triggerEvent: "a.b", conditions: [], steps: [taskStep], settings: {} }, T0)).toBeUndefined();
    const draft = await s.store.createVersion(s.definition.id, { triggerEvent: "a.b", conditions: [], steps: [notifyStep], settings: {} }, null, T0);
    expect(await s.store.updateDraftVersion(draft.id, { triggerEvent: "a.c", conditions: [], steps: [taskStep], settings: {} }, T0)).toMatchObject({ triggerEvent: "a.c" });
  });
});

describe("waiting", () => {
  const steps: WorkflowStep[] = [notifyStep, { type: "wait", days: { setting: "waitDays" } }, taskStep];

  it("pauses on a timer, resumes when due, and never fires early", async () => {
    const s = await setup({ steps, settings: { waitDays: 3 } });
    await ingestAuditEvents(s.store, T0);
    s.store.auditEvents.push(auditRow());
    const t1 = new Date(T0.getTime() + 60_000);
    await s.tick(t1);
    await s.drain(t1);

    let run = [...s.store.runs.values()][0]!;
    expect(run).toMatchObject({ status: "waiting", waitingOn: "timer", currentStep: 1 });
    expect(run.resumeAt!.getTime()).toBe(t1.getTime() + 3 * DAY);
    expect(s.store.notifications.size).toBe(1);
    expect(s.store.tasks.size).toBe(0);

    // Two days later: nothing due, even with many ticks.
    for (const hours of [12, 24, 47]) {
      const at = new Date(t1.getTime() + hours * 3_600_000);
      await s.tick(at);
      await s.drain(at);
    }
    expect(s.store.tasks.size).toBe(0);

    const due = new Date(t1.getTime() + 3 * DAY + 1_000);
    await s.tick(due);
    await s.drain(due);
    await s.tick(new Date(due.getTime() + 60_000));
    await s.drain(new Date(due.getTime() + 60_000));

    run = (await s.store.getRun(run.id))!;
    expect(run.status).toBe("completed");
    expect(s.store.tasks.size).toBe(1);
    expect(s.store.notifications.size).toBe(1);
  });
});

describe("approvals", () => {
  const steps: WorkflowStep[] = [{ type: "request_approval", approver: "hq", title: "Approve send", expiresInDays: 2 }, taskStep];

  async function paused() {
    const s = await setup({ steps });
    await ingestAuditEvents(s.store, T0);
    s.store.auditEvents.push(auditRow());
    const at = new Date(T0.getTime() + 60_000);
    await s.tick(at);
    await s.drain(at);
    const run = [...s.store.runs.values()][0]!;
    const approval = [...s.store.approvals.values()][0]!;
    return { ...s, run, approval, at };
  }

  async function resume(s: Awaited<ReturnType<typeof paused>>, at: Date) {
    const schedule = createJobRunScheduler(s.jobs);
    await schedule({ run: s.run, idempotencyKey: `workflow-run:${s.run.id}:approval:${s.approval.id}`, now: at });
    await s.drain(at);
  }

  it("waits for a decision and does not run later steps", async () => {
    const s = await paused();
    expect(s.run.status).toBe("waiting");
    expect((await s.store.getRun(s.run.id))!.waitingOn).toBe("approval");
    expect(s.approval).toMatchObject({ status: "pending", approverScope: "hq", territoryId: "t-sutton" });
    expect(s.store.tasks.size).toBe(0);
  });

  it("continues after approval", async () => {
    const s = await paused();
    await s.store.decideApproval(s.approval.id, { status: "approved", userId: "u1" }, s.at);
    await resume(s, new Date(s.at.getTime() + 1_000));
    expect((await s.store.getRun(s.run.id))!.status).toBe("completed");
    expect(s.store.tasks.size).toBe(1);
  });

  it("cancels the run after rejection and never performs the gated steps", async () => {
    const s = await paused();
    await s.store.decideApproval(s.approval.id, { status: "rejected", userId: "u1", note: "no" }, s.at);
    await resume(s, new Date(s.at.getTime() + 1_000));
    expect(await s.store.getRun(s.run.id)).toMatchObject({ status: "cancelled", outcome: "approval_rejected" });
    expect(s.store.tasks.size).toBe(0);
  });

  it("a decision can only be made once", async () => {
    const s = await paused();
    expect(await s.store.decideApproval(s.approval.id, { status: "approved", userId: "u1" }, s.at)).toBeDefined();
    expect(await s.store.decideApproval(s.approval.id, { status: "rejected", userId: "u2" }, s.at)).toBeUndefined();
    expect((await s.store.getApprovalById(s.approval.id))!.status).toBe("approved");
  });

  it("expires after the deadline, cancels, and wakes the run", async () => {
    const s = await paused();
    const late = new Date(s.at.getTime() + 3 * DAY);
    const schedule = createJobRunScheduler(s.jobs);
    const resumed = await resumeDueRuns(s.store, schedule, late);
    expect(resumed.expiredApprovals).toBe(1);
    await s.drain(late);
    expect(await s.store.getRun(s.run.id)).toMatchObject({ status: "cancelled", outcome: "approval_expired" });
    expect(s.store.tasks.size).toBe(0);
  });
});

describe("guards and actions", () => {
  it("a failing guard ends the run early without running later steps", async () => {
    const guard = vi.fn(async () => false);
    const s = await setup({ steps: [{ type: "guard", check: "still_unpaid" }, taskStep], hooks: { guards: { still_unpaid: guard } } });
    await ingestAuditEvents(s.store, T0);
    s.store.auditEvents.push(auditRow());
    const at = new Date(T0.getTime() + 60_000);
    await s.tick(at);
    await s.drain(at);
    expect(guard).toHaveBeenCalledTimes(1);
    expect([...s.store.runs.values()][0]).toMatchObject({ status: "completed", outcome: "guard_stopped" });
    expect(s.store.tasks.size).toBe(0);
  });

  it("passes a stable idempotency key to actions, and a retried step reuses it", async () => {
    const keys: string[] = [];
    let failOnce = true;
    const start = vi.fn(async ({ idempotencyKey }: { idempotencyKey: string }) => {
      keys.push(idempotencyKey);
      if (failOnce) {
        failOnce = false;
        throw new Error("transient provider error");
      }
      return { started: true };
    });
    const s = await setup({
      steps: [notifyStep, { type: "run_action", action: "franchise.start_onboarding" }, taskStep],
      hooks: { actions: { "franchise.start_onboarding": start } }
    });
    await ingestAuditEvents(s.store, T0);
    s.store.auditEvents.push(auditRow());
    const t1 = new Date(T0.getTime() + 60_000);
    await s.tick(t1);
    await s.drain(t1);

    let run = [...s.store.runs.values()][0]!;
    expect(run.status).toBe("running"); // step 2 failed, job will retry
    expect(run.lastError).toMatch(/transient/);
    expect(s.store.notifications.size).toBe(1); // step 1 already done, will not repeat

    const t2 = new Date(t1.getTime() + 5 * 60_000);
    await s.drain(t2);
    run = (await s.store.getRun(run.id))!;
    expect(run.status).toBe("completed");
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1); // same key both times: the action can dedupe
    expect(s.store.notifications.size).toBe(1);
    expect(s.store.tasks.size).toBe(1);
  });

  it("marks the run failed when the final attempt fails", async () => {
    const s = await setup({
      steps: [{ type: "run_action", action: "boom" }],
      hooks: { actions: { boom: async () => { throw new Error("always fails"); } } }
    });
    await ingestAuditEvents(s.store, T0);
    s.store.auditEvents.push(auditRow());
    let at = new Date(T0.getTime() + 60_000);
    await s.tick(at);
    for (let i = 0; i < 8; i += 1) {
      await s.drain(at);
      at = new Date(at.getTime() + 40 * 60_000);
    }
    const run = [...s.store.runs.values()][0]!;
    expect(run).toMatchObject({ status: "failed", outcome: "failed", lastError: "always fails" });
    const runJob = [...s.jobs.jobs.values()].find((job) => job.kind === "workflows.execute_run")!;
    expect(runJob.status).toBe("dead");
    expect(runJob.subjectId).toBe(run.id);
  });

  it("direct execution of a finished run is a no-op", async () => {
    const s = await setup({ steps: [notifyStep] });
    await ingestAuditEvents(s.store, T0);
    s.store.auditEvents.push(auditRow());
    await s.tick(new Date(T0.getTime() + 60_000));
    await s.drain(new Date(T0.getTime() + 60_000));
    const run = [...s.store.runs.values()][0]!;
    expect(await executeRun({ store: s.store, hooks: s.hooks }, run.id)).toEqual({ status: "noop", reason: "run already completed" });
    expect(s.store.notifications.size).toBe(1);
  });
});

describe("test runs", () => {
  it("record what would happen and cause no side effects", async () => {
    const action = vi.fn(async () => ({}));
    const s = await setup({
      steps: [notifyStep, taskStep, { type: "wait", days: 5 }, { type: "request_approval", approver: "hq", title: "ok?" }, { type: "run_action", action: "x" }],
      hooks: { actions: { x: action } }
    });
    const event = (await s.store.insertEvent({ eventKey: "manual:1", type: "franchise.agreement.executed", source: "manual", territoryId: "t-sutton", payload: { franchiseName: "Test Co" }, occurredAt: T0 }, T0)).event;
    const { run } = await s.store.createRun(
      {
        definitionId: s.definition.id,
        versionId: s.version.id,
        eventId: event.id,
        organisationId: null,
        territoryId: "t-sutton",
        subjectType: null,
        subjectId: null,
        isTest: true,
        context: { event: { type: event.type, subjectType: null, subjectId: null, actorUserId: null, occurredAt: T0.toISOString(), payload: event.payload } }
      },
      T0
    );
    const outcome = await executeRun({ store: s.store, hooks: s.hooks, now: () => T0 }, run.id);
    expect(outcome.status).toBe("completed");
    expect(action).not.toHaveBeenCalled();
    expect(s.store.tasks.size + s.store.notifications.size + s.store.approvals.size).toBe(0);
    const steps = await s.store.getSteps(run.id);
    expect(steps).toHaveLength(5);
    expect(steps[0]!.result).toMatchObject({ dryRun: true, wouldNotify: { title: "Agreement signed: Test Co" } });
    expect(steps[1]!.result).toMatchObject({ dryRun: true, wouldCreateTask: { title: "File Test Co agreement" } });
  });
});

describe("dispatch idempotency", () => {
  it("re-dispatching an already-run event creates no second run", async () => {
    const s = await setup({ steps: [notifyStep] });
    const { event } = await s.store.insertEvent({ eventKey: "k1", type: "franchise.agreement.executed", source: "manual", payload: {}, occurredAt: T0 }, T0);
    const schedule = vi.fn(async () => undefined);
    await dispatchPendingEvents(s.store, schedule, T0);
    // Simulate a crash after run creation but before marking dispatched.
    await s.store.insertEvent({ eventKey: "k1", type: "franchise.agreement.executed", source: "manual", payload: {}, occurredAt: T0 }, T0);
    s.store.events.set(event.id, { ...s.store.events.get(event.id)!, dispatchedAt: null });
    const again = await dispatchPendingEvents(s.store, schedule, T0);
    expect(s.store.runs.size).toBe(1);
    expect(again.runsCreated).toBe(0);
    expect(schedule).toHaveBeenCalledTimes(2); // scheduling is repeated, but keyed, so the job queue collapses it
    const calls = schedule.mock.calls as unknown as Array<[{ idempotencyKey: string }]>;
    expect(new Set(calls.map((call) => call[0].idempotencyKey)).size).toBe(1);
  });
});
