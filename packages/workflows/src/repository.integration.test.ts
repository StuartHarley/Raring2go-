import { randomUUID } from "node:crypto";
import { createDb, jobAttempts, jobs } from "@raring2go/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJobRegistry, defineJobHandler } from "./registry";
import { createDrizzleJobStore, pruneFinishedJobs, readQueueStats } from "./repository";
import { runDueJobs } from "./runner";
import { enqueueJob } from "./service";

/**
 * Exercises the real SQL (SKIP LOCKED claim, lease reclaim, conflict-on-idempotency).
 * Needs a migrated Postgres: `docker compose up -d db && pnpm db:migrate`, then
 * `RUN_DB_TESTS=1 pnpm --filter @raring2go/workflows test`.
 */
describe.skipIf(!process.env.RUN_DB_TESTS)("drizzle job store (postgres)", () => {
  const { db, sql } = createDb();
  const store = createDrizzleJobStore(db);
  const run = randomUUID().slice(0, 8);
  const kind = `itest.job_${run.replace(/[^a-z0-9]/g, "x")}`;
  const createdIds: string[] = [];
  const key = (name: string) => `${run}:${name}`;

  async function enqueue(name: string, extra: Record<string, unknown> = {}) {
    const result = await enqueueJob(store, undefined, { kind, idempotencyKey: key(name), ...extra });
    createdIds.push(result.job.id);
    return result;
  }

  beforeAll(() => {
    expect(process.env.DATABASE_URL ?? "").toContain("localhost");
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await db.delete(jobAttempts).where(inArray(jobAttempts.jobId, createdIds));
      await db.delete(jobs).where(inArray(jobs.id, createdIds));
    }
    await sql.end();
  });

  it("dedupes on the idempotency key", async () => {
    const first = await enqueue("dedupe", { payload: { n: 1 } });
    const second = await enqueue("dedupe", { payload: { n: 2 } });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.payload).toEqual({ n: 1 });
  });

  it("claims each job exactly once under concurrent workers", async () => {
    const total = 12;
    for (let i = 0; i < total; i += 1) {
      await enqueue(`concurrent-${i}`);
    }
    const seen: string[] = [];
    const registry = createJobRegistry([
      defineJobHandler({
        kind,
        handle: async ({ job }) => {
          seen.push(job.id);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })
    ]);

    await Promise.all(
      ["a", "b", "c", "d"].map((workerId) => runDueJobs(store, registry, { workerId, maxJobs: total }))
    );

    const mine = seen.filter((id) => createdIds.includes(id));
    expect(new Set(mine).size).toBe(mine.length); // no job ran twice
    expect(mine.length).toBeGreaterThanOrEqual(total);
  });

  it("reclaims an expired lease and closes the abandoned attempt", async () => {
    const { job } = await enqueue("lease");
    const t0 = new Date();
    const first = await store.claim({ workerId: "crashed", now: t0, leaseMs: () => 1_000, kinds: [kind] });
    expect(first?.job.id).toBe(job.id);
    expect(await store.claim({ workerId: "other", now: t0, leaseMs: () => 1_000, kinds: [kind] })).toBeUndefined();

    const later = new Date(t0.getTime() + 2_000);
    const second = await store.claim({ workerId: "rescuer", now: later, leaseMs: () => 1_000, kinds: [kind] });
    expect(second?.job.id).toBe(job.id);
    expect(second?.attempt.attemptNumber).toBe(2);
    expect((await store.attempts(job.id)).map((a) => [a.workerId, a.outcome])).toEqual([
      ["crashed", "timed_out"],
      ["rescuer", "running"]
    ]);
  });

  it("fails to dead, then manual requeue gives a fresh budget; cancel only applies to queued", async () => {
    const { job } = await enqueue("lifecycle", { maxAttempts: 1 });
    const now = new Date();
    const claimed = await store.claim({ workerId: "w", now, leaseMs: () => 60_000, kinds: [kind] });
    expect(claimed?.job.id).toBe(job.id);
    const dead = await store.fail(job.id, claimed!.attempt.id, { status: "dead", runAfter: now, error: "nope", errorCode: "attempts_exhausted" }, now);
    expect(dead.status).toBe("dead");
    expect(await store.cancel(job.id, now)).toBeUndefined();

    const requeued = await store.requeue(job.id, { now, maxAttempts: 2 });
    expect(requeued).toMatchObject({ status: "queued", maxAttempts: 2, attempts: 1 });
    const cancelled = await store.cancel(job.id, now);
    expect(cancelled?.status).toBe("cancelled");
    expect(await store.requeue(randomUUID(), { now, maxAttempts: 1 })).toBeUndefined();
  });

  it("prunes only finished jobs older than the cutoff and keeps dead-lettered ones", async () => {
    const old = new Date("2020-01-01T00:00:00Z");
    const finished = (await enqueue("prune-ok", { runAfter: old })).job;
    const claimedOk = await store.claim({ workerId: "w", now: old, leaseMs: () => 1_000, kinds: [kind] });
    expect(claimedOk?.job.id).toBe(finished.id);
    await store.succeed(finished.id, claimedOk!.attempt.id, {}, old);

    const stuck = (await enqueue("prune-dead", { runAfter: old, maxAttempts: 1 })).job;
    const claimedDead = await store.claim({ workerId: "w", now: old, leaseMs: () => 1_000, kinds: [kind] });
    expect(claimedDead?.job.id).toBe(stuck.id);
    await store.fail(stuck.id, claimedDead!.attempt.id, { status: "dead", runAfter: old, error: "x", errorCode: null }, old);

    expect(await pruneFinishedJobs(db, new Date("2021-01-01T00:00:00Z"))).toBeGreaterThanOrEqual(1);
    expect(await store.get(finished.id)).toBeUndefined();
    expect((await store.get(stuck.id))?.status).toBe("dead");
  });

  it("reports queue stats: overdue jobs, expired leases and dead letters", async () => {
    const before = await readQueueStats(db, new Date());
    const past = new Date(Date.now() - 60 * 60_000);
    await enqueue("stats-overdue", { runAfter: past });
    await enqueue("stats-lease", { runAfter: past });
    const claimed = await store.claim({ workerId: "w", now: past, leaseMs: () => 1_000, kinds: [kind] });
    expect(claimed).toBeDefined();

    const after = await readQueueStats(db, new Date());
    // One queued overdue job (the other one is now running with a long-expired lease).
    expect(after.overdueQueued).toBe(before.overdueQueued + 1);
    expect(after.expiredLeases).toBe(before.expiredLeases + 1);
    expect(after.queued).toBeGreaterThanOrEqual(before.queued + 1);
  });

  it("counts by status", async () => {
    const counts = await store.counts({});
    expect(counts.cancelled + counts.queued + counts.dead + counts.succeeded + counts.running).toBeGreaterThan(0);
  });
});
