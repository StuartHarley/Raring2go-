import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it, vi } from "vitest";
import { JobAccessError, JobStateError } from "../service";
import { activateDraftVersion, createDraftVersion, setWorkflowEnabled, testDraftVersion, updateDraftVersion, WorkflowValidationError } from "./admin";
import { builtinWorkflows, ensureBuiltinWorkflows } from "./builtin";
import { dispatchPendingEvents } from "./dispatch";
import type { EngineHooks } from "./executor";
import { createInMemoryEngineStore } from "./memory-store";

const NOW = new Date("2026-03-01T00:00:00Z");
const grant = (roleId: string, action: string, scope: string) => ({ roleId, permission: { id: `w.${action}`, module: "automation.workflow", action }, scope });
const permissions: PermissionData = {
  roleAssignments: [
    { id: "a1", userId: "admin", roleId: "admin" },
    { id: "a2", userId: "editor", roleId: "editor" },
    { id: "a3", userId: "owner", roleId: "owner", territoryId: "sutton" }
  ],
  rolePermissions: [
    ...["view", "manage", "activate", "test"].map((action) => grant("admin", action, "network")),
    grant("editor", "view", "network"),
    grant("editor", "manage", "network"),
    grant("owner", "view", "own_territory"),
    grant("owner", "manage", "own_territory")
  ]
};
const admin = { userId: "admin" };
const editor = { userId: "editor" };
const owner = { userId: "owner", territoryId: "sutton" };

const guard = vi.fn(async () => true);
const startOnboarding = vi.fn(async () => ({}));
const hooks: EngineHooks = { actions: { "franchise.start_onboarding": startOnboarding }, guards: { "invoice.still_unpaid": guard } };
const known = { actions: new Set(Object.keys(hooks.actions)), guards: new Set(Object.keys(hooks.guards)) };
const noAudit = { record: async () => undefined };

async function seed() {
  const store = createInMemoryEngineStore();
  await ensureBuiltinWorkflows(store, known, NOW);
  const overdue = (await store.getDefinitionByKey("finance.invoice_overdue"))!;
  return { store, overdue };
}

describe("drafts", () => {
  it("copies the newest version into a single draft and audits it", async () => {
    const { store, overdue } = await seed();
    const record = vi.fn(async () => undefined);
    const draft = await createDraftVersion(admin, permissions, { record }, store, overdue.id, NOW);
    expect(draft).toMatchObject({ status: "draft", versionNumber: 2 });
    expect(draft.settings.escalateAfterDays).toBe(7);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "workflow.version.create" }));
    await expect(createDraftVersion(admin, permissions, noAudit, store, overdue.id)).rejects.toBeInstanceOf(JobStateError);
  });

  it("saves a valid edit with a before/after audit and rejects invalid ones without saving anything", async () => {
    const { store, overdue } = await seed();
    const draft = await createDraftVersion(admin, permissions, noAudit, store, overdue.id, NOW);
    const base = { triggerEvent: draft.triggerEvent, conditions: draft.conditions, steps: draft.steps };

    const record = vi.fn(async () => undefined);
    const saved = await updateDraftVersion(admin, permissions, { record }, store, known, draft.id, { ...base, settings: { ...draft.settings, escalateAfterDays: 10 } }, "  slower escalation ", NOW);
    expect(saved.settings.escalateAfterDays).toBe(10);
    expect(saved.changeNote).toBe("slower escalation");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "workflow.version.update", before: expect.objectContaining({ settings: expect.objectContaining({ escalateAfterDays: 7 }) }), after: expect.objectContaining({ settings: expect.objectContaining({ escalateAfterDays: 10 }) }) }));

    await expect(updateDraftVersion(admin, permissions, noAudit, store, known, draft.id, { ...base, settings: { ...draft.settings, escalateAfterDays: 9999 } }, null)).rejects.toBeInstanceOf(WorkflowValidationError);
    await expect(updateDraftVersion(admin, permissions, noAudit, store, known, draft.id, { ...base, steps: [{ type: "run_action", action: "evil.thing" }], settings: {} }, null)).rejects.toThrow(/unknown action/);
    expect((await store.getVersion(draft.id))!.settings.escalateAfterDays).toBe(10);
  });

  it("never edits an active or retired version", async () => {
    const { store, overdue } = await seed();
    const [active] = await store.listVersions(overdue.id);
    await expect(updateDraftVersion(admin, permissions, noAudit, store, known, active!.id, active, null)).rejects.toBeInstanceOf(JobStateError);
  });
});

describe("test runs", () => {
  it("records what would happen with no side effects, and the dispatcher never turns it into a live run", async () => {
    const { store, overdue } = await seed();
    const draft = await createDraftVersion(admin, permissions, noAudit, store, overdue.id, NOW);
    const record = vi.fn(async () => undefined);
    const result = await testDraftVersion(admin, permissions, { record }, store, hooks, draft.id, { payload: { invoiceNumber: "INV-9", customerName: "Acme", balanceMinor: 5000 }, territoryId: "sutton" }, NOW);

    expect(result.run).toMatchObject({ isTest: true, status: "completed" });
    expect(result.steps[0]!.result).toMatchObject({ dryRun: true, wouldCreateTask: { title: "Chase overdue invoice INV-9 (Acme)" } });
    expect(store.tasks.size + store.notifications.size + store.approvals.size).toBe(0);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "workflow.run.test" }));

    const schedule = vi.fn(async () => undefined);
    const dispatched = await dispatchPendingEvents(store, schedule, NOW);
    expect(dispatched.events).toBe(0);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("assumes guards pass when no sample record is given, so every step is visible, and runs them for real when one is", async () => {
    const { store, overdue } = await seed();
    const draft = await createDraftVersion(admin, permissions, noAudit, store, overdue.id, NOW);
    guard.mockClear();
    const assumed = await testDraftVersion(admin, permissions, noAudit, store, hooks, draft.id, { payload: { invoiceNumber: "X", customerName: "Y", balanceMinor: 1 } }, NOW);
    expect(assumed.steps).toHaveLength(8);
    expect(assumed.steps[2]!.result).toMatchObject({ guard: "invoice.still_unpaid", assumedPass: true });
    expect(guard).not.toHaveBeenCalled();

    guard.mockResolvedValueOnce(false);
    const real = await testDraftVersion(admin, permissions, noAudit, store, hooks, draft.id, { payload: {}, subjectId: "11111111-1111-4111-8111-111111111111" }, NOW);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(real.run.outcome).toBe("guard_stopped");
  });

  it("refuses to test a draft that no longer validates", async () => {
    const { store, overdue } = await seed();
    const draft = await createDraftVersion(admin, permissions, noAudit, store, overdue.id, NOW);
    const noHooks: EngineHooks = { actions: {}, guards: {} };
    await expect(testDraftVersion(admin, permissions, noAudit, store, noHooks, draft.id, { payload: {} }, NOW)).rejects.toBeInstanceOf(WorkflowValidationError);
  });
});

describe("activation", () => {
  it("retires the previous version, audits who/what changed, and new events use the new version", async () => {
    const { store, overdue } = await seed();
    const draft = await createDraftVersion(admin, permissions, noAudit, store, overdue.id, NOW);
    const base = { triggerEvent: draft.triggerEvent, conditions: draft.conditions, steps: draft.steps };
    await updateDraftVersion(admin, permissions, noAudit, store, known, draft.id, { ...base, settings: { ...draft.settings, firstReminderDays: 1 } }, null, NOW);

    const record = vi.fn(async () => undefined);
    const activated = await activateDraftVersion(admin, permissions, { record }, store, known, draft.id, NOW);
    expect(activated).toMatchObject({ status: "active", activatedByUserId: "admin", versionNumber: 2 });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "workflow.version.activate", before: { activeVersion: 1 }, after: expect.objectContaining({ activeVersion: 2 }) }));
    const versions = await store.listVersions(overdue.id);
    expect(versions.map((version) => [version.versionNumber, version.status])).toEqual([[2, "active"], [1, "retired"]]);
    expect((await store.listActiveWorkflows()).find((entry) => entry.definition.id === overdue.id)!.version.settings.firstReminderDays).toBe(1);
    await expect(activateDraftVersion(admin, permissions, noAudit, store, known, draft.id)).rejects.toBeInstanceOf(JobStateError);
  });

  it("re-validates at activation, so a hook removed since the draft was saved blocks it", async () => {
    const { store } = await seed();
    const signed = (await store.getDefinitionByKey("franchise.agreement_signed"))!;
    const draft = await createDraftVersion(admin, permissions, noAudit, store, signed.id, NOW);
    await expect(activateDraftVersion(admin, permissions, noAudit, store, { actions: new Set(), guards: new Set() }, draft.id)).rejects.toBeInstanceOf(WorkflowValidationError);
    expect((await store.getVersion(draft.id))!.status).toBe("draft");
  });

  it("disabling a workflow stops it matching without touching its versions", async () => {
    const { store, overdue } = await seed();
    const record = vi.fn(async () => undefined);
    await setWorkflowEnabled(admin, permissions, { record }, store, overdue.id, false, NOW);
    expect((await store.listActiveWorkflows()).some((entry) => entry.definition.id === overdue.id)).toBe(false);
    expect((await store.listVersions(overdue.id))[0]!.status).toBe("active");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "workflow.definition.toggle", before: { status: "enabled" }, after: { status: "disabled" } }));
  });
});

describe("permissions", () => {
  it("separates edit from activate/test, and keeps territory users out of definitions entirely", async () => {
    const { store, overdue } = await seed();
    const draft = await createDraftVersion(editor, permissions, noAudit, store, overdue.id, NOW);
    await expect(activateDraftVersion(editor, permissions, noAudit, store, known, draft.id)).rejects.toBeInstanceOf(JobAccessError);
    await expect(testDraftVersion(editor, permissions, noAudit, store, hooks, draft.id, { payload: {} })).rejects.toBeInstanceOf(JobAccessError);
    await expect(setWorkflowEnabled(editor, permissions, noAudit, store, overdue.id, false)).rejects.toBeInstanceOf(JobAccessError);

    // A territory-scoped manage grant is not enough: definitions are network configuration.
    await expect(updateDraftVersion(owner, permissions, noAudit, store, known, draft.id, draft, null)).rejects.toBeInstanceOf(JobAccessError);
    await expect(createDraftVersion(owner, permissions, noAudit, store, overdue.id)).rejects.toBeInstanceOf(JobAccessError);
    expect(builtinWorkflows.length).toBeGreaterThan(0);
  });
});
