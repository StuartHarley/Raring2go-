import { describe, expect, it, vi } from "vitest";
import { PermanentJobError } from "./errors";
import { createInMemoryJobStore } from "./memory-store";
import { createJobRegistry, defineJobHandler } from "./registry";
import { runDueJobs } from "./runner";
import { enqueueJob } from "./service";

function clock(start = "2026-01-01T00:00:00Z") {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    }
  };
}

const fast = { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 8_000, leaseMs: 60_000 };

describe("enqueueJob", () => {
  it("is idempotent on the key and returns the original job", async () => {
    const store = createInMemoryJobStore();
    const first = await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "k1", payload: { a: 1 } });
    const second = await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "k1", payload: { a: 2 } });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.payload).toEqual({ a: 1 });
    expect(store.jobs.size).toBe(1);
  });

  it("audits only the creating enqueue", async () => {
    const store = createInMemoryJobStore();
    const record = vi.fn(async () => undefined);
    await enqueueJob(store, { record }, { kind: "demo.run", idempotencyKey: "k1", territoryId: "t1" });
    await enqueueJob(store, { record }, { kind: "demo.run", idempotencyKey: "k1", territoryId: "t1" });
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("rejects a blank idempotency key", async () => {
    await expect(enqueueJob(createInMemoryJobStore(), undefined, { kind: "demo.run", idempotencyKey: "  " })).rejects.toThrow(/idempotency/i);
  });
});

describe("runDueJobs", () => {
  it("runs a due job to success and records the attempt", async () => {
    const store = createInMemoryJobStore();
    const time = clock();
    const handle = vi.fn(async () => ({ ok: true }));
    const registry = createJobRegistry([defineJobHandler({ kind: "demo.run", handle, ...fast })]);
    const { job } = await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "k1" }, time.now());

    const summary = await runDueJobs(store, registry, { workerId: "w1", now: time.now });

    expect(summary).toEqual({ claimed: 1, succeeded: 1, retried: 0, deadLettered: 0 });
    expect(handle).toHaveBeenCalledTimes(1);
    const stored = await store.get(job.id);
    expect(stored?.status).toBe("succeeded");
    expect(stored?.result).toEqual({ ok: true });
    expect((await store.attempts(job.id)).map((a) => a.outcome)).toEqual(["succeeded"]);
  });

  it("does not run jobs before run_after", async () => {
    const store = createInMemoryJobStore();
    const time = clock();
    const handle = vi.fn(async () => undefined);
    const registry = createJobRegistry([defineJobHandler({ kind: "demo.run", handle, ...fast })]);
    await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "k1", runAfter: new Date(time.now().getTime() + 5_000) }, time.now());

    expect((await runDueJobs(store, registry, { workerId: "w1", now: time.now })).claimed).toBe(0);
    time.advance(5_000);
    expect((await runDueJobs(store, registry, { workerId: "w1", now: time.now })).claimed).toBe(1);
  });

  it("retries with backoff, then dead-letters when attempts are exhausted, keeping every attempt", async () => {
    const store = createInMemoryJobStore();
    const time = clock();
    const onDeadLettered = vi.fn();
    const onRetryScheduled = vi.fn();
    const registry = createJobRegistry([
      defineJobHandler({ kind: "demo.run", handle: async () => { throw new Error("provider down"); }, ...fast })
    ]);
    const { job } = await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "k1", maxAttempts: 3 }, time.now());
    const options = { workerId: "w1", now: time.now, random: () => 1, hooks: { onDeadLettered, onRetryScheduled } };

    expect(await runDueJobs(store, registry, options)).toMatchObject({ retried: 1, deadLettered: 0 });
    expect((await store.get(job.id))?.status).toBe("queued");

    // Not due yet: backoff is 1s after attempt 1.
    expect((await runDueJobs(store, registry, options)).claimed).toBe(0);
    time.advance(1_000);
    expect(await runDueJobs(store, registry, options)).toMatchObject({ retried: 1 });
    time.advance(2_000);
    expect(await runDueJobs(store, registry, options)).toMatchObject({ deadLettered: 1 });

    const stored = await store.get(job.id);
    expect(stored?.status).toBe("dead");
    expect(stored?.attempts).toBe(3);
    expect(stored?.lastErrorCode).toBe("attempts_exhausted");
    expect(onRetryScheduled).toHaveBeenCalledTimes(2);
    expect(onDeadLettered).toHaveBeenCalledTimes(1);
    expect((await store.attempts(job.id)).map((a) => a.outcome)).toEqual(["failed", "failed", "dead"]);
  });

  it("dead-letters a permanent error on the first attempt", async () => {
    const store = createInMemoryJobStore();
    const time = clock();
    const registry = createJobRegistry([
      defineJobHandler({ kind: "demo.run", handle: async () => { throw new PermanentJobError("missing record", "not_found"); }, ...fast })
    ]);
    const { job } = await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "k1" }, time.now());
    await runDueJobs(store, registry, { workerId: "w1", now: time.now });
    const stored = await store.get(job.id);
    expect(stored?.status).toBe("dead");
    expect(stored?.attempts).toBe(1);
    expect(stored?.lastErrorCode).toBe("not_found");
  });

  it("only claims kinds that have a registered handler", async () => {
    const store = createInMemoryJobStore();
    const time = clock();
    const registry = createJobRegistry([defineJobHandler({ kind: "demo.run", handle: async () => undefined, ...fast })]);
    const { job } = await enqueueJob(store, undefined, { kind: "other.kind", idempotencyKey: "k1" }, time.now());
    expect((await runDueJobs(store, registry, { workerId: "w1", now: time.now })).claimed).toBe(0);
    expect((await store.get(job.id))?.status).toBe("queued");
  });

  it("reclaims a job whose worker lease expired and marks the abandoned attempt timed out", async () => {
    const store = createInMemoryJobStore();
    const time = clock();
    const handle = vi.fn(async () => undefined);
    const registry = createJobRegistry([defineJobHandler({ kind: "demo.run", handle, ...fast })]);
    const { job } = await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "k1" }, time.now());

    // A worker claims the job, then dies without reporting.
    await store.claim({ workerId: "dead-worker", now: time.now(), leaseMs: () => 60_000, kinds: ["demo.run"] });
    expect((await runDueJobs(store, registry, { workerId: "w2", now: time.now })).claimed).toBe(0);

    time.advance(60_001);
    expect(await runDueJobs(store, registry, { workerId: "w2", now: time.now })).toMatchObject({ succeeded: 1 });
    expect((await store.attempts(job.id)).map((a) => [a.workerId, a.outcome])).toEqual([
      ["dead-worker", "timed_out"],
      ["w2", "succeeded"]
    ]);
  });

  it("two workers never run the same job concurrently", async () => {
    const store = createInMemoryJobStore();
    const time = clock();
    const handle = vi.fn(async () => undefined);
    const registry = createJobRegistry([defineJobHandler({ kind: "demo.run", handle, ...fast })]);
    await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "k1" }, time.now());
    const [a, b] = await Promise.all([
      runDueJobs(store, registry, { workerId: "a", now: time.now }),
      runDueJobs(store, registry, { workerId: "b", now: time.now })
    ]);
    expect(a.claimed + b.claimed).toBe(1);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("treats a handler that outlives its lease as a retryable timeout", async () => {
    vi.useFakeTimers();
    try {
      const store = createInMemoryJobStore();
      const registry = createJobRegistry([
        defineJobHandler({ kind: "demo.run", handle: () => new Promise(() => undefined), ...fast, leaseMs: 1_000 })
      ]);
      const { job } = await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "k1" });
      const running = runDueJobs(store, registry, { workerId: "w1" });
      await vi.advanceTimersByTimeAsync(1_001);
      expect(await running).toMatchObject({ retried: 1 });
      expect((await store.get(job.id))?.lastErrorCode).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects maxJobs and higher priority first", async () => {
    const store = createInMemoryJobStore();
    const time = clock();
    const order: string[] = [];
    const registry = createJobRegistry([
      defineJobHandler({ kind: "demo.run", handle: async ({ job }) => { order.push(String(job.payload.name)); }, ...fast })
    ]);
    await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "low", payload: { name: "low" }, priority: 0 }, time.now());
    await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "high", payload: { name: "high" }, priority: 5 }, time.now());
    await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "low2", payload: { name: "low2" }, priority: 0 }, time.now());
    const summary = await runDueJobs(store, registry, { workerId: "w1", now: time.now, maxJobs: 2 });
    expect(summary.claimed).toBe(2);
    expect(order[0]).toBe("high");
  });
});

describe("registry", () => {
  it("rejects duplicate kinds and malformed kinds", () => {
    const handle = async () => undefined;
    expect(() => createJobRegistry([defineJobHandler({ kind: "a.b", handle }), defineJobHandler({ kind: "a.b", handle })])).toThrow(/duplicate/i);
    expect(() => defineJobHandler({ kind: "NotDotCase", handle })).toThrow(/dot-case/);
    expect(() => defineJobHandler({ kind: "a.b", handle, leaseMs: 10 })).toThrow(/lease/);
  });
});
