import { auditActions, assertAuditAction } from "@raring2go/audit";
import { describe, expect, it } from "vitest";
import { createPermissionAuditEvent, permissionAuditActions } from "./audit";
import { evaluatePermission } from "./evaluate";
import { requirePermission } from "./guards";
import { canShow, getPermissionSummary } from "./ui";
import type { PermissionData, PermissionRequest, RolePermissionGrant } from "./types";
import { PermissionDeniedError } from "./types";

const now = new Date("2026-08-10T12:00:00.000Z");

const permissions = {
  advertiserView: {
    id: "permission_advertiser_view",
    module: "advertiser",
    action: "view"
  },
  advertiserEdit: {
    id: "permission_advertiser_edit",
    module: "advertiser",
    action: "edit"
  },
  financeView: {
    id: "permission_finance_view",
    module: "finance",
    action: "view"
  }
};

function request(
  overrides: Partial<PermissionRequest> = {}
): PermissionRequest {
  return {
    userId: "user_1",
    module: "advertiser",
    action: "view",
    context: {
      organisationId: "org_1",
      territoryId: "territory_1"
    },
    now,
    ...overrides
  };
}

function data(
  grants: RolePermissionGrant[],
  overrides: Partial<PermissionData> = {}
): PermissionData {
  return {
    roleAssignments: [
      {
        id: "assignment_1",
        userId: "user_1",
        roleId: "role_editable_any_name",
        organisationId: "org_1",
        territoryId: "territory_1"
      }
    ],
    rolePermissions: grants,
    territories: [
      {
        id: "territory_1",
        franchiseOrganisationId: "org_1",
        status: "active"
      },
      {
        id: "territory_2",
        franchiseOrganisationId: "org_2",
        status: "active"
      }
    ],
    ...overrides
  };
}

function grant(
  scope: string,
  overrides: Partial<RolePermissionGrant> = {}
): RolePermissionGrant {
  return {
    roleId: "role_editable_any_name",
    permission: permissions.advertiserView,
    scope,
    constraints: {},
    ...overrides
  };
}

describe("evaluatePermission", () => {
  it("denies by default", () => {
    expect(evaluatePermission(request(), data([]))).toMatchObject({
      allowed: false,
      reason: "default_deny"
    });
  });

  it("requires exact module/action matching", () => {
    const decision = evaluatePermission(
      request({
        action: "edit"
      }),
      data([grant("territory")])
    );

    expect(decision).toMatchObject({
      allowed: false,
      reason: "default_deny"
    });
  });

  it("does not let broader scope grant unassigned actions", () => {
    const decision = evaluatePermission(
      request({
        action: "edit"
      }),
      data([grant("network")])
    );

    expect(decision.allowed).toBe(false);
  });

  it("allows matching organisation scope and rejects other organisations", () => {
    expect(
      evaluatePermission(
        request({
          context: {
            organisationId: "org_1"
          }
        }),
        data([grant("organisation")])
      )
    ).toMatchObject({
      allowed: true,
      reason: "granted"
    });

    expect(
      evaluatePermission(
        request({
          context: {
            organisationId: "org_2"
          }
        }),
        data([grant("organisation")])
      )
    ).toMatchObject({
      allowed: false,
      reason: "scope_mismatch"
    });
  });

  it("allows matching territory scope and rejects other territories", () => {
    expect(evaluatePermission(request(), data([grant("territory")]))).toMatchObject({
      allowed: true
    });

    expect(
      evaluatePermission(
        request({
          context: {
            organisationId: "org_2",
            territoryId: "territory_2"
          }
        }),
        data([grant("territory")])
      )
    ).toMatchObject({
      allowed: false,
      reason: "scope_mismatch"
    });
  });

  it("fails closed for invalid territory and organisation relationships", () => {
    expect(
      evaluatePermission(
        request({
          context: {
            organisationId: "org_1",
            territoryId: "territory_2"
          }
        }),
        data([grant("network")])
      )
    ).toMatchObject({
      allowed: false,
      reason: "territory_organisation_mismatch"
    });
  });

  it("supports network and system scope for the same module/action only", () => {
    expect(evaluatePermission(request(), data([grant("network")]))).toMatchObject({
      allowed: true
    });

    expect(
      evaluatePermission(
        request({
          action: "edit"
        }),
        data([grant("system")])
      )
    ).toMatchObject({
      allowed: false,
      reason: "default_deny"
    });
  });

  it("combines multiple roles without depending on role names", () => {
    const decision = evaluatePermission(
      request({
        module: "finance",
        action: "view"
      }),
      data(
        [
          grant("territory"),
          grant("organisation", {
            roleId: "role_created_later_with_any_label",
            permission: permissions.financeView
          })
        ],
        {
          roleAssignments: [
            {
              id: "assignment_1",
              userId: "user_1",
              roleId: "role_editable_any_name",
              organisationId: "org_1",
              territoryId: "territory_1"
            },
            {
              id: "assignment_2",
              userId: "user_1",
              roleId: "role_created_later_with_any_label",
              organisationId: "org_1"
            }
          ]
        }
      )
    );

    expect(decision).toMatchObject({
      allowed: true,
      matchedGrant: {
        roleId: "role_created_later_with_any_label"
      }
    });
  });

  it("denies expired assignments", () => {
    const decision = evaluatePermission(
      request(),
      data([grant("territory")], {
        roleAssignments: [
          {
            id: "assignment_expired",
            userId: "user_1",
            roleId: "role_editable_any_name",
            organisationId: "org_1",
            territoryId: "territory_1",
            endsAt: new Date("2026-08-09T00:00:00.000Z")
          }
        ]
      })
    );

    expect(decision).toMatchObject({
      allowed: false,
      reason: "assignment_expired"
    });
  });

  it("supports active delegations and denies expired delegations", () => {
    const delegatedGrant = grant("organisation", {
      roleId: "delegated:user_owner"
    });

    expect(
      evaluatePermission(
        request({
          userId: "user_delegate",
          context: {
            organisationId: "org_1"
          }
        }),
        data([delegatedGrant], {
          roleAssignments: [],
          delegations: [
            {
              id: "delegation_1",
              fromUserId: "user_owner",
              toUserId: "user_delegate",
              organisationId: "org_1",
              startsAt: new Date("2026-08-09T00:00:00.000Z"),
              endsAt: new Date("2026-08-11T00:00:00.000Z")
            }
          ]
        })
      )
    ).toMatchObject({
      allowed: true
    });

    expect(
      evaluatePermission(
        request({
          userId: "user_delegate",
          context: {
            organisationId: "org_1"
          }
        }),
        data([delegatedGrant], {
          roleAssignments: [],
          delegations: [
            {
              id: "delegation_expired",
              fromUserId: "user_owner",
              toUserId: "user_delegate",
              organisationId: "org_1",
              startsAt: new Date("2026-08-01T00:00:00.000Z"),
              endsAt: new Date("2026-08-02T00:00:00.000Z")
            }
          ]
        })
      )
    ).toMatchObject({
      allowed: false,
      reason: "default_deny"
    });
  });

  it("fails closed for unknown scope and malformed constraints", () => {
    expect(evaluatePermission(request(), data([grant("galaxy")]))).toMatchObject({
      allowed: false,
      reason: "unknown_scope"
    });

    expect(
      evaluatePermission(
        request(),
        data([
          grant("territory", {
            constraints: {
              domainWorkflowRule: "not-authorisation"
            }
          })
        ])
      )
    ).toMatchObject({
      allowed: false,
      reason: "malformed_constraints"
    });
  });

  it("supports ownership and field visibility constraints", () => {
    const decision = evaluatePermission(
      request({
        resource: {
          ownerUserId: "user_1",
          fields: ["name", "email"]
        }
      }),
      data([
        grant("own_record", {
          constraints: {
            requireResourceOwner: true,
            visibleFields: ["name"]
          }
        })
      ])
    );

    expect(decision).toMatchObject({
      allowed: true,
      visibleFields: ["name"]
    });

    expect(
      evaluatePermission(
        request({
          resource: {
            ownerUserId: "someone_else"
          }
        }),
        data([
          grant("own_record", {
            constraints: {
              requireResourceOwner: true
            }
          })
        ])
      )
    ).toMatchObject({
      allowed: false
    });
  });

  it("rejects cross-tenant territory constraints", () => {
    expect(
      evaluatePermission(
        request({
          context: {
            organisationId: "org_1",
            territoryId: "territory_1"
          }
        }),
        data([
          grant("territory", {
            constraints: {
              deniedTerritoryIds: ["territory_1"]
            }
          })
        ])
      )
    ).toMatchObject({
      allowed: false,
      reason: "constraint_failed"
    });
  });

  it("throws from server guard on denial", () => {
    expect(() => requirePermission(request(), data([]))).toThrow(
      PermissionDeniedError
    );
  });

  it("returns explainable decisions without sensitive data", () => {
    const decision = evaluatePermission(request(), data([]));

    expect(decision).toMatchObject({
      allowed: false,
      reason: "default_deny"
    });
    expect(decision.explanation).toContain("No permission grant");
    expect(JSON.stringify(decision)).not.toContain("role_editable_any_name");
  });

  it("uses the same evaluator for UI helpers", () => {
    const permissionData = data([grant("territory")]);
    const permissionRequest = request();

    expect(canShow(permissionRequest, permissionData)).toBe(true);
    expect(getPermissionSummary(permissionRequest, permissionData)).toEqual(
      evaluatePermission(permissionRequest, permissionData)
    );
  });

  it("validates permission audit action names", () => {
    expect(() => assertAuditAction(auditActions.permissionRoleUpdate)).not.toThrow();
    expect(() =>
      assertAuditAction(auditActions.permissionDelegationRevoke)
    ).not.toThrow();
  });

  it("creates neutral permission audit events for future role management", () => {
    expect(
      createPermissionAuditEvent({
        action: permissionAuditActions.assignmentCreate,
        actor: {
          type: "human",
          userId: "user_hq"
        },
        entityType: "role_assignment",
        entityId: "assignment_1",
        scope: {
          organisationId: "org_1",
          territoryId: "territory_1"
        },
        metadata: {
          reason: "invite_acceptance"
        }
      })
    ).toMatchObject({
      action: auditActions.permissionAssignmentCreate,
      entity: {
        type: "role_assignment",
        id: "assignment_1"
      },
      scope: {
        organisationId: "org_1",
        territoryId: "territory_1"
      }
    });
  });
});
