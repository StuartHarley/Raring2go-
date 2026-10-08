import { describe, expect, it } from "vitest";
import { builtinWorkflows, ensureBuiltinWorkflows } from "./builtin";
import { createInMemoryEngineStore } from "./memory-store";
import { validateWorkflowVersion } from "./validate";

const hooks = { actions: new Set(["franchise.start_onboarding"]), guards: new Set(["invoice.still_unpaid"]) };
const now = new Date("2026-03-01T00:00:00Z");

describe("built-in workflows", () => {
  it("cover the four required lifecycle triggers and all validate", () => {
    expect(builtinWorkflows.map((workflow) => workflow.triggerEvent).sort()).toEqual([
      "advertiser.booking.confirm",
      "finance.invoice.overdue",
      "franchise.agreement.executed",
      "marketing.email.campaign.approve"
    ]);
    for (const workflow of builtinWorkflows) {
      expect(validateWorkflowVersion(workflow, hooks)).toMatchObject({ ok: true });
    }
  });

  it("installs once as active v1 and never overwrites administrator changes", async () => {
    const store = createInMemoryEngineStore();
    expect(await ensureBuiltinWorkflows(store, hooks, now)).toHaveLength(4);
    expect(await store.listActiveWorkflows()).toHaveLength(4);

    const definition = (await store.getDefinitionByKey("finance.invoice_overdue"))!;
    const [v1] = await store.listVersions(definition.id);
    const draft = await store.createVersion(definition.id, { triggerEvent: v1!.triggerEvent, conditions: v1!.conditions, steps: v1!.steps, settings: { ...v1!.settings, escalateAfterDays: 10 } }, "admin", now);
    await store.activateVersion(draft.id, "admin", now);

    expect(await ensureBuiltinWorkflows(store, hooks, now)).toEqual([]);
    const active = (await store.listActiveWorkflows()).find((workflow) => workflow.definition.key === "finance.invoice_overdue")!;
    expect(active.version.settings.escalateAfterDays).toBe(10);
    expect(active.version.versionNumber).toBe(2);
  });

  it("fails loudly if a built-in references a hook that does not exist", async () => {
    await expect(ensureBuiltinWorkflows(createInMemoryEngineStore(), { actions: new Set(), guards: new Set() }, now)).rejects.toThrow(/invalid/);
  });
});
