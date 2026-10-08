import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it, vi } from "vitest";
import { JobAccessError, JobStateError } from "../service";
import { createInMemoryEngineStore } from "./memory-store";
import { completeTaskForActor, decideApprovalForActor, getRunForActor, listApprovalsForActor, listNotificationsForActor, listRunsForActor, listTasksForActor } from "./service";

const NOW = new Date("2026-03-01T00:00:00Z");
const grant = (roleId: string, module: string, action: string, scope: string) => ({ roleId, permission: { id: `${module}.${action}`, module, action }, scope });

const permissions: PermissionData = {
  roleAssignments: [
    { id: "a1", userId: "hq", roleId: "hq" },
    { id: "a2", userId: "sutton", roleId: "owner", territoryId: "sutton" },
    { id: "a3", userId: "nobody", roleId: "none" }
  ],
  rolePermissions: [
    ...["task.view", "task.complete", "approval.view", "approval.decide", "workflow.view"].map((key) => {
      const [name, action] = key.split(".") as [string, string];
      return grant("hq", `automation.${name}`, action, "network");
    }),
    grant("owner", "automation.task", "view", "own_territory"),
    grant("owner", "automation.task", "complete", "own_territory"),
    grant("owner", "automation.approval", "view", "own_territory"),
    grant("owner", "automation.approval", "decide", "own_territory"),
    grant("owner", "automation.workflow", "view", "own_territory")
  ]
};

const hq = { userId: "hq" };
const owner = { userId: "sutton", territoryId: "sutton" };

async function seed() {
  const store = createInMemoryEngineStore();
  const base = { organisationId: null, runId: null, stepIndex: null, subjectType: null, subjectId: null };
  const mk = (title: string, scope: "territory" | "hq", territoryId: string) =>
    store.createTask({ ...base, title, assigneeScope: scope, territoryId, idempotencyKey: `k:${title}` }, NOW);
  const own = (await mk("sutton team task", "territory", "sutton")).task;
  const ownHq = (await mk("sutton hq task", "hq", "sutton")).task;
  const other = (await mk("solihull team task", "territory", "solihull")).task;
  return { store, own, ownHq, other };
}

describe("tasks", () => {
  it("a territory owner sees only their territory's team tasks, never HQ-assigned or other territories'", async () => {
    const { store, own } = await seed();
    expect((await listTasksForActor(owner, permissions, store)).map((task) => task.id)).toEqual([own.id]);
  });

  it("HQ sees every task", async () => {
    const { store } = await seed();
    expect(await listTasksForActor(hq, permissions, store)).toHaveLength(3);
  });

  it("denies actors with no grant", async () => {
    const { store } = await seed();
    await expect(listTasksForActor({ userId: "nobody" }, permissions, store)).rejects.toBeInstanceOf(JobAccessError);
  });

  it("completes once, audits, and records who did it", async () => {
    const { store, own } = await seed();
    const record = vi.fn(async () => undefined);
    const done = await completeTaskForActor(owner, permissions, { record }, store, own.id, NOW);
    expect(done).toMatchObject({ status: "done", completedByUserId: "sutton" });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "workflow.task.complete" }));
    await expect(completeTaskForActor(owner, permissions, { record }, store, own.id)).rejects.toBeInstanceOf(JobStateError);
  });

  it("a territory owner cannot complete an HQ task in their own territory, or another territory's task", async () => {
    const { store, ownHq, other } = await seed();
    const record = vi.fn(async () => undefined);
    await expect(completeTaskForActor(owner, permissions, { record }, store, ownHq.id)).rejects.toBeInstanceOf(JobAccessError);
    await expect(completeTaskForActor(owner, permissions, { record }, store, other.id)).rejects.toBeInstanceOf(JobAccessError);
    expect(record).not.toHaveBeenCalled();
    expect((await store.getTask(ownHq.id))!.status).toBe("open");
  });
});

describe("approvals", () => {
  async function withApprovals() {
    const store = createInMemoryEngineStore();
    const run = (await store.createRun({ definitionId: "d", versionId: "v", eventId: null, organisationId: null, territoryId: "sutton", subjectType: null, subjectId: null, context: {} }, NOW)).run;
    const mk = (index: number, approverScope: "territory" | "hq") =>
      store.createApproval({ runId: run.id, stepIndex: index, title: `${approverScope} approval`, approverScope, organisationId: null, territoryId: "sutton" }, NOW);
    const team = (await mk(0, "territory")).approval;
    const head = (await mk(1, "hq")).approval;
    return { store, run, team, head };
  }

  it("lists only approvals the actor may decide on", async () => {
    const { store, team } = await withApprovals();
    expect((await listApprovalsForActor(owner, permissions, store)).map((approval) => approval.id)).toEqual([team.id]);
    expect(await listApprovalsForActor(hq, permissions, store)).toHaveLength(2);
  });

  it("decides exactly once and schedules a single resume", async () => {
    const { store, team, run } = await withApprovals();
    const schedule = vi.fn(async () => undefined);
    const record = vi.fn(async () => undefined);
    const decided = await decideApprovalForActor(owner, permissions, { record }, store, schedule, team.id, { status: "approved", note: " ok " }, NOW);
    expect(decided).toMatchObject({ status: "approved", decisionNote: "ok", decidedByUserId: "sutton" });
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ run: expect.objectContaining({ id: run.id }), idempotencyKey: `workflow-run:${run.id}:approval:${team.id}` }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "workflow.approval.approve" }));

    await expect(decideApprovalForActor(owner, permissions, { record }, store, schedule, team.id, { status: "rejected" })).rejects.toBeInstanceOf(JobStateError);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("records a rejection under its own audit action", async () => {
    const { store, head } = await withApprovals();
    const record = vi.fn(async () => undefined);
    await decideApprovalForActor(hq, permissions, { record }, store, async () => undefined, head.id, { status: "rejected" }, NOW);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "workflow.approval.reject" }));
  });

  it("a territory owner cannot decide an HQ approval for their own territory", async () => {
    const { store, head } = await withApprovals();
    const schedule = vi.fn(async () => undefined);
    await expect(decideApprovalForActor(owner, permissions, { record: async () => undefined }, store, schedule, head.id, { status: "approved" })).rejects.toBeInstanceOf(JobAccessError);
    expect(schedule).not.toHaveBeenCalled();
    expect((await store.getApprovalById(head.id))!.status).toBe("pending");
  });
});

describe("runs and notifications", () => {
  it("scopes runs and run detail by territory", async () => {
    const store = createInMemoryEngineStore();
    const mk = (territoryId: string) => store.createRun({ definitionId: "d", versionId: "v", eventId: territoryId, organisationId: null, territoryId, subjectType: null, subjectId: null, context: {} }, NOW);
    const mine = (await mk("sutton")).run;
    const theirs = (await mk("solihull")).run;
    expect((await listRunsForActor(owner, permissions, store)).map((run) => run.id)).toEqual([mine.id]);
    expect(await listRunsForActor(hq, permissions, store)).toHaveLength(2);
    expect((await getRunForActor(owner, permissions, store, mine.id)).run.id).toBe(mine.id);
    await expect(getRunForActor(owner, permissions, store, theirs.id)).rejects.toThrow("Workflow run not found.");
  });

  it("territory users see only their territory's team notifications", async () => {
    const store = createInMemoryEngineStore();
    const mk = (key: string, recipientScope: "territory" | "hq", territoryId: string) =>
      store.createNotification({ recipientScope, organisationId: null, territoryId, title: key, idempotencyKey: key }, NOW);
    await mk("mine", "territory", "sutton");
    await mk("hq-only", "hq", "sutton");
    await mk("other", "territory", "solihull");
    expect((await listNotificationsForActor(owner, permissions, store)).map((note) => note.title)).toEqual(["mine"]);
    expect(await listNotificationsForActor(hq, permissions, store)).toHaveLength(3);
  });
});
