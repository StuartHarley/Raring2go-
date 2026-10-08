import { fixtureIds } from "@raring2go/db";
import { describe, expect, it } from "vitest";
import { buildJobRegistry, registeredJobKinds } from "./jobs-runtime";
import { can, privacyPermissionData } from "./privacy-runtime";
import { ENFORCE_RETENTION_KIND } from "./security-runtime";

const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };

describe("privacy runtime permissions", () => {
  it("gives Head Office every privacy capability", () => {
    for (const capability of ["view", "create", "decide", "export"] as const) expect(can(hq, capability)).toBe(true);
  });

  it("gives franchisees and advertisers none, because subscribers are shared across territories", () => {
    for (const capability of ["view", "create", "decide", "export"] as const) {
      expect(can(sutton, capability)).toBe(false);
      expect(can({ userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser }, capability)).toBe(false);
    }
    expect(privacyPermissionData.rolePermissions.every((grant) => grant.permission.module === "privacy.request" && grant.scope === "network")).toBe(true);
  });

  it("registers the retention job so it runs from the worker tick and can be retried", () => {
    expect(registeredJobKinds).toContain(ENFORCE_RETENTION_KIND);
    expect([...buildJobRegistry({} as never).kinds()]).toContain(ENFORCE_RETENTION_KIND);
  });
});
