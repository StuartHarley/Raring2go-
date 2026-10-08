import { describe, expect, it } from "vitest";
import { MAX_STEPS, validateWorkflowVersion } from "./validate";

const hooks = { actions: new Set(["franchise.start_onboarding"]), guards: new Set(["invoice.still_unpaid"]) };

const valid = {
  triggerEvent: "finance.invoice.overdue",
  settings: { firstReminderDays: 3 },
  conditions: [{ field: "event.payload.balanceMinor", op: "gt", value: 0 }],
  steps: [
    { type: "create_task", title: "Chase {{event.payload.invoiceNumber}}", assignee: "territory", dueInDays: { setting: "firstReminderDays" } },
    { type: "wait", days: { setting: "firstReminderDays" } },
    { type: "guard", check: "invoice.still_unpaid" },
    { type: "notify", audience: "hq", title: "Escalated" },
    { type: "request_approval", approver: "hq", title: "Write off?", expiresInDays: 7 },
    { type: "run_action", action: "franchise.start_onboarding" }
  ]
};

const errorsFor = (input: unknown) => {
  const result = validateWorkflowVersion(input, hooks);
  return result.ok ? [] : result.errors;
};

describe("validateWorkflowVersion", () => {
  it("accepts a well-formed version", () => {
    const result = validateWorkflowVersion(valid, hooks);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.steps).toHaveLength(6);
  });

  it("reports every problem at once", () => {
    const errors = errorsFor({ triggerEvent: "Bad Event", steps: [{ type: "nope" }, { type: "notify", audience: "everyone" }] });
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.join(" ")).toMatch(/Trigger event/);
    expect(errors.join(" ")).toMatch(/unknown step type/);
  });

  it("requires at least one step and caps the maximum", () => {
    expect(errorsFor({ triggerEvent: "a.b", steps: [] }).join(" ")).toMatch(/at least one step/);
    const many = Array.from({ length: MAX_STEPS + 1 }, () => ({ type: "notify", audience: "hq", title: "x" }));
    expect(errorsFor({ triggerEvent: "a.b", steps: many }).join(" ")).toMatch(/at most/);
  });

  it("rejects setting references that do not resolve to a bounded number", () => {
    expect(errorsFor({ ...valid, settings: {} }).join(" ")).toMatch(/setting "firstReminderDays"/);
    expect(errorsFor({ ...valid, settings: { firstReminderDays: 9999 } }).join(" ")).toMatch(/between 0 and 365/);
  });

  it("rejects unknown guards/actions only when hooks are supplied", () => {
    const step = { triggerEvent: "a.b", steps: [{ type: "run_action", action: "evil.thing" }] };
    expect(errorsFor(step).join(" ")).toMatch(/unknown action/);
    expect(validateWorkflowVersion(step).ok).toBe(true);
  });

  it("rejects templates that reach outside the allowed roots", () => {
    const errors = errorsFor({ triggerEvent: "a.b", steps: [{ type: "notify", audience: "hq", title: "{{process.env.SECRET}}" }] });
    expect(errors.join(" ")).toMatch(/placeholder/);
  });

  it("rejects malformed conditions", () => {
    expect(errorsFor({ ...valid, conditions: [{ field: "nope", op: "eq", value: 1 }] }).join(" ")).toMatch(/field must be a path/);
    expect(errorsFor({ ...valid, conditions: [{ field: "event.type", op: "gt", value: "x" }] }).join(" ")).toMatch(/needs a number/);
    expect(errorsFor({ ...valid, conditions: [{ field: "event.type", op: "in", value: "x" }] }).join(" ")).toMatch(/list/);
  });

  it("never throws on garbage input", () => {
    for (const garbage of [null, undefined, 5, "x", [], { steps: "no" }]) {
      expect(() => validateWorkflowVersion(garbage as unknown)).not.toThrow();
    }
  });
});
