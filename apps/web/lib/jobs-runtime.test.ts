import { fixtureIds } from "@raring2go/db";
import { describe, expect, it } from "vitest";
import { buildJobRegistry, hasJobCapability, jobsPermissionData, registeredJobKinds } from "./jobs-runtime";

const hq = { userId: fixtureIds.users.superAdmin };
const sutton = {
  userId: fixtureIds.users.franchisee,
  organisationId: fixtureIds.organisations.franchise,
  territoryId: fixtureIds.territories.suttonColdfield
};

describe("job runtime permissions", () => {
  it("keeps registeredJobKinds in step with the real registry", () => {
    // The registry only touches the db inside handlers, so a stub is safe for listing kinds.
    expect([...buildJobRegistry({} as never).kinds()].sort()).toEqual([...registeredJobKinds].sort());
  });

  it("gives HQ network-wide view, retry and cancel", () => {
    for (const capability of ["view", "retry", "cancel"] as const) {
      expect(hasJobCapability(hq, capability, { territoryId: fixtureIds.territories.solihull })).toBe(true);
      expect(hasJobCapability(hq, capability, { territoryId: null })).toBe(true);
    }
  });

  it("limits a franchisee to viewing their own territory's jobs", () => {
    expect(hasJobCapability(sutton, "view", { territoryId: fixtureIds.territories.suttonColdfield })).toBe(true);
    expect(hasJobCapability(sutton, "view", { territoryId: fixtureIds.territories.solihull })).toBe(false);
    expect(hasJobCapability(sutton, "view", { territoryId: null })).toBe(false);
    expect(hasJobCapability(sutton, "retry", { territoryId: fixtureIds.territories.suttonColdfield })).toBe(false);
    expect(hasJobCapability(sutton, "cancel", { territoryId: fixtureIds.territories.suttonColdfield })).toBe(false);
  });

  it("denies unknown users everything", () => {
    expect(hasJobCapability({ userId: "someone-else" }, "view", { territoryId: null })).toBe(false);
    expect(jobsPermissionData.rolePermissions.every((grant) => grant.permission.module === "system.jobs")).toBe(true);
  });
});
