import type { EvaluationContext, NumberRef, WorkflowCondition, WorkflowSettings } from "./types";

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const ROOTS = new Set(["event", "scope", "settings"]);
export const templatePattern = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Safe dotted-path lookup: own properties only, no prototype access. */
export function lookupPath(source: unknown, path: string): unknown {
  let current: unknown = source;

  for (const segment of path.split(".")) {
    if (FORBIDDEN_SEGMENTS.has(segment) || current == null || typeof current !== "object") {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export function isValidContextPath(path: string) {
  const [root, ...rest] = path.split(".");
  return ROOTS.has(root ?? "") && rest.length > 0 && rest.every((segment) => segment.length > 0 && !FORBIDDEN_SEGMENTS.has(segment));
}

/** `{{event.payload.title}}` -> value; missing values render as an empty string, never "undefined". */
export function renderTemplate(template: string, context: EvaluationContext): string {
  return template.replace(templatePattern, (_match, path: string) => {
    const value = isValidContextPath(path) ? lookupPath(context, path) : undefined;
    if (value == null) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

export function resolveNumber(ref: NumberRef | undefined, settings: WorkflowSettings): number | undefined {
  if (ref === undefined) return undefined;
  if (typeof ref === "number") return ref;
  const value = settings[ref.setting];
  return typeof value === "number" ? value : undefined;
}

export function evaluateCondition(condition: WorkflowCondition, context: EvaluationContext): boolean {
  const actual = isValidContextPath(condition.field) ? lookupPath(context, condition.field) : undefined;
  const expected = condition.value;

  switch (condition.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof expected !== "number") return false;
      return condition.op === "gt" ? actual > expected : condition.op === "gte" ? actual >= expected : condition.op === "lt" ? actual < expected : actual <= expected;
    }
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "contains":
      return typeof actual === "string" && typeof expected === "string"
        ? actual.includes(expected)
        : Array.isArray(actual) && actual.includes(expected);
    default:
      return false;
  }
}

/** All conditions must hold (AND). An empty list always matches. */
export function evaluateConditions(conditions: WorkflowCondition[], context: EvaluationContext): boolean {
  return conditions.every((condition) => evaluateCondition(condition, context));
}
