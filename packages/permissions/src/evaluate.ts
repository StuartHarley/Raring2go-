import { evaluateConstraints, parseConstraints } from "./constraints";
import type {
  DelegationGrant,
  PermissionData,
  PermissionDecision,
  PermissionRequest,
  PermissionScope,
  RoleAssignment,
  RolePermissionGrant
} from "./types";

const knownScopes = new Set<PermissionScope>([
  "public",
  "own_record",
  "own_organisation",
  "organisation",
  "own_territory",
  "territory",
  "selected_territories",
  "network",
  "system"
]);

export function evaluatePermission(
  request: PermissionRequest,
  data: PermissionData
): PermissionDecision {
  const now = request.now ?? new Date();
  const territoryCheck = validateTerritoryRelationship(request, data);

  if (territoryCheck) {
    return territoryCheck;
  }

  const assignments = [
    ...data.roleAssignments.filter((assignment) => assignment.userId === request.userId),
    ...delegatedAssignments(request, data.delegations ?? [], now)
  ];

  let sawModuleAction = false;
  let sawExpiredAssignment = false;

  for (const assignment of assignments) {
    if (!isActiveAssignment(assignment, now)) {
      sawExpiredAssignment = true;
      continue;
    }

    const grants = data.rolePermissions.filter(
      (grant) =>
        grant.roleId === assignment.roleId &&
        grant.permission.module === request.module &&
        grant.permission.action === request.action
    );

    if (grants.length > 0) {
      sawModuleAction = true;
    }

    for (const grant of grants) {
      const scope = grant.scope as PermissionScope;

      if (!knownScopes.has(scope)) {
        return deny("unknown_scope", "Permission scope is not recognised.");
      }

      const parsed = parseConstraints(grant.constraints);

      if (!parsed.ok) {
        return parsed.decision;
      }

      const scopeDecision = evaluateScope(scope, assignment, request);

      if (!scopeDecision.allowed) {
        continue;
      }

      const constraintDecision = evaluateConstraints(parsed.constraints, request);

      if (constraintDecision) {
        return constraintDecision;
      }

      return {
        allowed: true,
        reason: "granted",
        explanation: "Permission was granted by an active role assignment.",
        matchedGrant: {
          assignmentId: assignment.id,
          roleId: assignment.roleId,
          scope,
          permissionId: grant.permission.id
        },
        visibleFields: parsed.constraints.visibleFields
      };
    }
  }

  if (sawModuleAction) {
    return deny("scope_mismatch", "No matching permission grant applied to this scope.");
  }

  if (sawExpiredAssignment) {
    return deny("assignment_expired", "Matching role assignment is not active.");
  }

  return deny("default_deny", "No permission grant matched this request.");
}

function evaluateScope(
  scope: PermissionScope,
  assignment: RoleAssignment,
  request: PermissionRequest
): PermissionDecision {
  const organisationId =
    request.context?.organisationId ?? request.resource?.organisationId;
  const territoryId = request.context?.territoryId ?? request.resource?.territoryId;

  if (scope === "public") {
    return allow();
  }

  if (scope === "system") {
    return allow();
  }

  if (scope === "network") {
    return allow();
  }

  if (scope === "organisation" || scope === "own_organisation") {
    if (!organisationId || !assignment.organisationId) {
      return deny("missing_context", "Organisation context is required.");
    }

    return assignment.organisationId === organisationId
      ? allow()
      : deny("scope_mismatch", "Organisation scope does not match.");
  }

  if (
    scope === "territory" ||
    scope === "own_territory" ||
    scope === "selected_territories"
  ) {
    if (!territoryId || !assignment.territoryId) {
      return deny("missing_context", "Territory context is required.");
    }

    return assignment.territoryId === territoryId
      ? allow()
      : deny("scope_mismatch", "Territory scope does not match.");
  }

  if (scope === "own_record") {
    const owner = request.resource?.ownerUserId ?? request.context?.resourceOwnerUserId;
    return owner && owner === request.userId
      ? allow()
      : deny("scope_mismatch", "Resource owner does not match.");
  }

  return deny("unknown_scope", "Permission scope is not recognised.");
}

function validateTerritoryRelationship(
  request: PermissionRequest,
  data: PermissionData
): PermissionDecision | undefined {
  const organisationId =
    request.context?.organisationId ?? request.resource?.organisationId;
  const territoryId = request.context?.territoryId ?? request.resource?.territoryId;

  if (!organisationId || !territoryId) {
    return undefined;
  }

  const territory = data.territories?.find((candidate) => candidate.id === territoryId);

  if (!territory) {
    return deny("missing_context", "Requested territory could not be verified.");
  }

  if (territory.franchiseOrganisationId !== organisationId) {
    return deny(
      "territory_organisation_mismatch",
      "Requested territory is outside the organisation context."
    );
  }

  return undefined;
}

function delegatedAssignments(
  request: PermissionRequest,
  delegations: DelegationGrant[],
  now: Date
): RoleAssignment[] {
  return delegations
    .filter(
      (delegation) =>
        delegation.toUserId === request.userId &&
        delegation.startsAt <= now &&
        delegation.endsAt > now
    )
    .map((delegation) => ({
      id: `delegation:${delegation.id}`,
      userId: delegation.toUserId,
      roleId: `delegated:${delegation.fromUserId}`,
      organisationId: delegation.organisationId,
      territoryId: delegation.territoryId,
      startsAt: delegation.startsAt,
      endsAt: delegation.endsAt
    }));
}

function isActiveAssignment(assignment: RoleAssignment, now: Date) {
  return (
    (!assignment.startsAt || assignment.startsAt <= now) &&
    (!assignment.endsAt || assignment.endsAt > now)
  );
}

function allow(): PermissionDecision {
  return {
    allowed: true,
    reason: "granted",
    explanation: "Scope matched."
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
