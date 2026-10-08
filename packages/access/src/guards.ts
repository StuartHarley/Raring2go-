import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";

/**
 * How wide a grant reaches, lowest to highest. Used to stop anyone handing out more reach than
 * they hold themselves: a territory-level administrator cannot create a network-wide role.
 */
const SCOPE_RANK: Record<string, number> = {
  public: 0,
  own_record: 1,
  own_organisation: 2,
  organisation: 2,
  own_territory: 3,
  territory: 3,
  selected_territories: 3,
  network: 4,
  system: 5
};

/** Scopes an administrator may choose when editing a role. */
export const grantableScopes = ["own_record", "own_organisation", "own_territory", "network", "system"] as const;
export type GrantableScope = (typeof grantableScopes)[number];

export const scopeRank = (scope: string) => SCOPE_RANK[scope] ?? Number.POSITIVE_INFINITY;

export class AccessEscalationError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`You cannot grant access you do not hold yourself: ${missing.join(", ")}.`);
    this.name = "AccessEscalationError";
    this.missing = missing;
  }
}

export class AdministratorRequiredError extends Error {
  constructor() {
    super("This change would leave nobody able to administer roles and permissions.");
    this.name = "AdministratorRequiredError";
  }
}

const isLive = (window: { startsAt?: Date | null; endsAt?: Date | null }, now: Date) => (!window.startsAt || window.startsAt <= now) && (!window.endsAt || window.endsAt > now);

/** The widest scope this person currently holds for a capability through their own role assignments. */
export function maxScopeRank(data: PermissionData, userId: string, module: string, action: string, now: Date = new Date()): number {
  const roleIds = new Set(data.roleAssignments.filter((assignment) => assignment.userId === userId && isLive(assignment, now)).map((assignment) => assignment.roleId));
  let best = -1;
  for (const grant of data.rolePermissions) {
    if (roleIds.has(grant.roleId) && grant.permission.module === module && grant.permission.action === action) best = Math.max(best, scopeRank(grant.scope));
  }
  return best;
}

/**
 * A system-level administrator (roles.manage at system scope) may hand out any role: that authority is
 * what "Super Admin" means, and it does not require holding each capability personally. Everyone else is
 * bound by the "cannot grant what you do not hold" rules below.
 */
export function isSystemAdministrator(data: PermissionData, userId: string, now: Date = new Date()): boolean {
  return maxScopeRank(data, userId, "roles", "manage", now) >= scopeRank("system");
}

/** Adding a grant to a role: the actor must already hold that capability at least as widely. */
export function assertCanGrantScope(data: PermissionData, actorUserId: string, grant: { module: string; action: string; scope: string }, now: Date = new Date()) {
  if (isSystemAdministrator(data, actorUserId, now)) return;

  if (maxScopeRank(data, actorUserId, grant.module, grant.action, now) < scopeRank(grant.scope)) {
    throw new AccessEscalationError([`${grant.module}.${grant.action} at ${grant.scope}`]);
  }
}

/**
 * Giving someone a role: for every grant the role carries, the actor must be able to exercise that
 * capability on the very organisation and territory it is being given for, and must hold it at least
 * as widely as the role grants it. Both halves matter: the first alone would let a network-scope
 * actor hand out a system-scope role.
 */
export function assertCanAssignRole(
  data: PermissionData,
  actorUserId: string,
  roleId: string,
  target: { organisationId?: string | null; territoryId?: string | null },
  now: Date = new Date()
) {
  if (isSystemAdministrator(data, actorUserId, now)) return;

  const missing: string[] = [];

  for (const grant of data.rolePermissions.filter((entry) => entry.roleId === roleId)) {
    const { module, action } = grant.permission;
    const decision = evaluatePermission(
      { userId: actorUserId, module, action, now, resource: { organisationId: target.organisationId ?? undefined, territoryId: target.territoryId ?? undefined } },
      data
    );
    if (!decision.allowed || maxScopeRank(data, actorUserId, module, action, now) < scopeRank(grant.scope)) {
      missing.push(`${module}.${action} at ${grant.scope}`);
    }
  }

  if (missing.length) throw new AccessEscalationError(missing);
}

/** True while at least one account (not in `excluding`) can still administer roles at system level. */
export function administratorRemains(data: PermissionData, excluding: ReadonlySet<string> = new Set(), now: Date = new Date()): boolean {
  const adminRoles = new Set(data.rolePermissions.filter((grant) => grant.permission.module === "roles" && grant.permission.action === "manage" && grant.scope === "system").map((grant) => grant.roleId));
  return data.roleAssignments.some((assignment) => adminRoles.has(assignment.roleId) && !excluding.has(assignment.userId) && isLive(assignment, now));
}

export function assertAdministratorRemains(data: PermissionData, excluding: ReadonlySet<string> = new Set(), now: Date = new Date()) {
  if (!administratorRemains(data, excluding, now)) throw new AdministratorRequiredError();
}
