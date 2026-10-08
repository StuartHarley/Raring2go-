import { randomUUID } from "node:crypto";
import {
  auditEvents,
  createDb,
  fixtureIds,
  jobAttempts,
  jobs,
  notifications,
  workflowApprovals,
  workflowDefinitions,
  workflowEventCursors,
  workflowEvents,
  workflowRunSteps,
  workflowRuns,
  workflowTasks,
  workflowVersions
} from "@raring2go/db";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDrizzleJobStore } from "../repository";
import { createJobRegistry } from "../registry";
import { runDueJobs } from "../runner";
import { enqueueJob } from "../service";
import { createWorkflowJobHandlers, WORKFLOW_TICK_KIND } from "./jobs";
import { ingestAuditEvents } from "./ingest";
import { createDrizzleEngineStore } from "./repository";
import type { EngineHooks } from "./executor";

/**
 * Whole pipeline on real Postgres: audit row -> event -> run -> job -> steps.
 * `RUN_DB_TESTS=1 pnpm --filter @raring2go/workflows test`
 */
describe.skipIf(!process.env.RUN_DB_TESTS)("workflow engine (postgres)", () => {
  const { db, sql } = createDb();
  const store = createDrizzleEngineStore(db);
  const jobStore = createDrizzleJobStore(db);
  const tag = randomUUID().slice(0, 8);
  const action = `itest.engine_${tag}.happened`;
  const cursorName = `itest-${tag}`;
  const territoryId = fixtureIds.territories.suttonColdfield;
  const hooks: EngineHooks = { actions: {}, guards: {} };
  let definitionId = "";

  afterAll(async () => {
    const runs = definitionId ? await db.select({ id: workflowRuns.id }).from(workflowRuns).where(eq(workflowRuns.definitionId, definitionId)) : [];
    const runIds = runs.map((run) => run.id);
    if (runIds.length > 0) {
      await db.delete(workflowTasks).where(inArray(workflowTasks.runId, runIds));
      await db.delete(workflowApprovals).where(inArray(workflowApprovals.runId, runIds));
      await db.delete(workflowRunSteps).where(inArray(workflowRunSteps.runId, runIds));
      await db.delete(notifications).where(inArray(notifications.sourceId, runIds));
      const runJobs = await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.subjectId, runIds));
      if (runJobs.length > 0) {
        await db.delete(jobAttempts).where(inArray(jobAttempts.jobId, runJobs.map((job) => job.id)));
        await db.delete(jobs).where(inArray(jobs.id, runJobs.map((job) => job.id)));
      }
      await db.delete(workflowRuns).where(inArray(workflowRuns.id, runIds));
    }
    await db.delete(workflowEvents).where(like(workflowEvents.type, `itest.engine_${tag}.%`));
    if (definitionId) {
      await db.delete(workflowVersions).where(eq(workflowVersions.definitionId, definitionId));
      await db.delete(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId));
    }
    await db.delete(auditEvents).where(eq(auditEvents.action, action));
    await db.delete(workflowEventCursors).where(like(workflowEventCursors.name, `${cursorName}%`));
    await sql.end();
  });

  async function drain(at: Date) {
    const registry = createJobRegistry(createWorkflowJobHandlers({ store, hooks, jobs: jobStore, cursorName }));
    return runDueJobs(jobStore, registry, { workerId: `itest-${tag}`, now: () => at, maxJobs: 20 });
  }

  it("runs a lifecycle workflow from a real audit row exactly once, however often it is replayed", async () => {
    const start = new Date();
    const definition = await store.upsertDefinition({ key: `itest.${tag}`, name: "Integration test workflow" }, start);
    definitionId = definition.id;
    const version = await store.createVersion(
      definition.id,
      {
        triggerEvent: action,
        conditions: [],
        settings: { waitDays: 1 },
        steps: [
          { type: "notify", audience: "hq", title: "Signed: {{event.payload.franchiseName}}" },
          { type: "create_task", title: "File agreement for {{event.payload.franchiseName}}", assignee: "hq", dueInDays: 2 },
          { type: "wait", days: { setting: "waitDays" } },
          { type: "notify", audience: "territory", title: "Follow-up due" }
        ]
      },
      null,
      start
    );
    expect((await store.activateVersion(version.id, null, start))?.status).toBe("active");

    // Switch-on: creates the cursor/floor. Then a lifecycle audit row arrives.
    await ingestAuditEvents(store, start, { cursorName });
    const auditId = randomUUID();
    const when = new Date(start.getTime() + 1_000);
    await db.insert(auditEvents).values({
      id: auditId,
      action,
      entityType: "franchise_agreement",
      entityId: randomUUID(),
      territoryId,
      payload: { after: { franchiseName: "Sutton Coldfield" }, actor: { type: "system" } },
      createdAt: when
    });

    const tick1 = new Date(start.getTime() + 60_000);
    expect(await ingestAuditEvents(store, tick1, { cursorName })).toMatchObject({ ingested: 1 });
    // Replays: re-scanning the same window must not ingest it again.
    await store.setCursor(cursorName, { lastCreatedAt: start, lastId: null }, tick1);
    expect(await ingestAuditEvents(store, tick1, { cursorName })).toMatchObject({ scanned: 1, ingested: 0 });

    await enqueueJob(jobStore, undefined, { kind: WORKFLOW_TICK_KIND, idempotencyKey: `${WORKFLOW_TICK_KIND}:itest:${tag}:1` }, tick1);
    await drain(tick1);
    await drain(tick1);

    const [event] = await db.select().from(workflowEvents).where(eq(workflowEvents.eventKey, `audit:${auditId}`));
    expect(event?.dispatchedAt).not.toBeNull();
    const [run] = await store.listRuns({ definitionId: definition.id });
    expect(run).toMatchObject({ status: "waiting", waitingOn: "timer", territoryId, currentStep: 2 });

    const tasks = await store.listTasks({ territoryId });
    const mine = tasks.filter((task) => task.runId === run!.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: "File agreement for Sutton Coldfield", assigneeScope: "hq", status: "open" });
    const notes = (await store.listNotifications({ territoryId })).filter((note) => note.sourceId === run!.id);
    expect(notes.map((note) => note.title)).toEqual(["Signed: Sutton Coldfield"]);

    // A day later the timer fires; the run completes and the second notification appears once.
    const later = new Date(tick1.getTime() + 25 * 3_600_000);
    await enqueueJob(jobStore, undefined, { kind: WORKFLOW_TICK_KIND, idempotencyKey: `${WORKFLOW_TICK_KIND}:itest:${tag}:2` }, later);
    await drain(later);
    await drain(later);

    expect(await store.getRun(run!.id)).toMatchObject({ status: "completed", outcome: "completed" });
    const finalNotes = (await store.listNotifications({ territoryId })).filter((note) => note.sourceId === run!.id);
    expect(finalNotes.map((note) => note.title).sort()).toEqual(["Follow-up due", "Signed: Sutton Coldfield"]);
    expect((await store.listTasks({ territoryId })).filter((task) => task.runId === run!.id)).toHaveLength(1);
  });

  it("enforces one active version per definition at the database level", async () => {
    const v2 = await store.createVersion(definitionId, { triggerEvent: action, conditions: [], steps: [{ type: "notify", audience: "hq", title: "v2" }], settings: {} }, null, new Date());
    expect(v2.versionNumber).toBe(2);
    const direct = db.update(workflowVersions).set({ status: "active" }).where(eq(workflowVersions.id, v2.id));
    await expect(direct).rejects.toThrow();
    expect((await store.activateVersion(v2.id, null, new Date()))?.status).toBe("active");
    const versions = await store.listVersions(definitionId);
    expect(versions.filter((version) => version.status === "active")).toHaveLength(1);
    expect(versions.find((version) => version.versionNumber === 1)?.status).toBe("retired");
  });
});
