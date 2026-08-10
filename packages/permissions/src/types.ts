export type PermissionScope =
  | "public"
  | "own_record"
  | "own_organisation"
  | "organisation"
  | "own_territory"
  | "territory"
  | "selected_territories"
  | "network"
  | "system";

export type PermissionRequest = {
  userId: string;
  module: string;
  action: string;
  context?: {
    organisationId?: string;
    territoryId?: string;
    resourceOwnerUserId?: string;
  };
  resource?: {
    ownerUserId?: string;
    organisationId?: string;
    territoryId?: string;
    fields?: string[];
  };
  now?: Date;
};

export type Permission = {
  id: string;
  module: string;
  action: string;
};

export type RolePermissionGrant = {
  roleId: string;
  permission: Permission;
  scope: string;
  constraints?: unknown;
};

export type RoleAssignment = {
  id: string;
  userId: string;
  roleId: string;
  organisationId?: string | null;
  territoryId?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export type DelegationGrant = {
  id: string;
  fromUserId: string;
  toUserId: string;
  organisationId?: string | null;
  territoryId?: string | null;
  startsAt: Date;
  endsAt: Date;
};

export type TerritoryRecord = {
  id: string;
  franchiseOrganisationId?: string | null;
  status?: string;
};

export type PermissionData = {
  roleAssignments: RoleAssignment[];
  rolePermissions: RolePermissionGrant[];
  delegations?: DelegationGrant[];
  territories?: TerritoryRecord[];
};

export type PermissionConstraints = {
  allowedTerritoryIds?: string[];
  deniedTerritoryIds?: string[];
  ownerUserId?: string;
  requireResourceOwner?: true;
  visibleFields?: string[];
};

export type PermissionDecisionReason =
  | "granted"
  | "default_deny"
  | "no_matching_permission"
  | "unknown_scope"
  | "malformed_constraints"
  | "missing_context"
  | "scope_mismatch"
  | "territory_organisation_mismatch"
  | "assignment_expired"
  | "constraint_failed";

export type PermissionDecision = {
  allowed: boolean;
  reason: PermissionDecisionReason;
  explanation: string;
  matchedGrant?: {
    assignmentId: string;
    roleId: string;
    scope: PermissionScope;
    permissionId: string;
  };
  visibleFields?: string[];
};

export class PermissionDeniedError extends Error {
  readonly decision: PermissionDecision;

  constructor(decision: PermissionDecision) {
    super(decision.explanation);
    this.name = "PermissionDeniedError";
    this.decision = decision;
  }
}
