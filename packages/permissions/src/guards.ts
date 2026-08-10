import { evaluatePermission } from "./evaluate";
import type { PermissionData, PermissionRequest } from "./types";
import { PermissionDeniedError } from "./types";

export function requirePermission(
  request: PermissionRequest,
  data: PermissionData
) {
  const decision = evaluatePermission(request, data);

  if (!decision.allowed) {
    throw new PermissionDeniedError(decision);
  }

  return decision;
}
