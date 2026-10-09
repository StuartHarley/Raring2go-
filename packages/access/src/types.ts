export type RoleSummary = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  /** A franchisee may give this role to their own team. */
  franchiseDelegable: boolean;
  grantCount: number;
  assignmentCount: number;
};

export type GrantRow = { permissionId: string; module: string; action: string; scope: string; description: string | null };

export type RoleDetail = RoleSummary & { grants: GrantRow[] };

export type PermissionEntry = { id: string; module: string; action: string; description: string | null };

export type AssignmentRow = {
  id: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  userStatus: string;
  roleId: string;
  roleName: string;
  organisationId: string | null;
  organisationName: string | null;
  territoryId: string | null;
  territoryName: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
};

export type InvitationRow = {
  id: string;
  email: string;
  organisationId: string;
  organisationName: string | null;
  territoryId: string | null;
  territoryName: string | null;
  roleId: string | null;
  roleName: string | null;
  status: string;
  expiresAt: Date;
  createdAt: Date;
};

export type NewInvitation = {
  email: string;
  organisationId: string;
  territoryId: string | null;
  roleId: string | null;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
};

export type OrganisationOption = { id: string; name: string; territories: Array<{ id: string; name: string }> };

/**
 * What the access service needs from storage. A whole service call runs inside one transaction
 * (the runtime wraps it), so a change that violates an invariant is rolled back, not half-applied.
 */
export type AccessStore = {
  listRoles(): Promise<RoleSummary[]>;
  getRole(roleId: string): Promise<RoleDetail | undefined>;
  listPermissions(): Promise<PermissionEntry[]>;
  listAssignments(): Promise<AssignmentRow[]>;
  getAssignment(assignmentId: string): Promise<AssignmentRow | undefined>;
  listInvitations(): Promise<InvitationRow[]>;
  getInvitation(invitationId: string): Promise<InvitationRow | undefined>;
  listOrganisations(): Promise<OrganisationOption[]>;

  /** Roles flagged as something a franchisee may give to their own team. */
  listDelegableRoles(): Promise<RoleSummary[]>;
  /** Live assignments of the given roles at exactly this organisation and territory. */
  listTeamAssignments(input: { organisationId: string; territoryId: string; roleIds: string[] }, now: Date): Promise<AssignmentRow[]>;
  /** Pending, unexpired invitations for the given roles at exactly this organisation and territory. */
  listTeamInvitations(input: { organisationId: string; territoryId: string; roleIds: string[] }, now: Date): Promise<InvitationRow[]>;

  roleKeyExists(key: string): Promise<boolean>;
  insertRole(input: { key: string; name: string; description: string | null }): Promise<RoleDetail>;
  softDeleteRole(roleId: string, now: Date): Promise<void>;
  roleHasLiveAssignments(roleId: string, now: Date): Promise<boolean>;
  addGrant(roleId: string, permissionId: string, scope: string): Promise<boolean>;
  removeGrant(roleId: string, permissionId: string, scope: string): Promise<boolean>;

  userIsActiveMember(userId: string, organisationId: string): Promise<boolean>;
  territoryBelongsTo(territoryId: string, organisationId: string): Promise<boolean>;
  hasLiveAssignment(input: { userId: string; roleId: string; organisationId: string | null; territoryId: string | null }, now: Date): Promise<boolean>;
  insertAssignment(input: { userId: string; roleId: string; organisationId: string | null; territoryId: string | null; endsAt: Date | null }): Promise<AssignmentRow>;
  endAssignment(assignmentId: string, now: Date): Promise<void>;
  disabledUserIds(): Promise<Set<string>>;

  revokePendingInvitations(input: { email: string; organisationId: string; territoryId: string | null; roleId: string | null }, now: Date): Promise<number>;
  insertInvitation(input: NewInvitation): Promise<InvitationRow>;
  revokeInvitation(invitationId: string, now: Date): Promise<boolean>;

  /** Current access-control data as the evaluator reads it, including this transaction's own changes. */
  loadPermissionData(): Promise<import("@raring2go/permissions").PermissionData>;
};
