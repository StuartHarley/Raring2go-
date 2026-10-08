import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it } from "vitest";
import { AccessEscalationError, administratorRemains, isSystemAdministrator, AdministratorRequiredError, assertAdministratorRemains, assertCanAssignRole, assertCanGrantScope, maxScopeRank, scopeRank } from "./guards";

const perm = (module: string, action: string) => ({ id: `${module}.${action}`, module, action });
const grant = (roleId: string, module: string, action: string, scope: string) => ({ roleId, permission: perm(module, action), scope, constraints: {} });

const ORG_A = "org-a";
const ORG_B = "org-b";
const T1 = "t1";
const T2 = "t2";

const data: PermissionData = {
  roleAssignments: [
    { id: "a1", userId: "root", roleId: "super", organisationId: "hq" },
    { id: "a2", userId: "hq", roleId: "hq_admin", organisationId: "hq" },
    { id: "a3", userId: "owner", roleId: "owner", organisationId: ORG_A, territoryId: T1 },
    { id: "a4", userId: "expired", roleId: "super", organisationId: "hq", endsAt: new Date("2020-01-01") }
  ],
  rolePermissions: [
    grant("super", "roles", "manage", "system"),
    grant("super", "system", "administer", "system"),
    grant("super", "content", "edit", "system"),
    grant("hq_admin", "content", "edit", "network"),
    grant("hq_admin", "roles", "assign", "network"),
    grant("owner", "content", "edit", "own_territory"),
    grant("owner", "roles", "assign", "own_territory"),
    // roles that can be handed out
    grant("editor", "content", "edit", "own_territory"),
    grant("network_editor", "content", "edit", "network"),
    grant("system_editor", "content", "edit", "system"),
    grant("empty", "nothing", "here", "own_territory"),
    grant("reviewer", "content", "approve", "own_territory")
  ],
  territories: [
    { id: T1, franchiseOrganisationId: ORG_A, status: "active" },
    { id: T2, franchiseOrganisationId: ORG_B, status: "active" }
  ]
};
const now = new Date("2026-10-08T00:00:00Z");

describe("scope ordering", () => {
  it("ranks reach from own record up to system, and treats unknown scopes as unreachable", () => {
    expect(scopeRank("own_record")).toBeLessThan(scopeRank("own_organisation"));
    expect(scopeRank("own_organisation")).toBeLessThan(scopeRank("own_territory"));
    expect(scopeRank("own_territory")).toBeLessThan(scopeRank("network"));
    expect(scopeRank("network")).toBeLessThan(scopeRank("system"));
    expect(scopeRank("galaxy")).toBe(Number.POSITIVE_INFINITY);
  });

  it("finds the widest scope someone holds, ignoring expired assignments", () => {
    expect(maxScopeRank(data, "root", "content", "edit", now)).toBe(scopeRank("system"));
    expect(maxScopeRank(data, "hq", "content", "edit", now)).toBe(scopeRank("network"));
    expect(maxScopeRank(data, "owner", "content", "edit", now)).toBe(scopeRank("own_territory"));
    expect(maxScopeRank(data, "owner", "content", "approve", now)).toBe(-1);
    expect(maxScopeRank(data, "expired", "content", "edit", now)).toBe(-1);
    expect(maxScopeRank(data, "nobody", "content", "edit", now)).toBe(-1);
  });
});

describe("editing a role's grants", () => {
  it("lets someone add a grant no wider than they hold, and refuses anything wider or unheld", () => {
    expect(() => assertCanGrantScope(data, "owner", { module: "content", action: "edit", scope: "own_territory" }, now)).not.toThrow();
    expect(() => assertCanGrantScope(data, "owner", { module: "content", action: "edit", scope: "network" }, now)).toThrow(AccessEscalationError);
    expect(() => assertCanGrantScope(data, "owner", { module: "content", action: "approve", scope: "own_territory" }, now)).toThrow(AccessEscalationError);
    expect(() => assertCanGrantScope(data, "hq", { module: "content", action: "edit", scope: "system" }, now)).toThrow(AccessEscalationError);
    expect(() => assertCanGrantScope(data, "root", { module: "content", action: "edit", scope: "system" }, now)).not.toThrow();
  });
});

describe("giving someone a role", () => {
  it("allows a role whose grants the actor holds on that same organisation and territory", () => {
    expect(() => assertCanAssignRole(data, "owner", "editor", { organisationId: ORG_A, territoryId: T1 }, now)).not.toThrow();
    expect(() => assertCanAssignRole(data, "hq", "editor", { organisationId: ORG_A, territoryId: T1 }, now)).not.toThrow();
  });

  it("refuses a role carrying a capability the actor does not hold", () => {
    expect(() => assertCanAssignRole(data, "owner", "reviewer", { organisationId: ORG_A, territoryId: T1 }, now)).toThrow(AccessEscalationError);
    expect(() => assertCanAssignRole(data, "owner", "empty", { organisationId: ORG_A, territoryId: T1 }, now)).toThrow(/nothing\.here/);
  });

  it("refuses to hand out a role on a territory the actor does not govern", () => {
    expect(() => assertCanAssignRole(data, "owner", "editor", { organisationId: ORG_B, territoryId: T2 }, now)).toThrow(AccessEscalationError);
    expect(() => assertCanAssignRole(data, "owner", "editor", { organisationId: ORG_A }, now)).toThrow(AccessEscalationError);
  });

  it("refuses to hand out a wider scope than the actor holds, even on a target they can act on", () => {
    // owner holds content.edit only at own_territory: a network-scope role is wider.
    expect(() => assertCanAssignRole(data, "owner", "network_editor", { organisationId: ORG_A, territoryId: T1 }, now)).toThrow(AccessEscalationError);
    // hq holds network: a system-scope role is wider, so a network administrator cannot mint a system one.
    expect(() => assertCanAssignRole(data, "hq", "system_editor", { organisationId: ORG_A, territoryId: T1 }, now)).toThrow(AccessEscalationError);
    expect(() => assertCanAssignRole(data, "root", "system_editor", { organisationId: "hq" }, now)).not.toThrow();
  });

  it("exempts a system administrator from holding each capability personally, but nobody else", () => {
    // root holds roles.manage at system, but has no "content.approve" or "nothing.here" of their own.
    expect(() => assertCanAssignRole(data, "root", "reviewer", { organisationId: ORG_A, territoryId: T1 }, now)).not.toThrow();
    expect(() => assertCanAssignRole(data, "root", "empty", { organisationId: ORG_A, territoryId: T1 }, now)).not.toThrow();
    expect(() => assertCanGrantScope(data, "root", { module: "anything", action: "at-all", scope: "system" }, now)).not.toThrow();
    expect(isSystemAdministrator(data, "root", now)).toBe(true);
    expect(isSystemAdministrator(data, "hq", now)).toBe(false);
    expect(isSystemAdministrator(data, "expired", now)).toBe(false);
  });

  it("stops a network administrator assigning the Super Admin role", () => {
    expect(() => assertCanAssignRole(data, "hq", "super", { organisationId: "hq" }, now)).toThrow(AccessEscalationError);
    expect(() => assertCanAssignRole(data, "root", "super", { organisationId: "hq" }, now)).not.toThrow();
  });

  it("refuses everything for someone with no live access, and an expired administrator", () => {
    expect(() => assertCanAssignRole(data, "nobody", "editor", { organisationId: ORG_A, territoryId: T1 }, now)).toThrow(AccessEscalationError);
    expect(() => assertCanAssignRole(data, "expired", "editor", { organisationId: ORG_A, territoryId: T1 }, now)).toThrow(AccessEscalationError);
  });

  it("allows a role with no grants (it confers nothing)", () => {
    expect(() => assertCanAssignRole(data, "owner", "role-without-grants", { organisationId: ORG_A, territoryId: T1 }, now)).not.toThrow();
  });
});

describe("keeping an administrator", () => {
  it("is satisfied while a live administrator exists and fails once the last one is excluded or expired", () => {
    expect(administratorRemains(data, new Set(), now)).toBe(true);
    expect(administratorRemains(data, new Set(["root"]), now)).toBe(false);
    expect(() => assertAdministratorRemains(data, new Set(["root"]), now)).toThrow(AdministratorRequiredError);
    expect(administratorRemains({ ...data, roleAssignments: data.roleAssignments.filter((a) => a.userId !== "root") }, new Set(), now)).toBe(false);
  });

  it("does not count network-level role management as administration", () => {
    const networkOnly: PermissionData = { ...data, rolePermissions: data.rolePermissions.map((g) => (g.roleId === "super" && g.permission.action === "manage" ? { ...g, scope: "network" } : g)) };
    expect(administratorRemains(networkOnly, new Set(), now)).toBe(false);
  });
});
