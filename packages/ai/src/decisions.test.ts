import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it, vi } from "vitest";
import { AiRunAccessError, AiRunStateError, decideAiRun, getAiRunForActor, listAiRunsForActor, markAiRunApplied } from "./decisions";
import { createInMemoryAiRunStore } from "./runs";
import type { NewAiRun } from "./runs";

const grant = (roleId: string, action: string, scope: string) => ({ roleId, permission: { id: `ai.${action}`, module: "ai.run", action }, scope });
const permissions: PermissionData = {
  roleAssignments: [
    { id: "a1", userId: "hq", roleId: "hq" },
    { id: "a2", userId: "sutton", roleId: "owner", territoryId: "sutton" },
    { id: "a3", userId: "viewer", roleId: "viewer" }
  ],
  rolePermissions: [grant("hq", "view", "network"), grant("hq", "decide", "network"), grant("owner", "view", "own_territory"), grant("owner", "decide", "own_territory")]
};
const hq = { userId: "hq" };
const owner = { userId: "sutton", territoryId: "sutton" };
const NOW = new Date("2026-03-01T00:00:00Z");

const base: NewAiRun = {
  taskKey: "content.draft", purpose: "Draft", promptVersion: "v1", providerKey: "anthropic", modelReference: "m", status: "succeeded", risk: "low",
  approvalState: "pending", actorType: "human", actorUserId: "someone", organisationId: null, territoryId: "sutton", subjectType: null, subjectId: null,
  sourceRefs: [], input: {}, output: { text: "x" }, inputTokens: 0, outputTokens: 0, estimatedCostMinor: 0, latencyMs: 1, error: null
};

async function seed(overrides: Partial<NewAiRun> = {}) {
  const store = createInMemoryAiRunStore();
  const run = await store.insert({ ...base, ...overrides }, NOW);
  return { store, run };
}

describe("visibility", () => {
  it("territory users see only their territory's runs; HQ sees all; strangers nothing", async () => {
    const store = createInMemoryAiRunStore();
    const mine = await store.insert({ ...base, territoryId: "sutton" }, NOW);
    await store.insert({ ...base, territoryId: "solihull" }, NOW);
    await store.insert({ ...base, territoryId: null }, NOW);
    expect((await listAiRunsForActor(owner, permissions, store)).map((r) => r.id)).toEqual([mine.id]);
    expect(await listAiRunsForActor(hq, permissions, store)).toHaveLength(3);
    expect(await listAiRunsForActor(owner, permissions, store, { territoryId: "solihull" })).toEqual([]);
    await expect(listAiRunsForActor({ userId: "viewer" }, permissions, store)).rejects.toBeInstanceOf(AiRunAccessError);
  });

  it("another territory's run is indistinguishable from a missing one", async () => {
    const { store, run } = await seed({ territoryId: "solihull" });
    await expect(getAiRunForActor(owner, permissions, store, run.id)).rejects.toThrow("AI run not found.");
    await expect(getAiRunForActor(owner, permissions, store, "nope")).rejects.toThrow("AI run not found.");
  });
});

describe("decideAiRun", () => {
  it("approves a pending run once, records who, and audits it", async () => {
    const { store, run } = await seed();
    const record = vi.fn(async () => undefined);
    const decided = await decideAiRun(owner, permissions, { record }, store, run.id, { state: "approved", note: " fine " }, NOW);
    expect(decided).toMatchObject({ approvalState: "approved", decidedByUserId: "sutton", decisionNote: "fine" });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.approve", before: { approvalState: "pending" }, after: { approvalState: "approved" } }));
    await expect(decideAiRun(owner, permissions, { record }, store, run.id, { state: "rejected" })).rejects.toBeInstanceOf(AiRunStateError);
  });

  it("records a rejection under its own audit action", async () => {
    const { store, run } = await seed();
    const record = vi.fn(async () => undefined);
    await decideAiRun(hq, permissions, { record }, store, run.id, { state: "rejected" }, NOW);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.reject" }));
  });

  it("requires four-eyes for high-risk output but allows self-approval of low-risk suggestions", async () => {
    const risky = await seed({ risk: "high", actorUserId: "hq" });
    await expect(decideAiRun(hq, permissions, { record: async () => undefined }, risky.store, risky.run.id, { state: "approved" })).rejects.toThrow(/someone other than the person who requested/);
    expect((await risky.store.get(risky.run.id))!.approvalState).toBe("pending");

    const low = await seed({ risk: "low", actorUserId: "hq" });
    await expect(decideAiRun(hq, permissions, { record: async () => undefined }, low.store, low.run.id, { state: "approved" }, NOW)).resolves.toMatchObject({ approvalState: "approved" });
  });

  it("denies cross-territory and unauthorised decisions, and failed runs cannot be decided", async () => {
    const other = await seed({ territoryId: "solihull" });
    await expect(decideAiRun(owner, permissions, { record: async () => undefined }, other.store, other.run.id, { state: "approved" })).rejects.toBeInstanceOf(AiRunAccessError);
    const failed = await seed({ status: "failed", approvalState: "not_required" });
    await expect(decideAiRun(hq, permissions, { record: async () => undefined }, failed.store, failed.run.id, { state: "approved" })).rejects.toThrow(/failed run/);
  });
});

describe("markAiRunApplied", () => {
  it("only applies approved or not-required output, once", async () => {
    const pending = await seed();
    const record = vi.fn(async () => undefined);
    await expect(markAiRunApplied(hq, permissions, { record }, pending.store, pending.run.id)).rejects.toThrow(/not been approved/);

    await decideAiRun(hq, permissions, { record }, pending.store, pending.run.id, { state: "approved" }, NOW);
    expect((await markAiRunApplied(hq, permissions, { record }, pending.store, pending.run.id, NOW)).appliedAt).toEqual(NOW);
    await expect(markAiRunApplied(hq, permissions, { record }, pending.store, pending.run.id)).rejects.toThrow(/already been applied/);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.apply" }));

    const rejected = await seed({ approvalState: "rejected" });
    await expect(markAiRunApplied(hq, permissions, { record }, rejected.store, rejected.run.id)).rejects.toThrow(/rejected/);
    const info = await seed({ approvalState: "not_required" });
    await expect(markAiRunApplied(hq, permissions, { record }, info.store, info.run.id, NOW)).resolves.toMatchObject({ appliedAt: NOW });
  });
});
