import { fixtureIds, fixturePermissionData } from "@raring2go/db";
import { describe, expect, it } from "vitest";
import { buildJobRegistry, registeredJobKinds } from "./jobs-runtime";
import { can } from "./privacy-runtime";
import { ENFORCE_RETENTION_KIND } from "./security-runtime";

const permissions = fixturePermissionData();
const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };

describe("privacy runtime permissions", () => {
  it("gives Head Office every privacy capability", () => {
    for (const capability of ["view", "create", "decide", "export"] as const) expect(can(permissions, hq, capability)).toBe(true);
  });

  it("gives franchisees and advertisers none, because subscribers are shared across territories", () => {
    for (const capability of ["view", "create", "decide", "export"] as const) {
      expect(can(permissions, sutton, capability)).toBe(false);
      expect(can(permissions, { userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser }, capability)).toBe(false);
    }
  });

  it("registers the retention job so it runs from the worker tick and can be retried", () => {
    expect(registeredJobKinds).toContain(ENFORCE_RETENTION_KIND);
    expect([...buildJobRegistry({} as never).kinds()]).toContain(ENFORCE_RETENTION_KIND);
  });
});
