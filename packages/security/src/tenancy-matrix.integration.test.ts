import { createDb, fixtureIds, permissions, rolePermissions, roles } from "@raring2go/db";
import { evaluatePermission, loadPermissionData } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Cross-tenant isolation, checked against the RBAC data in Postgres as loaded by the production
 * loader (not a hand-written fixture), so a seed or admin change that widens a role is caught here.
 * `RUN_DB_TESTS=1 pnpm --filter @raring2go/security test`
 */
describe.skipIf(!process.env.RUN_DB_TESTS)("tenant isolation matrix (seeded RBAC)", () => {
  const { db, sql } = createDb();
  let data: PermissionData;
  let grants: Array<{ roleId: string; roleKey: string; module: string; action: string; scope: string }> = [];

  beforeAll(async () => {
    // The production loader, so the matrix tests exactly what the application enforces.
    data = await loadPermissionData(db);
    const grantRows = await db
      .select({ roleId: roles.id, roleKey: roles.key, module: permissions.module, action: permissions.action, scope: rolePermissions.scope })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(isNull(roles.deletedAt));
    grants = grantRows;
  });

  afterAll(async () => {
    await sql.end();
  });

  const sutton = fixtureIds.territories.suttonColdfield;
  const solihull = fixtureIds.territories.solihull;
  const franchisee = fixtureIds.users.franchisee;
  const advertiser = fixtureIds.users.advertiserUser;

  const decide = (userId: string, module: string, action: string, request: { territoryId?: string; organisationId?: string } = {}) =>
    evaluatePermission({ userId, module, action, resource: request }, data);

  it("loaded real seeded data to test against", () => {
    expect(data.rolePermissions.length).toBeGreaterThan(50);
    expect(data.roleAssignments.some((assignment) => assignment.userId === franchisee)).toBe(true);
    expect(data.territories!.length).toBeGreaterThanOrEqual(2);
  });

  it("never gives a franchisee or advertiser role network or system scope", () => {
    for (const grant of grants.filter((entry) => entry.roleId === fixtureIds.roles.franchisee)) {
      expect(["own_territory", "own_organisation", "own_record"], `franchisee ${grant.module}.${grant.action}`).toContain(grant.scope);
    }
    for (const grant of grants.filter((entry) => entry.roleId === fixtureIds.roles.advertiser)) {
      expect(["own_organisation", "own_record"], `advertiser ${grant.module}.${grant.action}`).toContain(grant.scope);
    }
  });

  it("limits system scope to Super Admin roles (including the UAT copy)", () => {
    const system = grants.filter((entry) => entry.scope === "system");
    expect(system.length).toBeGreaterThan(0);
    for (const grant of system) {
      expect(grant.roleKey, `${grant.module}.${grant.action}`).toMatch(/super[-_]admin$/);
    }
  });

  it("lets a franchisee use every territory grant on their own territory and none on another territory", () => {
    const own = grants.filter((entry) => entry.roleId === fixtureIds.roles.franchisee && entry.scope === "own_territory");
    expect(own.length).toBeGreaterThan(10);
    for (const grant of own) {
      expect(decide(franchisee, grant.module, grant.action, { territoryId: sutton }).allowed, `own ${grant.module}.${grant.action}`).toBe(true);
      expect(decide(franchisee, grant.module, grant.action, { territoryId: solihull }).allowed, `other ${grant.module}.${grant.action}`).toBe(false);
    }
  });

  it("denies a franchisee every permission on a resource with no territory (nothing is network-wide to them)", () => {
    for (const grant of grants.filter((entry) => entry.roleId === fixtureIds.roles.franchisee && entry.scope === "own_territory")) {
      expect(decide(franchisee, grant.module, grant.action).allowed, `unscoped ${grant.module}.${grant.action}`).toBe(false);
    }
  });

  it("keeps Head Office functions out of reach of franchisees and advertisers, whatever they ask for", () => {
    const headOfficeOnly = grants.filter((entry) => entry.roleId !== fixtureIds.roles.franchisee && entry.roleId !== fixtureIds.roles.advertiser && (entry.scope === "network" || entry.scope === "system"));
    expect(headOfficeOnly.length).toBeGreaterThan(20);
    for (const grant of headOfficeOnly) {
      for (const territoryId of [sutton, solihull, undefined]) {
        const request = territoryId ? { territoryId } : {};
        const owned = grants.some((entry) => entry.roleId === fixtureIds.roles.franchisee && entry.module === grant.module && entry.action === grant.action);
        if (owned) continue; // a permission the franchisee legitimately holds on their own territory is covered above
        expect(decide(franchisee, grant.module, grant.action, request).allowed, `franchisee ${grant.module}.${grant.action} @${territoryId ?? "none"}`).toBe(false);
      }
      expect(decide(advertiser, grant.module, grant.action).allowed, `advertiser ${grant.module}.${grant.action}`).toBe(false);
    }
  });

  it("confines an advertiser to the portal for their own organisation", () => {
    for (const grant of grants.filter((entry) => entry.roleId === fixtureIds.roles.advertiser)) {
      expect(decide(advertiser, grant.module, grant.action, { organisationId: fixtureIds.organisations.advertiser }).allowed, `own org ${grant.module}.${grant.action}`).toBe(true);
      expect(decide(advertiser, grant.module, grant.action, { organisationId: fixtureIds.organisations.hq }).allowed, `HQ org ${grant.module}.${grant.action}`).toBe(false);
      expect(decide(advertiser, grant.module, grant.action, { organisationId: fixtureIds.organisations.franchise }).allowed, `franchise org ${grant.module}.${grant.action}`).toBe(false);
      expect(decide(advertiser, grant.module, grant.action, { territoryId: sutton }).allowed, `territory ${grant.module}.${grant.action}`).toBe(false);
    }
  });

  it("denies an unknown user everything", () => {
    for (const grant of grants.slice(0, 80)) {
      expect(decide("00000000-0000-4000-8000-0000deadbeef", grant.module, grant.action, { territoryId: sutton }).allowed).toBe(false);
    }
  });

  it("lets a franchisee decide AI runs only for their own territory (by design: they approve their own drafts)", () => {
    expect(decide(franchisee, "ai.run", "decide", { territoryId: sutton }).allowed).toBe(true);
    expect(decide(franchisee, "ai.run", "decide", { territoryId: solihull }).allowed).toBe(false);
    expect(decide(advertiser, "ai.run", "decide", { organisationId: fixtureIds.organisations.advertiser }).allowed).toBe(false);
  });

  it("protects the privileged modules explicitly", () => {
    const privileged: Array<[string, string]> = [
      ["system", "administer"], ["roles", "view"], ["system.jobs", "retry"], ["system.jobs", "cancel"], ["automation.workflow", "manage"], ["automation.workflow", "activate"],
      ["analytics.health_config", "manage"], ["analytics.snapshot", "generate"], ["privacy.request", "view"], ["privacy.request", "create"], ["privacy.request", "decide"], ["privacy.request", "export"]
    ];
    for (const [module, action] of privileged) {
      for (const userId of [franchisee, advertiser]) {
        for (const resource of [{}, { territoryId: sutton }, { territoryId: solihull }, { organisationId: fixtureIds.organisations.hq }]) {
          expect(decide(userId, module, action, resource).allowed, `${module}.${action}`).toBe(false);
        }
      }
    }
  });
});
