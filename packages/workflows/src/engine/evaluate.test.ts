import { describe, expect, it } from "vitest";
import { evaluateCondition, evaluateConditions, isValidContextPath, lookupPath, renderTemplate, resolveNumber } from "./evaluate";
import type { EvaluationContext } from "./types";

const context: EvaluationContext = {
  event: {
    type: "finance.invoice.overdue",
    subjectType: "advertiser_invoice",
    subjectId: "inv-1",
    actorUserId: null,
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { invoiceNumber: "INV-7", balanceMinor: 12_500, status: "issued", tags: ["a", "b"], nested: { deep: 1 } }
  },
  scope: { organisationId: "org-1", territoryId: "t-1" },
  settings: { firstReminderDays: 3, label: "x" }
};

describe("lookupPath", () => {
  it("reads nested own properties", () => {
    expect(lookupPath(context, "event.payload.nested.deep")).toBe(1);
  });

  it("refuses prototype and inherited access", () => {
    expect(lookupPath(context, "event.__proto__")).toBeUndefined();
    expect(lookupPath(context, "event.payload.constructor")).toBeUndefined();
    expect(lookupPath(context, "event.payload.toString")).toBeUndefined();
    expect(lookupPath({}, "constructor.prototype")).toBeUndefined();
  });

  it("returns undefined through non-objects", () => {
    expect(lookupPath(context, "event.payload.invoiceNumber.length")).toBeUndefined();
  });
});

describe("isValidContextPath", () => {
  it("only allows known roots with at least one segment", () => {
    expect(isValidContextPath("event.type")).toBe(true);
    expect(isValidContextPath("settings.firstReminderDays")).toBe(true);
    expect(isValidContextPath("process.env.SECRET")).toBe(false);
    expect(isValidContextPath("event")).toBe(false);
    expect(isValidContextPath("event.__proto__.x")).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("substitutes known paths", () => {
    expect(renderTemplate("Invoice {{event.payload.invoiceNumber}} owes {{ event.payload.balanceMinor }}", context)).toBe("Invoice INV-7 owes 12500");
  });

  it("renders missing values and unknown roots as empty text, never 'undefined'", () => {
    expect(renderTemplate("[{{event.payload.nope}}][{{process.env.SECRET}}]", context)).toBe("[][]");
  });

  it("serialises objects", () => {
    expect(renderTemplate("{{event.payload.nested}}", context)).toBe('{"deep":1}');
  });
});

describe("resolveNumber", () => {
  it("resolves literals and settings, and ignores non-numeric settings", () => {
    expect(resolveNumber(5, context.settings)).toBe(5);
    expect(resolveNumber({ setting: "firstReminderDays" }, context.settings)).toBe(3);
    expect(resolveNumber({ setting: "label" }, context.settings)).toBeUndefined();
    expect(resolveNumber({ setting: "missing" }, context.settings)).toBeUndefined();
    expect(resolveNumber(undefined, context.settings)).toBeUndefined();
  });
});

describe("conditions", () => {
  it("evaluates each operator", () => {
    const check = (field: string, op: Parameters<typeof evaluateCondition>[0]["op"], value?: unknown) => evaluateCondition({ field, op, value }, context);
    expect(check("event.payload.status", "eq", "issued")).toBe(true);
    expect(check("event.payload.status", "neq", "paid")).toBe(true);
    expect(check("event.payload.balanceMinor", "gt", 10_000)).toBe(true);
    expect(check("event.payload.balanceMinor", "gte", 12_500)).toBe(true);
    expect(check("event.payload.balanceMinor", "lt", 12_500)).toBe(false);
    expect(check("event.payload.balanceMinor", "lte", 12_500)).toBe(true);
    expect(check("event.payload.status", "in", ["issued", "part_paid"])).toBe(true);
    expect(check("event.payload.tags", "contains", "a")).toBe(true);
    expect(check("event.payload.invoiceNumber", "contains", "INV")).toBe(true);
    expect(check("event.payload.invoiceNumber", "exists")).toBe(true);
    expect(check("event.payload.nope", "exists")).toBe(false);
  });

  it("fails closed on type mismatches and invalid paths", () => {
    expect(evaluateCondition({ field: "event.payload.status", op: "gt", value: 1 }, context)).toBe(false);
    expect(evaluateCondition({ field: "process.env.X", op: "exists" }, context)).toBe(false);
    expect(evaluateCondition({ field: "event.payload.status", op: "in", value: "issued" }, context)).toBe(false);
  });

  it("ANDs conditions and matches when there are none", () => {
    expect(evaluateConditions([], context)).toBe(true);
    expect(evaluateConditions([{ field: "event.payload.status", op: "eq", value: "issued" }, { field: "event.payload.balanceMinor", op: "gt", value: 99_999 }], context)).toBe(false);
  });
});
