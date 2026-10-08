import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it, vi } from "vitest";
import type { LegacyJobReader } from "./legacy";
import { createInMemoryJobStore } from "./memory-store";
import { getTrackedJobCountsForActor, JobAccessError, JobStateError, listTrackedJobsForActor, retryLegacyJob, enqueueJob } from "./service";
import { normaliseLegacyStatus, traceHrefFor } from "./tracked";
import type { TrackedJob } from "./tracked";
import type { JobCounts } from "./types";

const grant = (roleId: string, action: string, scope: string) => ({
  roleId,
  permission: { id: `p-${action}`, module: "system.jobs", action },
  scope
});

const permissions: PermissionData = {
  roleAssignments: [
    { id: "a1", userId: "hq", roleId: "hq-role" },
    { id: "a2", userId: "owner", roleId: "owner-role", territoryId: "sutton" }
  ],
  rolePermissions: [
    grant("hq-role", "view", "network"),
    grant("hq-role", "retry", "network"),
    grant("owner-role", "view", "own_territory")
  ]
};

const hq = { userId: "hq" };
const owner = { userId: "owner", territoryId: "sutton" };

function tracked(overrides: Partial<TrackedJob> & Pick<TrackedJob, "id" | "source">): TrackedJob {
  const created = new Date("2026-01-02T00:00:00Z");
  return {
    kind: "email.send_campaign",
    status: "dead",
    rawStatus: "failed",
    attempts: 5,
    maxAttempts: 5,
    lastError: "boom",
    organisationId: null,
    territoryId: "sutton",
    subjectType: "email_campaign",
    subjectId: "campaign-1",
    createdAt: created,
    updatedAt: created,
    traceHref: "/app/newsletters/campaign-1",
    ...overrides
  };
}

function fakeLegacy(rows: TrackedJob[]): LegacyJobReader & { retried: string[] } {
  const retried: string[] = [];
  const zero = (): JobCounts => ({ queued: 0, running: 0, succeeded: 0, dead: 0, cancelled: 0 });
  return {
    retried,
    list: async (filter) => rows.filter((row) => !filter.territoryId || row.territoryId === filter.territoryId),
    get: async (source, id) => rows.find((row) => row.source === source && row.id === id),
    retryEmailSend: async (id) => {
      retried.push(id);
      const row = rows.find((candidate) => candidate.id === id && candidate.rawStatus === "failed");
      return row ? { ...row, status: "queued", rawStatus: "queued" } : undefined;
    },
    counts: async (filter) => {
      const counts = zero();
      for (const row of rows) if (!filter.territoryId || row.territoryId === filter.territoryId) counts[row.status] += 1;
      return counts;
    }
  };
}

describe("legacy status normalisation", () => {
  it("maps each source's own statuses onto the console's", () => {
    expect(normaliseLegacyStatus("email_send", "processing")).toBe("running");
    expect(normaliseLegacyStatus("email_send", "failed")).toBe("dead");
    expect(normaliseLegacyStatus("email_send", "completed")).toBe("succeeded");
    expect(normaliseLegacyStatus("social_publish", "failed")).toBe("dead");
    expect(normaliseLegacyStatus("website_publish", "ready")).toBe("queued");
    expect(normaliseLegacyStatus("publication_output", "generated")).toBe("succeeded");
    expect(normaliseLegacyStatus("publication_output", "failed")).toBe("dead");
  });

  it("treats an unknown status as queued rather than inventing a failure", () => {
    expect(normaliseLegacyStatus("email_send", "something_new")).toBe("queued");
  });

  it("only builds a trace link when there is a subject", () => {
    expect(traceHrefFor("email_send", null)).toBeNull();
    expect(traceHrefFor("publication_output", "ed-1")).toBe("/app/editions/ed-1");
  });
});

describe("listTrackedJobsForActor", () => {
  async function setup() {
    const store = createInMemoryJobStore();
    const now = new Date("2026-01-01T00:00:00Z");
    await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "g1", territoryId: "sutton" }, now);
    await enqueueJob(store, undefined, { kind: "demo.run", idempotencyKey: "g2", territoryId: "solihull" }, now);
    const legacy = fakeLegacy([
      tracked({ id: "e-sutton", source: "email_send", territoryId: "sutton" }),
      tracked({ id: "e-solihull", source: "email_send", territoryId: "solihull" }),
      tracked({ id: "s-network", source: "social_publish", territoryId: null, kind: "social.publish_post" })
    ]);
    return { store, legacy };
  }

  it("merges generic and legacy jobs for HQ, newest first", async () => {
    const { store, legacy } = await setup();
    const jobs = await listTrackedJobsForActor(hq, permissions, store, legacy);
    expect(jobs).toHaveLength(5);
    expect(jobs[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(jobs[jobs.length - 1]!.createdAt.getTime());
    expect(new Set(jobs.map((job) => job.source))).toEqual(new Set(["jobs", "email_send", "social_publish"]));
  });

  it("shows a territory-scoped actor only their own territory across every source", async () => {
    const { store, legacy } = await setup();
    const jobs = await listTrackedJobsForActor(owner, permissions, store, legacy);
    expect(jobs.map((job) => job.territoryId)).toEqual(["sutton", "sutton"].sort());
    expect(jobs.some((job) => job.id === "e-solihull" || job.id === "s-network")).toBe(false);
  });

  it("returns nothing when a territory-scoped actor asks for another territory", async () => {
    const { store, legacy } = await setup();
    expect(await listTrackedJobsForActor(owner, permissions, store, legacy, { territoryId: "solihull" })).toEqual([]);
  });

  it("denies actors with no grant", async () => {
    const { store, legacy } = await setup();
    await expect(listTrackedJobsForActor({ userId: "nobody" }, permissions, store, legacy)).rejects.toBeInstanceOf(JobAccessError);
  });

  it("sums counts across sources, scoped like the list", async () => {
    const { store, legacy } = await setup();
    expect((await getTrackedJobCountsForActor(hq, permissions, store, legacy)).dead).toBe(3);
    expect((await getTrackedJobCountsForActor(hq, permissions, store, legacy)).queued).toBe(2);
    const own = await getTrackedJobCountsForActor(owner, permissions, store, legacy);
    expect(own.dead).toBe(1);
    expect(own.queued).toBe(1);
  });
});

describe("retryLegacyJob", () => {
  it("re-queues a failed email send job and audits the source", async () => {
    const legacy = fakeLegacy([tracked({ id: "e1", source: "email_send" })]);
    const record = vi.fn(async () => undefined);
    const result = await retryLegacyJob(hq, permissions, { record }, legacy, "email_send", "e1");
    expect(result.rawStatus).toBe("queued");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ops.job.retry", entity: { type: "email_send_job", id: "e1" }, metadata: expect.objectContaining({ source: "email_send" }) })
    );
  });

  it("refuses to retry sources that must be retried from their own workflow", async () => {
    const legacy = fakeLegacy([tracked({ id: "s1", source: "social_publish", kind: "social.publish_post", traceHref: "/app/social" })]);
    await expect(retryLegacyJob(hq, permissions, { record: async () => undefined }, legacy, "social_publish", "s1")).rejects.toThrow(/own workflow|record they belong to/);
    expect(legacy.retried).toEqual([]);
  });

  it("refuses to retry an email job that has not failed", async () => {
    const legacy = fakeLegacy([tracked({ id: "e2", source: "email_send", status: "running", rawStatus: "processing" })]);
    await expect(retryLegacyJob(hq, permissions, { record: async () => undefined }, legacy, "email_send", "e2")).rejects.toBeInstanceOf(JobStateError);
  });

  it("denies retry to a territory owner without the retry grant, and across territories", async () => {
    const legacy = fakeLegacy([tracked({ id: "e3", source: "email_send" }), tracked({ id: "e4", source: "email_send", territoryId: "solihull" })]);
    const record = vi.fn(async () => undefined);
    await expect(retryLegacyJob(owner, permissions, { record }, legacy, "email_send", "e3")).rejects.toBeInstanceOf(JobAccessError);
    await expect(retryLegacyJob(hq, permissions, { record }, legacy, "email_send", "missing")).rejects.toThrow("Job not found.");
    expect(legacy.retried).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });

  it("reports a lost race instead of claiming success", async () => {
    const legacy = fakeLegacy([tracked({ id: "e5", source: "email_send" })]);
    legacy.retryEmailSend = async () => undefined;
    await expect(retryLegacyJob(hq, permissions, { record: async () => undefined }, legacy, "email_send", "e5")).rejects.toThrow(/changed state/);
  });
});
