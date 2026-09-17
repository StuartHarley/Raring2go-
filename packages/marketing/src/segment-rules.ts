import type { AudienceContactView } from "./types";

export type SegmentRuleField = "territoryId" | "subscriptionStatus" | "tag" | "consentType" | "interest" | "activityWithinDays";
export type SegmentRuleOperator = "equals" | "not_equals" | "in" | "not_in" | "contains" | "is_set" | "is_not_set";

export type SegmentRuleCondition = {
  kind: "condition";
  field: SegmentRuleField;
  operator: SegmentRuleOperator;
  value?: string | number | string[];
};

export type SegmentRuleGroup = {
  kind: "group";
  match: "all" | "any";
  children: Array<SegmentRuleCondition | SegmentRuleGroup>;
};

export type SegmentDefinition = { version: 1; root: SegmentRuleGroup };

const RULE_FIELDS = new Set<SegmentRuleField>(["territoryId", "subscriptionStatus", "tag", "consentType", "interest", "activityWithinDays"]);
const RULE_OPERATORS = new Set<SegmentRuleOperator>(["equals", "not_equals", "in", "not_in", "contains", "is_set", "is_not_set"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeGroup(value: unknown): value is SegmentRuleGroup {
  return (
    isRecord(value) &&
    value.kind === "group" &&
    (value.match === "all" || value.match === "any") &&
    Array.isArray(value.children) &&
    value.children.every((child) => looksLikeGroup(child) || looksLikeCondition(child))
  );
}

export function looksLikeCondition(value: unknown): value is SegmentRuleCondition {
  return (
    isRecord(value) &&
    value.kind === "condition" &&
    typeof value.field === "string" &&
    RULE_FIELDS.has(value.field as SegmentRuleField) &&
    typeof value.operator === "string" &&
    RULE_OPERATORS.has(value.operator as SegmentRuleOperator)
  );
}

/**
 * Upgrades every segment `definition` shape found in the database to the
 * nested-rule-group form. The only shape that ever existed before this phase
 * is `{ territoryId?: string }` — an implicit "subscribed, optionally in this
 * territory" rule that was hardcoded into the old matcher rather than being a
 * real, inspectable condition. This reproduces that exact matching behaviour
 * as an equivalent rule tree, so it's a transparent refactor for every
 * segment already in the database.
 */
export function normalizeSegmentDefinition(raw: Record<string, unknown>, fallbackTerritoryId?: string | null): SegmentRuleGroup {
  if (raw.version === 1 && looksLikeGroup((raw as { root?: unknown }).root)) {
    return (raw as { root: SegmentRuleGroup }).root;
  }

  const territoryId = typeof raw.territoryId === "string" ? raw.territoryId : (fallbackTerritoryId ?? undefined);

  if (territoryId) {
    return {
      kind: "group",
      match: "all",
      children: [{ kind: "condition", field: "territoryId", operator: "equals", value: territoryId }]
    };
  }

  return {
    kind: "group",
    match: "all",
    children: [{ kind: "condition", field: "subscriptionStatus", operator: "equals", value: "subscribed" }]
  };
}

/**
 * The real trust boundary for a rule tree arriving as untrusted client JSON
 * from the segment-builder UI. Throws on an unrecognised field, operator or
 * shape rather than silently dropping or coercing it.
 */
export function validateSegmentDefinition(raw: unknown): SegmentRuleGroup {
  if (!looksLikeGroup(raw)) {
    throw new Error("Segment rule definition is malformed.");
  }
  return raw;
}

export function evaluateSegmentRules(view: AudienceContactView, root: SegmentRuleGroup, now: Date = new Date()): boolean {
  return evaluateGroup(view, root, now);
}

function evaluateGroup(view: AudienceContactView, group: SegmentRuleGroup, now: Date): boolean {
  const results = group.children.map((child) => (child.kind === "group" ? evaluateGroup(view, child, now) : matchesCondition(view, child, now)));

  if (group.children.length === 0) {
    // Vacuous truth for AND (no restriction), vacuous falsehood for OR (nothing to match).
    return group.match === "all";
  }

  return group.match === "all" ? results.every(Boolean) : results.some(Boolean);
}

function matchesCondition(view: AudienceContactView, condition: SegmentRuleCondition, now: Date): boolean {
  switch (condition.field) {
    case "territoryId": {
      const activeTerritoryIds = view.subscriptions.filter((s) => s.status === "subscribed").map((s) => s.territoryId);
      return matchesSetField(activeTerritoryIds, condition);
    }
    case "subscriptionStatus": {
      const statuses = view.subscriptions.map((s) => s.status);
      return matchesSetField(statuses, condition);
    }
    case "tag":
      return matchesSetField(view.contact.tags, condition);
    case "interest":
      return matchesSetField(view.profile?.interests ?? [], condition);
    case "consentType":
      return matchesConsentType(view, condition);
    case "activityWithinDays":
      return matchesActivityWithinDays(view, condition, now);
  }
}

function matchesSetField(values: string[], condition: SegmentRuleCondition): boolean {
  const { operator, value } = condition;

  switch (operator) {
    case "is_set":
      return values.length > 0;
    case "is_not_set":
      return values.length === 0;
    case "equals":
      return typeof value === "string" && values.includes(value);
    case "not_equals":
      return !(typeof value === "string" && values.includes(value));
    case "contains":
      return typeof value === "string" && values.some((entry) => entry.includes(value));
    case "in":
      return Array.isArray(value) && value.some((entry) => values.includes(String(entry)));
    case "not_in":
      return !(Array.isArray(value) && value.some((entry) => values.includes(String(entry))));
  }
}

function matchesConsentType(view: AudienceContactView, condition: SegmentRuleCondition): boolean {
  if (typeof condition.value !== "string") {
    return false;
  }

  const events = view.consentEvents
    .filter((event) => event.consentType === condition.value)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const latest = events[events.length - 1];
  const granted = latest?.action === "granted";

  return condition.operator === "is_not_set" || condition.operator === "not_equals" ? !granted : granted;
}

function matchesActivityWithinDays(view: AudienceContactView, condition: SegmentRuleCondition, now: Date): boolean {
  const days = Number(condition.value);

  if (!Number.isFinite(days)) {
    return false;
  }

  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const hasRecentActivity = view.activity.some((event) => new Date(event.occurredAt).getTime() >= cutoff);

  return condition.operator === "is_not_set" || condition.operator === "not_equals" ? !hasRecentActivity : hasRecentActivity;
}
