import { evaluatePermission } from "./evaluate";
import type { PermissionData, PermissionRequest } from "./types";

export function canShow(request: PermissionRequest, data: PermissionData) {
  return evaluatePermission(request, data).allowed;
}

export function getPermissionSummary(
  request: PermissionRequest,
  data: PermissionData
) {
  return evaluatePermission(request, data);
}
