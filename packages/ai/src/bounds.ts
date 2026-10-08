import { redactSensitiveData } from "@raring2go/audit";

const MAX_STRING = 2_000;
const MAX_ITEMS = 50;
const MAX_DEPTH = 4;

/**
 * Makes a structured input safe to store: secrets redacted by key name, long text
 * truncated, lists/objects and nesting bounded. The stored value is a record of what
 * was asked, not a copy of everything that was in scope.
 */
export function boundForStorage(value: Record<string, unknown>): Record<string, unknown> {
  return bound(redactSensitiveData(value), 0) as Record<string, unknown>;
}

function bound(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value)) {
    return depth >= MAX_DEPTH ? [] : value.slice(0, MAX_ITEMS).map((item) => bound(item, depth + 1));
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (depth >= MAX_DEPTH) return {};
    return Object.fromEntries(Object.entries(value).slice(0, MAX_ITEMS).map(([key, item]) => [key, bound(item, depth + 1)]));
  }
  return value;
}
