import { fixtureIds } from "@raring2go/db";
import { describe, expect, it } from "vitest";
import { engineHooks, knownHooks } from "./automation-hooks";
import { automationPermissionData, hasAutomationCapability } from "./automation-runtime";
import { requireShellPermission } from "./app-shell";

const hq = { userId: fixtureIds.users.superAdmin };
const sutton = {
  userId: fixtureIds.users.franchisee,
  organisationId: fixtureIds.organisations.franchise,
  territoryId: fixtureIds.territories.suttonColdfield
};

describe("automation permissions", () => {
  it("gives HQ every automation capability network-wide", () => {
    for (const capability of ["taskView", "taskComplete", "approvalView", "approvalDecide", "workflowView", "workflowManage", "workflowActivate", "workflowTest"] as const) {
      expect(hasAutomationCapability(hq, capability)).toBe(true);
    }
  });

  it("lets a franchisee work their own territory's items but never change workflow definitions", () => {
    for (const capability of ["taskView", "taskComplete", "approvalView", "approvalDecide", "workflowView"] as const) {
      expect(hasAutomationCapability(sutton, capability)).toBe(true);
    }
    for (const capability of ["workflowManage", "workflowActivate", "workflowTest"] as const) {
      expect(hasAutomationCapability(sutton, capability)).toBe(false);
    }
  });

  it("grants nothing to unknown users", () => {
    expect(hasAutomationCapability({ userId: "someone-else" }, "taskView")).toBe(false);
    expect(automationPermissionData.rolePermissions.every((entry) => entry.permission.module.startsWith("automation."))).toBe(true);
  });

  it("protects the routes server-side, not just in navigation", async () => {
    const franchisee = { sessionKey: "franchisee", organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
    await expect(requireShellPermission(franchisee, { module: "automation.task", action: "view" })).resolves.toMatchObject({ kind: "authenticated" });
    await expect(requireShellPermission(franchisee, { module: "automation.workflow", action: "manage" })).rejects.toMatchObject({ kind: "unauthorised" });
    await expect(requireShellPermission({}, { module: "automation.task", action: "view" })).rejects.toMatchObject({ kind: "unauthenticated" });
  });
});

describe("engine hooks", () => {
  it("advertises exactly the hooks that exist, so definitions can only reference real ones", () => {
    expect([...knownHooks.actions].sort()).toEqual(Object.keys(engineHooks.actions).sort());
    expect([...knownHooks.guards].sort()).toEqual(Object.keys(engineHooks.guards).sort());
    expect(knownHooks.actions.has("franchise.start_onboarding")).toBe(true);
    expect(knownHooks.guards.has("invoice.still_unpaid")).toBe(true);
  });

  it("refuses to start onboarding for an event with no subject", async () => {
    const hook = engineHooks.actions["franchise.start_onboarding"]!;
    await expect(hook({ run: { subjectId: null } as never, evaluation: {} as never, stepIndex: 0, idempotencyKey: "k", now: new Date() }, {})).rejects.toMatchObject({ code: "no_subject" });
  });
});
