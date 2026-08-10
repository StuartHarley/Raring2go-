import type {
  PermissionConstraints,
  PermissionDecision,
  PermissionRequest
} from "./types";

const allowedKeys = new Set([
  "allowedTerritoryIds",
  "deniedTerritoryIds",
  "ownerUserId",
  "requireResourceOwner",
  "visibleFields"
]);

export function parseConstraints(value: unknown):
  | { ok: true; constraints: PermissionConstraints }
  | { ok: false; decision: PermissionDecision } {
  if (value === undefined || value === null) {
    return { ok: true, constraints: {} };
  }

  if (!isPlainObject(value)) {
    return malformed();
  }

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      return malformed();
    }
  }

  const constraints = value as PermissionConstraints;

  if (
    (constraints.allowedTerritoryIds &&
      !isStringArray(constraints.allowedTerritoryIds)) ||
    (constraints.deniedTerritoryIds &&
      !isStringArray(constraints.deniedTerritoryIds)) ||
    (constraints.ownerUserId && typeof constraints.ownerUserId !== "string") ||
    (constraints.requireResourceOwner !== undefined &&
      constraints.requireResourceOwner !== true) ||
    (constraints.visibleFields && !isStringArray(constraints.visibleFields))
  ) {
    return malformed();
  }

  return { ok: true, constraints };
}

export function evaluateConstraints(
  constraints: PermissionConstraints,
  request: PermissionRequest
): PermissionDecision | undefined {
  const territoryId = request.context?.territoryId ?? request.resource?.territoryId;

  if (
    constraints.allowedTerritoryIds &&
    (!territoryId || !constraints.allowedTerritoryIds.includes(territoryId))
  ) {
    return deny("constraint_failed", "Requested territory is not allowed by constraints.");
  }

  if (
    constraints.deniedTerritoryIds &&
    territoryId &&
    constraints.deniedTerritoryIds.includes(territoryId)
  ) {
    return deny("constraint_failed", "Requested territory is denied by constraints.");
  }

  const resourceOwner =
    request.resource?.ownerUserId ?? request.context?.resourceOwnerUserId;

  if (constraints.ownerUserId && constraints.ownerUserId !== resourceOwner) {
    return deny("constraint_failed", "Requested resource owner is not allowed.");
  }

  if (constraints.requireResourceOwner && resourceOwner !== request.userId) {
    return deny("constraint_failed", "Requested resource is not owned by the user.");
  }

  return undefined;
}

function malformed() {
  return {
    ok: false as const,
    decision: deny("malformed_constraints", "Permission constraints are malformed.")
  };
}

function deny(
  reason: PermissionDecision["reason"],
  explanation: string
): PermissionDecision {
  return {
    allowed: false,
    reason,
    explanation
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
