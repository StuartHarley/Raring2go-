import { createHash, randomBytes } from "node:crypto";
import { auditActions } from "@raring2go/audit";
import type { RecordAuditEventInput } from "@raring2go/audit";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData, PermissionDecision } from "@raring2go/permissions";
import { assertAdministratorRemains, assertCanAssignRole, assertCanGrantScope, grantableScopes, maxScopeRank, scopeRank } from "./guards";
import type { AccessStore, AssignmentRow, InvitationRow, RoleDetail } from "./types";

export const accessCapabilities = {
  view: { module: "roles", action: "view" },
  manage: { module: "roles", action: "manage" },
  assign: { module: "roles", action: "assign" },
  invite: { module: "roles", action: "invite" }
} as const;

export type AccessActorContext = { userId: string; organisationId?: string | null; territoryId?: string | null };
export type AccessAuditRecorder = { record: (input: RecordAuditEventInput) => Promise<unknown> };

export class AccessDeniedError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export class AccessStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessStateError";
  }
}

export class AccessInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessInputError";
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_-]{2,39}$/;
const INVITATION_TTL_MS = 7 * 86_400_000;

type Target = { organisationId?: string | null; territoryId?: string | null };

/** Does the actor hold the capability on this target? Network and system grants apply to any target. */
function allowed(actor: AccessActorContext, permissions: PermissionData, capability: keyof typeof accessCapabilities, target: Target = {}): boolean {
  const { module, action } = accessCapabilities[capability];
  return evaluatePermission(
    { userId: actor.userId, module, action, ...(target.organisationId || target.territoryId ? { resource: { organisationId: target.organisationId ?? undefined, territoryId: target.territoryId ?? undefined } } : {}) },
    permissions
  ).allowed;
}

export function canAdminister(actor: AccessActorContext, permissions: PermissionData, capability: keyof typeof accessCapabilities, target: Target = {}) {
  return allowed(actor, permissions, capability, target);
}

function require(actor: AccessActorContext, permissions: PermissionData, capability: keyof typeof accessCapabilities, target: Target = {}) {
  if (!allowed(actor, permissions, capability, target)) {
    const { module, action } = accessCapabilities[capability];
    throw new AccessDeniedError(`Missing permission ${module}.${action}.`);
  }
}

/** Editing a built-in role changes what every holder can do, so it needs system-level authority. */
function requireSystemForBuiltIn(actor: AccessActorContext, permissions: PermissionData, role: Pick<RoleDetail, "isSystem">) {
  if (!role.isSystem) return;
  const { module, action } = accessCapabilities.manage;
  if (maxScopeRank(permissions, actor.userId, module, action) < scopeRank("system")) {
    throw new AccessDeniedError("Built-in roles can only be changed by Super Admin.");
  }
}

const grantLabel = (grant: { module: string; action: string; scope: string }) => `${grant.module}.${grant.action}@${grant.scope}`;

// ---- Reading ---------------------------------------------------------------------------------

export async function listAccessOverview(actor: AccessActorContext, permissions: PermissionData, store: AccessStore) {
  require(actor, permissions, "view");
  const [roles, assignments, invitations, organisations] = await Promise.all([store.listRoles(), store.listAssignments(), store.listInvitations(), store.listOrganisations()]);
  return { roles, assignments, invitations, organisations };
}

export async function readRole(actor: AccessActorContext, permissions: PermissionData, store: AccessStore, roleId: string) {
  require(actor, permissions, "view");
  const [role, catalogue] = await Promise.all([store.getRole(roleId), store.listPermissions()]);
  if (!role) throw new AccessStateError("That role was not found.");
  return { role, catalogue };
}

/** Why can (or can't) this person do this? The evaluator's own explanation, for administrators to debug access. */
export async function explainAccess(
  actor: AccessActorContext,
  permissions: PermissionData,
  input: { userId: string; module: string; action: string; organisationId?: string | null; territoryId?: string | null }
): Promise<PermissionDecision> {
  require(actor, permissions, "view");
  return evaluatePermission(
    { userId: input.userId, module: input.module, action: input.action, resource: { organisationId: input.organisationId ?? undefined, territoryId: input.territoryId ?? undefined } },
    permissions
  );
}

// ---- Roles -----------------------------------------------------------------------------------

export async function createRole(actor: AccessActorContext, permissions: PermissionData, audit: AccessAuditRecorder, store: AccessStore, input: { key: string; name: string; description?: string | null }): Promise<RoleDetail> {
  require(actor, permissions, "manage");
  const key = input.key.trim().toLowerCase();
  const name = input.name.trim();
  if (!ROLE_KEY_PATTERN.test(key)) throw new AccessInputError("A role key is 3 to 40 lowercase letters, numbers, hyphens or underscores, starting with a letter.");
  if (name.length < 2 || name.length > 80) throw new AccessInputError("Give the role a name of 2 to 80 characters.");
  if (await store.roleKeyExists(key)) throw new AccessStateError("A role with that key already exists.");

  const role = await store.insertRole({ key, name, description: input.description?.trim().slice(0, 300) || null });
  await audit.record({ action: auditActions.permissionRoleCreate, actor: { type: "human", userId: actor.userId }, entity: { type: "role", id: role.id }, after: { key, name } });
  return role;
}

export async function addRoleGrant(
  actor: AccessActorContext,
  permissions: PermissionData,
  audit: AccessAuditRecorder,
  store: AccessStore,
  input: { roleId: string; permissionId: string; scope: string }
) {
  require(actor, permissions, "manage");
  if (!(grantableScopes as readonly string[]).includes(input.scope)) throw new AccessInputError("Choose a valid scope.");
  const role = await store.getRole(input.roleId);
  if (!role) throw new AccessStateError("That role was not found.");
  requireSystemForBuiltIn(actor, permissions, role);
  const permission = (await store.listPermissions()).find((entry) => entry.id === input.permissionId);
  if (!permission) throw new AccessInputError("Choose a permission from the list.");

  // You cannot hand out reach you do not have yourself.
  assertCanGrantScope(permissions, actor.userId, { module: permission.module, action: permission.action, scope: input.scope });

  if (!(await store.addGrant(role.id, permission.id, input.scope))) throw new AccessStateError("This role already has that permission at that scope.");
  await audit.record({
    action: auditActions.permissionRoleUpdate,
    actor: { type: "human", userId: actor.userId },
    entity: { type: "role", id: role.id },
    metadata: { roleKey: role.key, granted: grantLabel({ module: permission.module, action: permission.action, scope: input.scope }) }
  });
}

export async function removeRoleGrant(
  actor: AccessActorContext,
  permissions: PermissionData,
  audit: AccessAuditRecorder,
  store: AccessStore,
  input: { roleId: string; permissionId: string; scope: string },
  now: Date = new Date()
) {
  require(actor, permissions, "manage");
  const role = await store.getRole(input.roleId);
  if (!role) throw new AccessStateError("That role was not found.");
  requireSystemForBuiltIn(actor, permissions, role);
  const existing = role.grants.find((grant) => grant.permissionId === input.permissionId && grant.scope === input.scope);
  if (!existing) throw new AccessStateError("This role does not have that permission.");

  await store.removeGrant(role.id, input.permissionId, input.scope);
  // Reload including this change: if nobody could administer any more, the transaction is rolled back.
  assertAdministratorRemains(await store.loadPermissionData(), await store.disabledUserIds(), now);

  await audit.record({
    action: auditActions.permissionRoleUpdate,
    actor: { type: "human", userId: actor.userId },
    entity: { type: "role", id: role.id },
    metadata: { roleKey: role.key, revoked: grantLabel(existing) }
  });
}

export async function deleteRole(actor: AccessActorContext, permissions: PermissionData, audit: AccessAuditRecorder, store: AccessStore, roleId: string, now: Date = new Date()) {
  require(actor, permissions, "manage");
  const role = await store.getRole(roleId);
  if (!role) throw new AccessStateError("That role was not found.");
  if (role.isSystem) throw new AccessStateError("Built-in roles cannot be deleted.");
  if (await store.roleHasLiveAssignments(role.id, now)) throw new AccessStateError("Remove everyone from this role before deleting it.");

  await store.softDeleteRole(role.id, now);
  await audit.record({ action: auditActions.permissionRoleDelete, actor: { type: "human", userId: actor.userId }, entity: { type: "role", id: role.id }, before: { key: role.key, name: role.name } });
}

// ---- Assignments -----------------------------------------------------------------------------

export async function assignRole(
  actor: AccessActorContext,
  permissions: PermissionData,
  audit: AccessAuditRecorder,
  store: AccessStore,
  input: { userId: string; roleId: string; organisationId: string; territoryId?: string | null; endsAt?: Date | null },
  now: Date = new Date()
): Promise<AssignmentRow> {
  const territoryId = input.territoryId ?? null;
  if (territoryId && !(await store.territoryBelongsTo(territoryId, input.organisationId))) throw new AccessInputError("That territory does not belong to this organisation.");
  require(actor, permissions, "assign", { organisationId: input.organisationId, territoryId });

  const role = await store.getRole(input.roleId);
  if (!role) throw new AccessStateError("That role was not found.");
  if (!(await store.userIsActiveMember(input.userId, input.organisationId))) throw new AccessStateError("This person is not a member of that organisation yet. Invite them first.");
  if (input.endsAt && input.endsAt <= now) throw new AccessInputError("The end date must be in the future.");

  assertCanAssignRole(permissions, actor.userId, role.id, { organisationId: input.organisationId, territoryId }, now);

  if (await store.hasLiveAssignment({ userId: input.userId, roleId: role.id, organisationId: input.organisationId, territoryId }, now)) throw new AccessStateError("They already hold this role here.");

  const assignment = await store.insertAssignment({ userId: input.userId, roleId: role.id, organisationId: input.organisationId, territoryId, endsAt: input.endsAt ?? null });
  await audit.record({
    action: auditActions.permissionAssignmentCreate,
    actor: { type: "human", userId: actor.userId },
    entity: { type: "user_role_assignment", id: assignment.id },
    scope: { organisationId: input.organisationId, territoryId: territoryId ?? undefined },
    metadata: { subjectUserId: input.userId, roleKey: role.key, endsAt: input.endsAt?.toISOString() ?? null }
  });
  return assignment;
}

export async function revokeAssignment(actor: AccessActorContext, permissions: PermissionData, audit: AccessAuditRecorder, store: AccessStore, assignmentId: string, now: Date = new Date()) {
  const assignment = await store.getAssignment(assignmentId);
  if (!assignment) throw new AccessStateError("That assignment was not found.");
  require(actor, permissions, "assign", { organisationId: assignment.organisationId, territoryId: assignment.territoryId });
  if (assignment.endsAt && assignment.endsAt <= now) throw new AccessStateError("That assignment has already ended.");

  // Ended, not deleted: the history of who held what stays.
  await store.endAssignment(assignment.id, now);
  assertAdministratorRemains(await store.loadPermissionData(), await store.disabledUserIds(), now);

  await audit.record({
    action: auditActions.permissionAssignmentRevoke,
    actor: { type: "human", userId: actor.userId },
    entity: { type: "user_role_assignment", id: assignment.id },
    scope: { organisationId: assignment.organisationId ?? undefined, territoryId: assignment.territoryId ?? undefined },
    metadata: { subjectUserId: assignment.userId, roleId: assignment.roleId }
  });
}

// ---- Invitations -----------------------------------------------------------------------------

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Invite someone to an organisation (and optionally a territory) with a role. They only get the
 * role when they accept, scoped exactly as invited. The raw token is returned once, for the email,
 * and only its hash is stored. Inviting again for the same place and role replaces the earlier
 * pending invitation, so there is only ever one live link.
 */
export async function inviteUser(
  actor: AccessActorContext,
  permissions: PermissionData,
  audit: AccessAuditRecorder,
  store: AccessStore,
  input: { email: string; organisationId: string; territoryId?: string | null; roleId?: string | null },
  now: Date = new Date()
): Promise<{ invitation: InvitationRow; token: string }> {
  if (input.territoryId && !(await store.territoryBelongsTo(input.territoryId, input.organisationId))) throw new AccessInputError("That territory does not belong to this organisation.");
  require(actor, permissions, "invite", { organisationId: input.organisationId, territoryId: input.territoryId ?? null });
  return createInvitation(actor, permissions, audit, store, input, now);
}

/**
 * Creates the invitation. The caller has ALREADY authorised the actor (roles.invite, or franchise.team.manage for
 * a franchise's own staff); this still enforces the "cannot grant what you do not hold" rule for the role.
 */
export async function createInvitation(
  actor: AccessActorContext,
  permissions: PermissionData,
  audit: AccessAuditRecorder,
  store: AccessStore,
  input: { email: string; organisationId: string; territoryId?: string | null; roleId?: string | null },
  now: Date = new Date()
): Promise<{ invitation: InvitationRow; token: string }> {
  const email = input.email.trim().toLowerCase();
  const territoryId = input.territoryId ?? null;
  const roleId = input.roleId ?? null;
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new AccessInputError("Enter a valid email address.");
  if (territoryId && !(await store.territoryBelongsTo(territoryId, input.organisationId))) throw new AccessInputError("That territory does not belong to this organisation.");
  if (roleId) {
    const role = await store.getRole(roleId);
    if (!role) throw new AccessStateError("That role was not found.");
    assertCanAssignRole(permissions, actor.userId, role.id, { organisationId: input.organisationId, territoryId }, now);
  }

  await store.revokePendingInvitations({ email, organisationId: input.organisationId, territoryId, roleId }, now);
  const token = randomBytes(32).toString("base64url");
  const invitation = await store.insertInvitation({ email, organisationId: input.organisationId, territoryId, roleId, tokenHash: hashToken(token), invitedByUserId: actor.userId, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS) });

  await audit.record({
    action: auditActions.authInviteSend,
    actor: { type: "human", userId: actor.userId },
    entity: { type: "auth_invitation", id: invitation.id },
    scope: { organisationId: input.organisationId, territoryId: territoryId ?? undefined },
    // The address is hashed: the audit trail is not the place for invitees' email addresses.
    metadata: { inviteeHash: createHash("sha256").update(email).digest("hex").slice(0, 16), roleId }
  });

  return { invitation, token };
}

export async function revokeInvitationById(actor: AccessActorContext, permissions: PermissionData, audit: AccessAuditRecorder, store: AccessStore, invitationId: string, now: Date = new Date()) {
  const invitation = await store.getInvitation(invitationId);
  if (!invitation) throw new AccessStateError("That invitation was not found.");
  require(actor, permissions, "invite", { organisationId: invitation.organisationId, territoryId: invitation.territoryId });
  if (!(await store.revokeInvitation(invitation.id, now))) throw new AccessStateError("That invitation is no longer pending.");
  await audit.record({ action: auditActions.authInviteRevoke, actor: { type: "human", userId: actor.userId }, entity: { type: "auth_invitation", id: invitation.id }, scope: { organisationId: invitation.organisationId, territoryId: invitation.territoryId ?? undefined } });
}

