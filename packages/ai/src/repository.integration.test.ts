import { randomUUID } from "node:crypto";
import { aiRuns, createDb, fixtureIds } from "@raring2go/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDrizzleAiRunStore } from "./repository";
import type { NewAiRun } from "./runs";

/** Real SQL for the AI run store. `RUN_DB_TESTS=1 pnpm --filter @raring2go/ai test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("drizzle AI run store (postgres)", () => {
  const { db, sql } = createDb();
  const store = createDrizzleAiRunStore(db);
  const tag = randomUUID().slice(0, 8);
  const ids: string[] = [];

  afterAll(async () => {
    for (const id of ids) await db.delete(aiRuns).where(eq(aiRuns.id, id));
    await sql.end();
  });

  const base = (overrides: Partial<NewAiRun> = {}): NewAiRun => ({
    taskKey: `itest.task_${tag}`, purpose: "Integration test", promptVersion: "v1", providerKey: "deterministic", modelReference: "m", status: "succeeded", risk: "low",
    approvalState: "pending", actorType: "human", actorUserId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise,
    territoryId: fixtureIds.territories.suttonColdfield, subjectType: "content_item", subjectId: `subject-${tag}`,
    sourceRefs: [{ type: "content_item", id: "c1" }], input: { title: "x" }, output: { text: "y" }, inputTokens: 10, outputTokens: 5, estimatedCostMinor: 1, latencyMs: 12, error: null,
    ...overrides
  });

  it("round-trips a run with its references, output and usage, and lists by subject", async () => {
    const run = await store.insert(base(), new Date());
    ids.push(run.id);
    const loaded = await store.get(run.id);
    expect(loaded).toMatchObject({ taskKey: `itest.task_${tag}`, approvalState: "pending", sourceRefs: [{ type: "content_item", id: "c1" }], output: { text: "y" }, inputTokens: 10 });
    const bySubject = await store.list({ subjectType: "content_item", subjectId: `subject-${tag}` });
    expect(bySubject.map((entry) => entry.id)).toContain(run.id);
    expect(await store.list({ subjectId: `subject-${tag}`, territoryId: fixtureIds.territories.solihull })).toEqual([]);
  });

  it("decides a pending run exactly once", async () => {
    const run = await store.insert(base(), new Date());
    ids.push(run.id);
    const first = await store.decide(run.id, { state: "approved", userId: fixtureIds.users.superAdmin, note: "ok" }, new Date());
    expect(first).toMatchObject({ approvalState: "approved", decidedByUserId: fixtureIds.users.superAdmin, decisionNote: "ok" });
    expect(await store.decide(run.id, { state: "rejected", userId: fixtureIds.users.superAdmin, note: null }, new Date())).toBeUndefined();
    expect((await store.get(run.id))!.approvalState).toBe("approved");
  });

  it("applies only approved or not-required output, once", async () => {
    const pending = await store.insert(base(), new Date());
    const informational = await store.insert(base({ approvalState: "not_required" }), new Date());
    const failed = await store.insert(base({ status: "failed", approvalState: "not_required", output: {} }), new Date());
    ids.push(pending.id, informational.id, failed.id);

    expect(await store.markApplied(pending.id, new Date())).toBeUndefined();
    expect(await store.markApplied(failed.id, new Date())).toBeUndefined();
    expect((await store.markApplied(informational.id, new Date()))?.appliedAt).not.toBeNull();
    expect(await store.markApplied(informational.id, new Date())).toBeUndefined();
  });
});
