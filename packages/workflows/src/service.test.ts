import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryJobStore } from "./memory-store";
import { createJobRegistry, defineJobHandler } from "./registry";
import { auditDeadLetter, cancelJob, enqueueJob, getJobCountsForActor, getJobDetailForActor, JobAccessError, JobStateError, listJobsForActor, retryJob } from "./service";

const KIND = "demo.run";
const registry = createJobRegistry([defineJobHandler({ kind: KIND, handle: async () => undefined, maxAttempts: 3 })]);

const permission = (action: string) => ({ id: `perm-${action}`, module: "system.jobs", action });
const grant = (roleId: string, action: string, scope: string) => ({ roleId, permission: permission(action), scope });

const permissions: PermissionData = {
  roleAssignments: [
    { id: "a1", userId: "hq", roleId: "hq-role" },
    { id: "a2", userId: "sutton-owner", roleId: "franchisee-role", territoryId: "sutton" },
    { id: "a3", userId: "nobody", roleId: "empty-role" }
  ],
  rolePermissions: [
    grant("hq-role", "view", "network"),
    grant("hq-role", "retry", "network"),
    grant("hq-role", "cancel", "network"),
    grant("franchisee-role", "view", "own_territory")
  ]
};

const hq = { userId: "hq" };
const sutton = { userId: "sutton-owner", territoryId: "sutton" };
const stranger = { userId: "nobody" };

async function seed() {
  const store = createInMemoryJobStore();
  const now = new Date("2026-01-01T00:00:00Z");
  const suttonJob = (await enqueueJob(store, undefined, { kind: KIND, idempotencyKey: "s", territoryId: "sutton" }, now)).job;
  const solihullJob = (await enqueueJob(store, undefined, { kind: KIND, idempotencyKey: "h", territoryId: "solihull" }, now)).job;
  const networkJob = (await enqueueJob(store, undefined, { kind: KIND, idempotencyKey: "n" }, now)).job;
  return { store, now, suttonJob, solihullJob, networkJob };
}

describe("job visibility and tenancy", () => {
  it("HQ (network scope) sees every job", async () => {
    const { store } = await seed();
    expect(await listJobsForActor(hq, permissions, store)).toHaveLength(3);
  });

  it("a territory-scoped actor sees only their own territory's jobs", async () => {
    const { store, suttonJob } = await seed();
    const visible = await listJobsForActor(sutton, permissions, store);
    expect(visible.map((job) => job.id)).toEqual([suttonJob.id]);
  });

  it("a territory-scoped actor cannot widen the query to another territory", async () => {
    const { store } = await seed();
    const visible = await listJobsForActor(sutton, permissions, store, { territoryId: "solihull" });
    expect(visible).toEqual([]);
  });

  it("an actor without the permission is denied", async () => {
    const { store } = await seed();
    await expect(listJobsForActor(stranger, permissions, store)).rejects.toBeInstanceOf(JobAccessError);
    await expect(getJobCountsForActor(stranger, permissions, store)).rejects.toBeInstanceOf(JobAccessError);
  });

  it("job detail for another territory is indistinguishable from not found", async () => {
    const { store, solihullJob } = await seed();
    await expect(getJobDetailForActor(sutton, permissions, store, solihullJob.id)).rejects.toThrow("Job not found.");
    await expect(getJobDetailForActor(sutton, permissions, store, "00000000-0000-0000-0000-000000000000")).rejects.toThrow("Job not found.");
  });

  it("network-scope jobs (no territory) are hidden from territory-scoped actors", async () => {
    const { store, networkJob } = await seed();
    await expect(getJobDetailForActor(sutton, permissions, store, networkJob.id)).rejects.toBeInstanceOf(JobAccessError);
  });

  it("counts are scoped like the list", async () => {
    const { store } = await seed();
    expect((await getJobCountsForActor(hq, permissions, store)).queued).toBe(3);
    expect((await getJobCountsForActor(sutton, permissions, store)).queued).toBe(1);
  });
});

describe("retryJob / cancelJob", () => {
  async function deadJob() {
    const seeded = await seed();
    const claimed = await seeded.store.claim({ workerId: "w", now: seeded.now, leaseMs: () => 1_000, kinds: [KIND] });
    const failed = await seeded.store.fail(
      claimed!.job.id,
      claimed!.attempt.id,
      { status: "dead", runAfter: seeded.now, error: "boom", errorCode: "attempts_exhausted" },
      seeded.now
    );
    return { ...seeded, failed };
  }

  it("requeues a dead job with a fresh budget and audits it", async () => {
    const { store, failed } = await deadJob();
    const record = vi.fn(async () => undefined);
    const requeued = await retryJob(hq, permissions, { record }, store, registry, failed.id);
    expect(requeued.status).toBe("queued");
    expect(requeued.maxAttempts).toBe(failed.attempts + 3);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "ops.job.retry", entity: { type: "job", id: failed.id } }));
  });

  it("refuses to retry a job that is not dead or cancelled", async () => {
    const { store, networkJob } = await seed();
    await expect(retryJob(hq, permissions, { record: async () => undefined }, store, registry, networkJob.id)).rejects.toBeInstanceOf(JobStateError);
  });

  it("refuses to retry a job with no registered handler", async () => {
    const { store, failed } = await deadJob();
    const empty = createJobRegistry([]);
    await expect(retryJob(hq, permissions, { record: async () => undefined }, store, empty, failed.id)).rejects.toThrow(/No handler/);
  });

  it("denies retry to actors without the retry permission, even with view", async () => {
    const { store, failed } = await deadJob();
    const record = vi.fn(async () => undefined);
    await expect(retryJob(sutton, permissions, { record }, store, registry, failed.id)).rejects.toBeInstanceOf(JobAccessError);
    expect(record).not.toHaveBeenCalled();
    expect((await store.get(failed.id))?.status).toBe("dead");
  });

  it("cancels only queued jobs and audits it", async () => {
    const { store, networkJob } = await seed();
    const record = vi.fn(async () => undefined);
    const cancelled = await cancelJob(hq, permissions, { record }, store, networkJob.id);
    expect(cancelled.status).toBe("cancelled");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "ops.job.cancel" }));
    await expect(cancelJob(hq, permissions, { record }, store, networkJob.id)).rejects.toBeInstanceOf(JobStateError);
  });

  it("denies cancel across territories", async () => {
    const { store, solihullJob } = await seed();
    await expect(cancelJob(sutton, permissions, { record: async () => undefined }, store, solihullJob.id)).rejects.toBeInstanceOf(JobAccessError);
  });

  it("records a dead-letter audit event with the failure context", async () => {
    const { failed } = await deadJob();
    const record = vi.fn(async () => undefined);
    await auditDeadLetter({ record }, failed);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ops.job.dead_lettered",
        actor: { type: "system", systemId: "job-runner" },
        metadata: expect.objectContaining({ kind: KIND, errorCode: "attempts_exhausted" })
      })
    );
  });
});
