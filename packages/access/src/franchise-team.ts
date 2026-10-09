import { auditActions } from "@raring2go/audit";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import { AccessDeniedError, AccessInputError, AccessStateError, createInvitation } from "./service";
import type { AccessActorContext, AccessAuditRecorder } from "./service";
import type { AccessStore, AssignmentRow, InvitationRow, RoleSummary } from "./types";

/**
 * A franchisee managing their own team (docs/FRANCHISE_STAFF.md). This is deliberately narrower than role
 * administration: it can only invite and remove people for roles flagged `franchiseDelegable`, only at the
 * actor's own franchise organisation and territory, and it still goes through the "cannot grant what you do
 * not hold" guard. It never touches `roles.assign` or `roles.invite`, which a franchisee does not hold.
 */
export const franchiseTeamCapabilities = {
  view: { module: "franchise.team", action: "view" },
  manage: { module: "franchise.team", action: "manage" }
} as const;

export const DEFAULT_SEAT_LIMIT = 10;

export type TeamTarget = { organisationId: string; territoryId: string };

export type FranchiseTeamView = {
  target: TeamTarget;
  staff: AssignmentRow[];
  invitations: InvitationRow[];
  roles: RoleSummary[];
  seats: { used: number; limit: number };
  canManage: boolean;
};

function targetOf(actor: AccessActorContext): TeamTarget {
  if (!actor.organisationId || !actor.territoryId) throw new AccessInputError("Choose your franchise territory first.");
  return { organisationId: actor.organisationId, territoryId: actor.territoryId };
}

function can(actor: AccessActorContext, permissions: PermissionData, capability: keyof typeof franchiseTeamCapabilities, target: TeamTarget) {
  const { module, action } = franchiseTeamCapabilities[capability];
  return evaluatePermission({ userId: actor.userId, module, action, resource: target }, permissions).allowed;
}

function require(actor: AccessActorContext, permissions: PermissionData, capability: keyof typeof franchiseTeamCapabilities, target: TeamTarget) {
  if (!can(actor, permissions, capability, target)) {
    const { module, action } = franchiseTeamCapabilities[capability];
    throw new AccessDeniedError(`Missing permission ${module}.${action}.`);
  }
}

async function verifiedTarget(actor: AccessActorContext, store: AccessStore): Promise<TeamTarget> {
  const target = targetOf(actor);
  if (!(await store.territoryBelongsTo(target.territoryId, target.organisationId))) throw new AccessInputError("That territory does not belong to this franchise.");
  return target;
}

export async function readFranchiseTeam(actor: AccessActorContext, permissions: PermissionData, store: AccessStore, now: Date = new Date(), options: { seatLimit?: number } = {}): Promise<FranchiseTeamView> {
  const target = await verifiedTarget(actor, store);
  require(actor, permissions, "view", target);
  const roles = await store.listDelegableRoles();
  const roleIds = roles.map((role) => role.id);
  const [staff, invitations] = await Promise.all([store.listTeamAssignments({ ...target, roleIds }, now), store.listTeamInvitations({ ...target, roleIds }, now)]);
  return { target, staff, invitations, roles, seats: { used: staff.length + invitations.length, limit: options.seatLimit ?? DEFAULT_SEAT_LIMIT }, canManage: can(actor, permissions, "manage", target) };
}

export async function inviteFranchiseStaff(
  actor: AccessActorContext,
  permissions: PermissionData,
  audit: AccessAuditRecorder,
  store: AccessStore,
  input: { email: string; roleId?: string | null },
  now: Date = new Date(),
  options: { seatLimit?: number } = {}
) {
  const target = await verifiedTarget(actor, store);
  require(actor, permissions, "manage", target);

  const roles = await store.listDelegableRoles();
  const role = input.roleId ? roles.find((candidate) => candidate.id === input.roleId) : roles.length === 1 ? roles[0] : undefined;
  if (!role) throw new AccessDeniedError("That role cannot be given to your own team.");

  const roleIds = roles.map((candidate) => candidate.id);
  const [staff, invitations] = await Promise.all([store.listTeamAssignments({ ...target, roleIds }, now), store.listTeamInvitations({ ...target, roleIds }, now)]);
  const email = input.email.trim().toLowerCase();
  // Inviting the same address again replaces its pending link, so it does not take another seat.
  const replacing = invitations.some((invitation) => invitation.email === email && invitation.roleId === role.id);
  if (!replacing && staff.length + invitations.length >= (options.seatLimit ?? DEFAULT_SEAT_LIMIT)) throw new AccessStateError("Your team has reached its seat limit. Remove someone or ask Head Office.");
  if (staff.some((assignment) => assignment.userEmail.toLowerCase() === email)) throw new AccessStateError("That person is already on your team.");

  const result = await createInvitation(actor, permissions, audit, store, { email, organisationId: target.organisationId, territoryId: target.territoryId, roleId: role.id }, now);
  await audit.record({
    action: auditActions.franchiseTeamInvite,
    actor: { type: "human", userId: actor.userId },
    entity: { type: "auth_invitation", id: result.invitation.id },
    scope: { organisationId: target.organisationId, territoryId: target.territoryId },
    metadata: { roleKey: role.key }
  });
  return result;
}

/** Someone leaves the team. Only a delegable role at the actor's own franchise can be ended here. */
export async function removeFranchiseStaff(actor: AccessActorContext, permissions: PermissionData, audit: AccessAuditRecorder, store: AccessStore, assignmentId: string, now: Date = new Date()) {
  const target = await verifiedTarget(actor, store);
  require(actor, permissions, "manage", target);
  const roleIds = (await store.listDelegableRoles()).map((role) => role.id);
  const assignment = (await store.listTeamAssignments({ ...target, roleIds }, now)).find((candidate) => candidate.id === assignmentId);
  // The same answer for "not yours" and "does not exist": nothing is revealed about other franchises.
  if (!assignment) throw new AccessStateError("That person is not on your team.");

  await store.endAssignment(assignment.id, now);
  await audit.record({
    action: auditActions.franchiseTeamRemove,
    actor: { type: "human", userId: actor.userId },
    entity: { type: "user_role_assignment", id: assignment.id },
    scope: target,
    metadata: { subjectUserId: assignment.userId, roleId: assignment.roleId }
  });
}

export async function revokeFranchiseStaffInvitation(actor: AccessActorContext, permissions: PermissionData, audit: AccessAuditRecorder, store: AccessStore, invitationId: string, now: Date = new Date()) {
  const target = await verifiedTarget(actor, store);
  require(actor, permissions, "manage", target);
  const roleIds = (await store.listDelegableRoles()).map((role) => role.id);
  const invitation = (await store.listTeamInvitations({ ...target, roleIds }, now)).find((candidate) => candidate.id === invitationId);
  if (!invitation) throw new AccessStateError("That invitation was not found.");
  if (!(await store.revokeInvitation(invitation.id, now))) throw new AccessStateError("That invitation is no longer pending.");
  await audit.record({
    action: auditActions.franchiseTeamInviteRevoke,
    actor: { type: "human", userId: actor.userId },
    entity: { type: "auth_invitation", id: invitation.id },
    scope: target
  });
}

/**
 * A franchise is suspended or leaves: its team loses access at once, and pending invitations are withdrawn.
 * No actor permission check: the caller (the franchise status change) has already been authorised, and
 * this only ever removes access. Returns how many people and invitations were ended.
 */
export async function endFranchiseStaffAccess(
  audit: AccessAuditRecorder,
  store: AccessStore,
  target: TeamTarget,
  reason: string,
  actor: { type: "human"; userId: string } | { type: "automation"; automationId: string },
  now: Date = new Date()
) {
  const roleIds = (await store.listDelegableRoles()).map((role) => role.id);
  const [staff, invitations] = await Promise.all([store.listTeamAssignments({ ...target, roleIds }, now), store.listTeamInvitations({ ...target, roleIds }, now)]);
  for (const assignment of staff) await store.endAssignment(assignment.id, now);
  for (const invitation of invitations) await store.revokeInvitation(invitation.id, now);
  if (staff.length + invitations.length > 0) {
    await audit.record({
      action: auditActions.franchiseTeamAccessEnded,
      actor,
      entity: { type: "territory", id: target.territoryId },
      scope: target,
      metadata: { reason, peopleEnded: staff.length, invitationsWithdrawn: invitations.length }
    });
  }
  return { peopleEnded: staff.length, invitationsWithdrawn: invitations.length };
}
