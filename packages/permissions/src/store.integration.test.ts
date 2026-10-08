import { randomUUID } from "node:crypto";
import { createDb, fixtureIds, fixturePermissionData, permissions as permissionsTable, rolePermissions, roles, userRoleAssignments } from "@raring2go/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { evaluatePermission } from "./evaluate";
import { loadPermissionData } from "./store";

/** Reads the real seeded tables. `RUN_DB_TESTS=1 pnpm --filter @raring2go/permissions test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("loadPermissionData (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const created = { roleIds: [] as string[], assignmentIds: [] as string[] };

  afterAll(async () => {
    for (const id of created.assignmentIds) await db.delete(userRoleAssignments).where(eq(userRoleAssignments.id, id));
    for (const id of created.roleIds) {
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      await db.delete(roles).where(eq(roles.id, id));
    }
    await sql.end();
  });

  it("returns every seeded grant and assignment, so the database is what the application enforces", async () => {
    const loaded = await loadPermissionData(db);
    const fixture = fixturePermissionData();
    const key = (g: { roleId: string; permission: { module: string; action: string }; scope: string }) => `${g.roleId}|${g.permission.module}.${g.permission.action}|${g.scope}`;
    const have = new Set(loaded.rolePermissions.map(key));
    for (const grant of fixture.rolePermissions) expect(have.has(key(grant)), key(grant)).toBe(true);

    const assigned = new Set(loaded.roleAssignments.map((a) => `${a.userId}|${a.roleId}|${a.organisationId ?? ""}|${a.territoryId ?? ""}`));
    for (const a of fixture.roleAssignments) expect(assigned.has(`${a.userId}|${a.roleId}|${a.organisationId ?? ""}|${a.territoryId ?? ""}`)).toBe(true);
    expect(loaded.territories!.length).toBeGreaterThanOrEqual(2);
  });

  it("makes decisions the evaluator honours, from database rows alone", async () => {
    const data = await loadPermissionData(db);
    const sutton = fixtureIds.territories.suttonColdfield;
    expect(evaluatePermission({ userId: fixtureIds.users.franchisee, module: "system.jobs", action: "view", resource: { territoryId: sutton } }, data).allowed).toBe(true);
    expect(evaluatePermission({ userId: fixtureIds.users.franchisee, module: "system.jobs", action: "view", resource: { territoryId: fixtureIds.territories.solihull } }, data).allowed).toBe(false);
    expect(evaluatePermission({ userId: fixtureIds.users.superAdmin, module: "roles", action: "view" }, data).allowed).toBe(true);
  });

  it("a role assignment added in the database takes effect, a soft-deleted role grants nothing, and an expired assignment is ignored", async () => {
    const [permission] = await db.select().from(permissionsTable).where(eq(permissionsTable.id, fixtureIds.permissions.jobsView));
    const [role] = await db.insert(roles).values({ key: `itest-${tag}`, name: `Integration ${tag}` }).returning();
    created.roleIds.push(role!.id);
    await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: permission!.id, scope: "own_territory", constraints: {} });
    const user = fixtureIds.users.workflowAutomation; // any existing user id works: nobody has this role yet
    const [live] = await db.insert(userRoleAssignments).values({ userId: user, roleId: role!.id, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield }).returning();
    created.assignmentIds.push(live!.id);

    const ask = (data: Awaited<ReturnType<typeof loadPermissionData>>, territoryId: string) =>
      evaluatePermission({ userId: user, module: "system.jobs", action: "view", resource: { territoryId } }, data).allowed;

    let data = await loadPermissionData(db);
    expect(ask(data, fixtureIds.territories.suttonColdfield)).toBe(true);
    expect(ask(data, fixtureIds.territories.solihull)).toBe(false);

    await db.update(roles).set({ deletedAt: new Date() }).where(eq(roles.id, role!.id));
    data = await loadPermissionData(db);
    expect(ask(data, fixtureIds.territories.suttonColdfield)).toBe(false);

    await db.update(roles).set({ deletedAt: null }).where(eq(roles.id, role!.id));
    await db.update(userRoleAssignments).set({ endsAt: new Date(Date.now() - 60_000) }).where(eq(userRoleAssignments.id, live!.id));
    data = await loadPermissionData(db);
    expect(ask(data, fixtureIds.territories.suttonColdfield)).toBe(false);
  });
});
