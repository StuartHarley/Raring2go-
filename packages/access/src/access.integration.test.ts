import { randomUUID } from "node:crypto";
import { acceptInvitation, createDrizzleAuthRepository, createMemoryAuditRecorder } from "@raring2go/auth";
import { authInvitations, createDb, fixtureIds, memberships, permissions as permissionsTable, rolePermissions, roles, userRoleAssignments, users } from "@raring2go/db";
import { evaluatePermission, loadPermissionData } from "@raring2go/permissions";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AccessEscalationError, AdministratorRequiredError } from "./guards";
import { createDrizzleAccessStore } from "./repository";
import { AccessDeniedError, AccessInputError, AccessStateError, addRoleGrant, assignRole, createRole, deleteRole, explainAccess, inviteUser, removeRoleGrant, revokeAssignment, revokeInvitationById } from "./service";

/** Real SQL for access administration. `RUN_DB_TESTS=1 pnpm --filter @raring2go/access test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("access administration (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const franchiseOrg = fixtureIds.organisations.franchise;
  const sutton = fixtureIds.territories.suttonColdfield;
  const solihull = fixtureIds.territories.solihull;
  const root = fixtureIds.users.superAdmin; // super_admin + hq_admin
  const events: Array<{ action: string; metadata?: unknown }> = [];
  const audit = { record: async (input: { action: string; metadata?: unknown }) => void events.push(input) };

  const userIds: string[] = [];
  const roleIds: string[] = [];

  const makeUser = async (label: string, options: { org?: string; role?: string; territory?: string | null } = {}) => {
    const [user] = await db.insert(users).values({ email: `itest-${label}-${tag}@example.com`, displayName: label }).returning();
    userIds.push(user!.id);
    if (options.org) await db.insert(memberships).values({ userId: user!.id, organisationId: options.org });
    if (options.role) await db.insert(userRoleAssignments).values({ userId: user!.id, roleId: options.role, organisationId: options.org ?? null, territoryId: options.territory ?? null });
    return user!.id;
  };

  /** One service call exactly as the app runs it: in a transaction, with permissions loaded fresh. */
  const run = async <T>(actorUserId: string, work: (ctx: { actor: { userId: string }; permissions: Awaited<ReturnType<typeof loadPermissionData>>; store: ReturnType<typeof createDrizzleAccessStore> }) => Promise<T>) => {
    const permissions = await loadPermissionData(db);
    return db.transaction(async (tx) => work({ actor: { userId: actorUserId }, permissions, store: createDrizzleAccessStore(tx as unknown as typeof db) }));
  };

  afterAll(async () => {
    if (userIds.length) {
      await db.delete(userRoleAssignments).where(inArray(userRoleAssignments.userId, userIds));
      await db.delete(memberships).where(inArray(memberships.userId, userIds));
      await db.delete(authInvitations).where(inArray(authInvitations.invitedByUserId, userIds));
    }
    await db.delete(authInvitations).where(like(authInvitations.email, `%-${tag}@example.com`));
    if (roleIds.length) {
      await db.delete(userRoleAssignments).where(inArray(userRoleAssignments.roleId, roleIds));
      await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, roleIds));
      await db.delete(roles).where(inArray(roles.id, roleIds));
    }
    await db.delete(users).where(like(users.email, `itest-%-${tag}@example.com`));
    await sql.end();
  });

  const permissionId = async (module: string, action: string) => (await db.select().from(permissionsTable).where(and(eq(permissionsTable.module, module), eq(permissionsTable.action, action))))[0]!.id;

  it("lets Super Admin create a role, add and remove grants, and records each change", async () => {
    const role = await run(root, ({ actor, permissions, store }) => createRole(actor, permissions, audit, store, { key: `itest-${tag}`, name: `Itest ${tag}`, description: "temporary" }));
    roleIds.push(role.id);
    expect(role).toMatchObject({ isSystem: false, grantCount: 0 });

    const edit = await permissionId("content", "edit");
    await run(root, ({ actor, permissions, store }) => addRoleGrant(actor, permissions, audit, store, { roleId: role.id, permissionId: edit, scope: "own_territory" }));
    await expect(run(root, ({ actor, permissions, store }) => addRoleGrant(actor, permissions, audit, store, { roleId: role.id, permissionId: edit, scope: "own_territory" }))).rejects.toBeInstanceOf(AccessStateError);
    expect((await run(root, ({ store }) => store.getRole(role.id)))!.grants).toHaveLength(1);

    await run(root, ({ actor, permissions, store }) => removeRoleGrant(actor, permissions, audit, store, { roleId: role.id, permissionId: edit, scope: "own_territory" }));
    expect((await run(root, ({ store }) => store.getRole(role.id)))!.grants).toHaveLength(0);
    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining(["permission.role.create", "permission.role.update"]));

    await expect(run(root, ({ actor, permissions, store }) => createRole(actor, permissions, audit, store, { key: "Bad Key!", name: "x" }))).rejects.toBeInstanceOf(AccessInputError);
    await expect(run(root, ({ actor, permissions, store }) => createRole(actor, permissions, audit, store, { key: `itest-${tag}`, name: "Dup" }))).rejects.toBeInstanceOf(AccessStateError);
  });

  it("refuses role changes to anyone without roles.manage, and edits to built-in roles to non-system administrators", async () => {
    const hqOnly = await makeUser("hqonly", { org: fixtureIds.organisations.hq, role: fixtureIds.roles.hqAdmin });
    const edit = await permissionId("content", "edit");
    await expect(run(hqOnly, ({ actor, permissions, store }) => createRole(actor, permissions, audit, store, { key: `nope-${tag}`, name: "Nope" }))).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(run(hqOnly, ({ actor, permissions, store }) => addRoleGrant(actor, permissions, audit, store, { roleId: fixtureIds.roles.franchisee, permissionId: edit, scope: "network" }))).rejects.toBeInstanceOf(AccessDeniedError);
    const franchisee = fixtureIds.users.franchisee;
    await expect(run(franchisee, ({ actor, permissions, store }) => createRole(actor, permissions, audit, store, { key: `nope2-${tag}`, name: "Nope" }))).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("stops anyone granting a scope wider than they hold", async () => {
    // A custom role-manager with only own_territory content.edit, plus roles.manage at network scope.
    const manager = await run(root, ({ actor, permissions, store }) => createRole(actor, permissions, audit, store, { key: `mgr-${tag}`, name: "Manager" }));
    roleIds.push(manager.id);
    const [edit, manage] = await Promise.all([permissionId("content", "edit"), permissionId("roles", "manage")]);
    await run(root, async ({ actor, permissions, store }) => {
      await addRoleGrant(actor, permissions, audit, store, { roleId: manager.id, permissionId: edit, scope: "own_territory" });
    });
    await db.insert(rolePermissions).values({ roleId: manager.id, permissionId: manage, scope: "network", constraints: {} }); // direct insert: bypasses the guard by design, to set up the actor
    const actorId = await makeUser("manager", { org: franchiseOrg, role: manager.id, territory: sutton });

    const target = await run(root, ({ actor, permissions, store }) => createRole(actor, permissions, audit, store, { key: `tgt-${tag}`, name: "Target" }));
    roleIds.push(target.id);
    await run(actorId, ({ actor, permissions, store }) => addRoleGrant(actor, permissions, audit, store, { roleId: target.id, permissionId: edit, scope: "own_territory" }));
    await expect(run(actorId, ({ actor, permissions, store }) => addRoleGrant(actor, permissions, audit, store, { roleId: target.id, permissionId: edit, scope: "network" }))).rejects.toBeInstanceOf(AccessEscalationError);
    const approve = await permissionId("content", "approve");
    await expect(run(actorId, ({ actor, permissions, store }) => addRoleGrant(actor, permissions, audit, store, { roleId: target.id, permissionId: approve, scope: "own_territory" }))).rejects.toBeInstanceOf(AccessEscalationError);
  });

  it("assigns a role to a member, scoped to the territory, and the permission works immediately", async () => {
    const staff = await makeUser("staff", { org: franchiseOrg });
    const before = await loadPermissionData(db);
    expect(evaluatePermission({ userId: staff, module: "system.jobs", action: "view", resource: { territoryId: sutton } }, before).allowed).toBe(false);

    const assignment = await run(root, ({ actor, permissions, store }) => assignRole(actor, permissions, audit, store, { userId: staff, roleId: fixtureIds.roles.franchisee, organisationId: franchiseOrg, territoryId: sutton }));
    expect(assignment).toMatchObject({ roleId: fixtureIds.roles.franchisee, territoryId: sutton, userId: staff });

    const after = await loadPermissionData(db);
    expect(evaluatePermission({ userId: staff, module: "system.jobs", action: "view", resource: { territoryId: sutton } }, after).allowed).toBe(true);
    expect(evaluatePermission({ userId: staff, module: "system.jobs", action: "view", resource: { territoryId: solihull } }, after).allowed).toBe(false);

    await expect(run(root, ({ actor, permissions, store }) => assignRole(actor, permissions, audit, store, { userId: staff, roleId: fixtureIds.roles.franchisee, organisationId: franchiseOrg, territoryId: sutton }))).rejects.toThrow(/already hold/);
    await run(root, ({ actor, permissions, store }) => revokeAssignment(actor, permissions, audit, store, assignment.id));
    expect(evaluatePermission({ userId: staff, module: "system.jobs", action: "view", resource: { territoryId: sutton } }, await loadPermissionData(db)).allowed).toBe(false);
    // Ended, not deleted: the history stays.
    expect((await db.select().from(userRoleAssignments).where(eq(userRoleAssignments.id, assignment.id)))[0]!.endsAt).not.toBeNull();
    await expect(run(root, ({ actor, permissions, store }) => revokeAssignment(actor, permissions, audit, store, assignment.id))).rejects.toThrow(/already ended/);
  });

  it("refuses an assignment to a non-member, a territory from another organisation, a past end date, and anyone without roles.assign", async () => {
    const outsider = await makeUser("outsider");
    await expect(run(root, ({ actor, permissions, store }) => assignRole(actor, permissions, audit, store, { userId: outsider, roleId: fixtureIds.roles.franchisee, organisationId: franchiseOrg, territoryId: sutton }))).rejects.toThrow(/Invite them first/);
    const member = await makeUser("member", { org: franchiseOrg });
    await expect(run(root, ({ actor, permissions, store }) => assignRole(actor, permissions, audit, store, { userId: member, roleId: fixtureIds.roles.franchisee, organisationId: fixtureIds.organisations.hq, territoryId: sutton }))).rejects.toBeInstanceOf(AccessInputError);
    await expect(run(root, ({ actor, permissions, store }) => assignRole(actor, permissions, audit, store, { userId: member, roleId: fixtureIds.roles.franchisee, organisationId: franchiseOrg, territoryId: sutton, endsAt: new Date(Date.now() - 1000) }))).rejects.toBeInstanceOf(AccessInputError);
    await expect(run(fixtureIds.users.franchisee, ({ actor, permissions, store }) => assignRole(actor, permissions, audit, store, { userId: member, roleId: fixtureIds.roles.franchisee, organisationId: franchiseOrg, territoryId: sutton }))).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("stops an HQ administrator giving out Super Admin, but lets them give a role they hold", async () => {
    const hqOnly = await makeUser("hqadmin2", { org: fixtureIds.organisations.hq, role: fixtureIds.roles.hqAdmin });
    const target = await makeUser("target", { org: fixtureIds.organisations.hq });
    await expect(run(hqOnly, ({ actor, permissions, store }) => assignRole(actor, permissions, audit, store, { userId: target, roleId: fixtureIds.roles.superAdmin, organisationId: fixtureIds.organisations.hq }))).rejects.toBeInstanceOf(AccessEscalationError);
    const ok = await run(hqOnly, ({ actor, permissions, store }) => assignRole(actor, permissions, audit, store, { userId: target, roleId: fixtureIds.roles.hqAdmin, organisationId: fixtureIds.organisations.hq }));
    expect(ok.roleId).toBe(fixtureIds.roles.hqAdmin);
  });

  it("never lets the last administrator be removed, and rolls the change back", async () => {
    const all = await run(root, ({ store }) => store.listAssignments());
    const superAdminAssignments = all.filter((a) => a.roleId === fixtureIds.roles.superAdmin && !a.endsAt);
    expect(superAdminAssignments.length).toBeGreaterThan(0);

    // Revoking every live Super Admin assignment must fail on the last one and leave all of them live.
    for (const a of superAdminAssignments) {
      const attempt = run(root, ({ actor, permissions, store }) => revokeAssignment(actor, permissions, audit, store, a.id));
      if (superAdminAssignments.length === 1) await expect(attempt).rejects.toBeInstanceOf(AdministratorRequiredError);
      else break; // other administrators exist: the guard only bites on the last, covered below by the grant removal
    }

    // Removing roles.manage from the only role that holds it at system scope is refused too.
    const manage = await permissionId("roles", "manage");
    await expect(run(root, ({ actor, permissions, store }) => removeRoleGrant(actor, permissions, audit, store, { roleId: fixtureIds.roles.superAdmin, permissionId: manage, scope: "system" }))).rejects.toBeInstanceOf(AdministratorRequiredError);
    const grants = (await run(root, ({ store }) => store.getRole(fixtureIds.roles.superAdmin)))!.grants;
    expect(grants.some((g) => g.module === "roles" && g.action === "manage" && g.scope === "system")).toBe(true);
    expect((await run(root, ({ store }) => store.listAssignments())).filter((a) => a.roleId === fixtureIds.roles.superAdmin && !a.endsAt).length).toBe(superAdminAssignments.length);
  });

  it("deletes a custom role only once nobody holds it, and never a built-in role", async () => {
    const role = await run(root, ({ actor, permissions, store }) => createRole(actor, permissions, audit, store, { key: `del-${tag}`, name: "Deletable" }));
    roleIds.push(role.id);
    const holder = await makeUser("holder", { org: franchiseOrg });
    const assignment = await run(root, ({ actor, permissions, store }) => assignRole(actor, permissions, audit, store, { userId: holder, roleId: role.id, organisationId: franchiseOrg }));
    await expect(run(root, ({ actor, permissions, store }) => deleteRole(actor, permissions, audit, store, role.id))).rejects.toThrow(/Remove everyone/);
    await run(root, ({ actor, permissions, store }) => revokeAssignment(actor, permissions, audit, store, assignment.id));
    await run(root, ({ actor, permissions, store }) => deleteRole(actor, permissions, audit, store, role.id));
    expect(await run(root, ({ store }) => store.getRole(role.id))).toBeUndefined();
    await expect(run(root, ({ actor, permissions, store }) => deleteRole(actor, permissions, audit, store, fixtureIds.roles.hqAdmin))).rejects.toThrow(/Built-in/);
  });

  it("invites with a role, replaces an earlier pending link, and the invitee gets exactly that access on accepting", async () => {
    const email = `invitee-${tag}@example.com`;
    const first = await run(root, ({ actor, permissions, store }) => inviteUser(actor, permissions, audit, store, { email, organisationId: franchiseOrg, territoryId: sutton, roleId: fixtureIds.roles.franchisee }));
    const second = await run(root, ({ actor, permissions, store }) => inviteUser(actor, permissions, audit, store, { email: email.toUpperCase(), organisationId: franchiseOrg, territoryId: sutton, roleId: fixtureIds.roles.franchisee }));
    expect(second.token).not.toBe(first.token);

    const rows = await db.select().from(authInvitations).where(eq(authInvitations.email, email));
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(1);
    expect(rows.find((row) => row.id === first.invitation.id)!.status).toBe("revoked");
    // Only the hash is stored.
    expect(JSON.stringify(rows)).not.toContain(second.token);
    expect(JSON.stringify(events)).not.toContain(email);

    // The replaced link no longer works; the new one grants the invited role, scoped as invited.
    await expect(db.transaction(async (tx) => acceptInvitation(createDrizzleAuthRepository(tx as unknown as typeof db), createMemoryAuditRecorder(), { token: first.token, email }))).rejects.toThrow(/already been used|no longer valid/);
    const accepted = await db.transaction(async (tx) => acceptInvitation(createDrizzleAuthRepository(tx as unknown as typeof db), createMemoryAuditRecorder(), { token: second.token, email }));
    userIds.push(accepted.user.id);

    const data = await loadPermissionData(db);
    expect(evaluatePermission({ userId: accepted.user.id, module: "system.jobs", action: "view", resource: { territoryId: sutton } }, data).allowed).toBe(true);
    expect(evaluatePermission({ userId: accepted.user.id, module: "system.jobs", action: "view", resource: { territoryId: solihull } }, data).allowed).toBe(false);
    const explanation = await explainAccess({ userId: root }, data, { userId: accepted.user.id, module: "system.jobs", action: "view", territoryId: solihull });
    expect(explanation.allowed).toBe(false);
  });

  it("refuses to invite someone into a role above the inviter, to a foreign territory, with a bad email, or without roles.invite", async () => {
    const hqOnly = await makeUser("hqinv", { org: fixtureIds.organisations.hq, role: fixtureIds.roles.hqAdmin });
    const base = { email: `x-${tag}@example.com`, organisationId: fixtureIds.organisations.hq };
    await expect(run(hqOnly, ({ actor, permissions, store }) => inviteUser(actor, permissions, audit, store, { ...base, roleId: fixtureIds.roles.superAdmin }))).rejects.toBeInstanceOf(AccessEscalationError);
    await expect(run(root, ({ actor, permissions, store }) => inviteUser(actor, permissions, audit, store, { ...base, organisationId: fixtureIds.organisations.hq, territoryId: sutton }))).rejects.toBeInstanceOf(AccessInputError);
    await expect(run(root, ({ actor, permissions, store }) => inviteUser(actor, permissions, audit, store, { ...base, email: "nope" }))).rejects.toBeInstanceOf(AccessInputError);
    await expect(run(fixtureIds.users.franchisee, ({ actor, permissions, store }) => inviteUser(actor, permissions, audit, store, base))).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("revokes a pending invitation once", async () => {
    const { invitation } = await run(root, ({ actor, permissions, store }) => inviteUser(actor, permissions, audit, store, { email: `revoke-${tag}@example.com`, organisationId: franchiseOrg }));
    await run(root, ({ actor, permissions, store }) => revokeInvitationById(actor, permissions, audit, store, invitation.id));
    await expect(run(root, ({ actor, permissions, store }) => revokeInvitationById(actor, permissions, audit, store, invitation.id))).rejects.toThrow(/no longer pending/);
  });
});
