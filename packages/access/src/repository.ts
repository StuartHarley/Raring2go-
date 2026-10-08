import { authInvitations, memberships, organisations, permissions, rolePermissions, roles, territories, userRoleAssignments, users } from "@raring2go/db";
import type { createDb } from "@raring2go/db";
import { loadPermissionData } from "@raring2go/permissions";
import { and, asc, count, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { AccessStore, AssignmentRow, InvitationRow, RoleDetail, RoleSummary } from "./types";

type Db = ReturnType<typeof createDb>["db"];

export function createDrizzleAccessStore(db: Db): AccessStore {
  const grantsFor = async (roleId: string) =>
    (
      await db
        .select({ permissionId: permissions.id, module: permissions.module, action: permissions.action, scope: rolePermissions.scope, description: permissions.description })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(rolePermissions.roleId, roleId))
        .orderBy(asc(permissions.module), asc(permissions.action), asc(rolePermissions.scope))
    ).map((row) => ({ ...row }));

  const assignmentRows = async (where?: ReturnType<typeof eq>): Promise<AssignmentRow[]> => {
    const rows = await db
      .select({
        id: userRoleAssignments.id,
        userId: userRoleAssignments.userId,
        userEmail: users.email,
        userName: users.displayName,
        userStatus: users.status,
        roleId: userRoleAssignments.roleId,
        roleName: roles.name,
        organisationId: userRoleAssignments.organisationId,
        organisationName: organisations.name,
        territoryId: userRoleAssignments.territoryId,
        territoryName: territories.name,
        startsAt: userRoleAssignments.startsAt,
        endsAt: userRoleAssignments.endsAt,
        createdAt: userRoleAssignments.createdAt
      })
      .from(userRoleAssignments)
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .leftJoin(organisations, eq(organisations.id, userRoleAssignments.organisationId))
      .leftJoin(territories, eq(territories.id, userRoleAssignments.territoryId))
      .where(where)
      .orderBy(asc(users.email), asc(roles.name));
    return rows;
  };

  const invitationRows = async (where?: ReturnType<typeof eq>): Promise<InvitationRow[]> =>
    db
      .select({
        id: authInvitations.id,
        email: authInvitations.email,
        organisationId: authInvitations.organisationId,
        organisationName: organisations.name,
        territoryId: authInvitations.territoryId,
        territoryName: territories.name,
        roleId: authInvitations.roleId,
        roleName: roles.name,
        status: authInvitations.status,
        expiresAt: authInvitations.expiresAt,
        createdAt: authInvitations.createdAt
      })
      .from(authInvitations)
      .leftJoin(organisations, eq(organisations.id, authInvitations.organisationId))
      .leftJoin(territories, eq(territories.id, authInvitations.territoryId))
      .leftJoin(roles, eq(roles.id, authInvitations.roleId))
      .where(where)
      .orderBy(asc(authInvitations.createdAt));

  return {
    async listRoles() {
      const rows = await db.select().from(roles).where(isNull(roles.deletedAt)).orderBy(asc(roles.name));
      const [grantCounts, assignmentCounts] = await Promise.all([
        db.select({ roleId: rolePermissions.roleId, n: count() }).from(rolePermissions).groupBy(rolePermissions.roleId),
        db.select({ roleId: userRoleAssignments.roleId, n: count() }).from(userRoleAssignments).where(or(isNull(userRoleAssignments.endsAt), gt(userRoleAssignments.endsAt, new Date()))).groupBy(userRoleAssignments.roleId)
      ]);
      const grantsBy = new Map(grantCounts.map((row) => [row.roleId, row.n]));
      const assignmentsBy = new Map(assignmentCounts.map((row) => [row.roleId, row.n]));
      return rows.map((row): RoleSummary => ({ id: row.id, key: row.key, name: row.name, description: row.description, isSystem: row.isSystem, grantCount: grantsBy.get(row.id) ?? 0, assignmentCount: assignmentsBy.get(row.id) ?? 0 }));
    },

    async getRole(roleId) {
      const [row] = await db.select().from(roles).where(and(eq(roles.id, roleId), isNull(roles.deletedAt))).limit(1);
      if (!row) return undefined;
      const grants = await grantsFor(roleId);
      const [assignments] = await db
        .select({ n: count() })
        .from(userRoleAssignments)
        .where(and(eq(userRoleAssignments.roleId, roleId), or(isNull(userRoleAssignments.endsAt), gt(userRoleAssignments.endsAt, new Date()))));
      return { id: row.id, key: row.key, name: row.name, description: row.description, isSystem: row.isSystem, grantCount: grants.length, assignmentCount: assignments?.n ?? 0, grants } satisfies RoleDetail;
    },

    async listPermissions() {
      return db.select({ id: permissions.id, module: permissions.module, action: permissions.action, description: permissions.description }).from(permissions).orderBy(asc(permissions.module), asc(permissions.action));
    },

    listAssignments: () => assignmentRows(),
    async getAssignment(assignmentId) {
      return (await assignmentRows(eq(userRoleAssignments.id, assignmentId)))[0];
    },
    listInvitations: () => invitationRows(),
    async getInvitation(invitationId) {
      return (await invitationRows(eq(authInvitations.id, invitationId)))[0];
    },

    async listOrganisations() {
      const [orgRows, territoryRows] = await Promise.all([
        db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(isNull(organisations.deletedAt)).orderBy(asc(organisations.name)),
        db.select({ id: territories.id, name: territories.name, franchiseOrganisationId: territories.franchiseOrganisationId }).from(territories).where(isNull(territories.deletedAt)).orderBy(asc(territories.name))
      ]);
      return orgRows.map((org) => ({ ...org, territories: territoryRows.filter((territory) => territory.franchiseOrganisationId === org.id).map(({ id, name }) => ({ id, name })) }));
    },

    async roleKeyExists(key) {
      const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
      return Boolean(row);
    },

    async insertRole(input) {
      const [row] = await db.insert(roles).values({ key: input.key, name: input.name, description: input.description, isSystem: false }).returning();
      return { id: row!.id, key: row!.key, name: row!.name, description: row!.description, isSystem: false, grantCount: 0, assignmentCount: 0, grants: [] };
    },

    async softDeleteRole(roleId, now) {
      await db.update(roles).set({ deletedAt: now, updatedAt: now }).where(eq(roles.id, roleId));
    },

    async roleHasLiveAssignments(roleId, now) {
      const [row] = await db
        .select({ id: userRoleAssignments.id })
        .from(userRoleAssignments)
        .where(and(eq(userRoleAssignments.roleId, roleId), or(isNull(userRoleAssignments.endsAt), gt(userRoleAssignments.endsAt, now))))
        .limit(1);
      return Boolean(row);
    },

    async addGrant(roleId, permissionId, scope) {
      const inserted = await db.insert(rolePermissions).values({ roleId, permissionId, scope, constraints: {} }).onConflictDoNothing().returning({ roleId: rolePermissions.roleId });
      return inserted.length === 1;
    },

    async removeGrant(roleId, permissionId, scope) {
      const removed = await db
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId), eq(rolePermissions.scope, scope)))
        .returning({ roleId: rolePermissions.roleId });
      return removed.length === 1;
    },

    async userIsActiveMember(userId, organisationId) {
      const [row] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.organisationId, organisationId), eq(memberships.status, "active")))
        .limit(1);
      return Boolean(row);
    },

    async territoryBelongsTo(territoryId, organisationId) {
      const [row] = await db
        .select({ id: territories.id })
        .from(territories)
        .where(and(eq(territories.id, territoryId), eq(territories.franchiseOrganisationId, organisationId), isNull(territories.deletedAt)))
        .limit(1);
      return Boolean(row);
    },

    async hasLiveAssignment(input, now) {
      const organisationClause = input.organisationId ? eq(userRoleAssignments.organisationId, input.organisationId) : isNull(userRoleAssignments.organisationId);
      const territoryClause = input.territoryId ? eq(userRoleAssignments.territoryId, input.territoryId) : isNull(userRoleAssignments.territoryId);
      const [row] = await db
        .select({ id: userRoleAssignments.id })
        .from(userRoleAssignments)
        .where(and(eq(userRoleAssignments.userId, input.userId), eq(userRoleAssignments.roleId, input.roleId), organisationClause, territoryClause, or(isNull(userRoleAssignments.endsAt), gt(userRoleAssignments.endsAt, now))))
        .limit(1);
      return Boolean(row);
    },

    async insertAssignment(input) {
      const [row] = await db.insert(userRoleAssignments).values({ userId: input.userId, roleId: input.roleId, organisationId: input.organisationId, territoryId: input.territoryId, endsAt: input.endsAt }).returning({ id: userRoleAssignments.id });
      return (await assignmentRows(eq(userRoleAssignments.id, row!.id)))[0]!;
    },

    async endAssignment(assignmentId, now) {
      await db.update(userRoleAssignments).set({ endsAt: now, updatedAt: now }).where(eq(userRoleAssignments.id, assignmentId));
    },

    async disabledUserIds() {
      const rows = await db.select({ id: users.id }).from(users).where(or(sql`${users.status} <> 'active'`, sql`${users.deletedAt} IS NOT NULL`));
      return new Set(rows.map((row) => row.id));
    },

    async revokePendingInvitations(input, now) {
      const territoryClause = input.territoryId ? eq(authInvitations.territoryId, input.territoryId) : isNull(authInvitations.territoryId);
      const roleClause = input.roleId ? eq(authInvitations.roleId, input.roleId) : isNull(authInvitations.roleId);
      const revoked = await db
        .update(authInvitations)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(and(sql`lower(${authInvitations.email}) = ${input.email.toLowerCase()}`, eq(authInvitations.organisationId, input.organisationId), territoryClause, roleClause, eq(authInvitations.status, "pending")))
        .returning({ id: authInvitations.id });
      return revoked.length;
    },

    async insertInvitation(input) {
      const [row] = await db
        .insert(authInvitations)
        .values({ email: input.email.toLowerCase(), organisationId: input.organisationId, territoryId: input.territoryId, roleId: input.roleId, tokenHash: input.tokenHash, invitedByUserId: input.invitedByUserId, expiresAt: input.expiresAt })
        .returning({ id: authInvitations.id });
      return (await invitationRows(eq(authInvitations.id, row!.id)))[0]!;
    },

    async revokeInvitation(invitationId, now) {
      const revoked = await db
        .update(authInvitations)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(and(eq(authInvitations.id, invitationId), eq(authInvitations.status, "pending")))
        .returning({ id: authInvitations.id });
      return revoked.length === 1;
    },

    loadPermissionData: () => loadPermissionData(db)
  };
}

