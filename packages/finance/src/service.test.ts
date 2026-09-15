import { describe, expect, it } from "vitest";
import {
  addRoyaltyAdjustment,
  approveRoyaltyStatement,
  generateRoyaltyStatement,
  getFranchiseRoyaltyStatements,
  submitRoyaltyStatementForApproval,
  upsertRoyaltyRule
} from "./service";
import type { FinanceData } from "./types";
import type { PermissionData } from "@raring2go/permissions";

const ids = {
  users: {
    hq: "user_hq",
    franchisee: "user_franchisee",
    otherFranchisee: "user_other_franchisee"
  },
  organisations: {
    hq: "org_hq",
    franchise: "org_franchise",
    other: "org_other"
  },
  territories: {
    own: "territory_own",
    other: "territory_other"
  },
  roles: {
    hq: "role_hq",
    franchisee: "role_franchisee",
    otherFranchisee: "role_other_franchisee"
  },
  franchises: {
    own: "franchise_own",
    other: "franchise_other"
  }
} as const;

const permissionData: PermissionData = {
  roleAssignments: [
    { id: "assignment_hq", userId: ids.users.hq, roleId: ids.roles.hq, organisationId: ids.organisations.hq },
    {
      id: "assignment_franchisee",
      userId: ids.users.franchisee,
      roleId: ids.roles.franchisee,
      organisationId: ids.organisations.franchise,
      territoryId: ids.territories.own
    },
    {
      id: "assignment_other_franchisee",
      userId: ids.users.otherFranchisee,
      roleId: ids.roles.otherFranchisee,
      organisationId: ids.organisations.other,
      territoryId: ids.territories.other
    }
  ],
  rolePermissions: [
    grant(ids.roles.hq, "finance.royalty_rule", "manage", "network"),
    grant(ids.roles.hq, "finance.royalty_rule", "view", "network"),
    grant(ids.roles.hq, "finance.royalty_statement", "view", "network"),
    grant(ids.roles.hq, "finance.royalty_statement", "generate", "network"),
    grant(ids.roles.hq, "finance.royalty_statement", "adjust", "network"),
    grant(ids.roles.hq, "finance.royalty_statement", "submit", "network"),
    grant(ids.roles.hq, "finance.royalty_statement", "approve", "network"),
    grant(ids.roles.franchisee, "finance.royalty_statement", "view", "own_territory"),
    grant(ids.roles.otherFranchisee, "finance.royalty_statement", "view", "own_territory")
  ],
  territories: [
    { id: ids.territories.own, franchiseOrganisationId: ids.organisations.franchise },
    { id: ids.territories.other, franchiseOrganisationId: ids.organisations.other }
  ]
};

function grant(roleId: string, module: string, action: string, scope: string) {
  return {
    roleId,
    permission: { id: `${roleId}_${module}_${action}`, module, action },
    scope
  };
}

function data(): FinanceData {
  return {
    franchises: [
      { id: ids.franchises.own, franchiseOrganisationId: ids.organisations.franchise, primaryTerritoryId: ids.territories.own, status: "active" },
      { id: ids.franchises.other, franchiseOrganisationId: ids.organisations.other, primaryTerritoryId: ids.territories.other, status: "active" }
    ],
    territories: [
      { id: ids.territories.own, franchiseOrganisationId: ids.organisations.franchise },
      { id: ids.territories.other, franchiseOrganisationId: ids.organisations.other }
    ],
    invoices: [
      {
        id: "invoice_1",
        issuerOrganisationId: ids.organisations.franchise,
        territoryId: ids.territories.own,
        status: "issued",
        issueDate: "2026-01-10",
        subtotalMinor: 10000,
        totalMinor: 12000
      },
      {
        id: "invoice_outside_period",
        issuerOrganisationId: ids.organisations.franchise,
        territoryId: ids.territories.own,
        status: "issued",
        issueDate: "2026-03-01",
        subtotalMinor: 5000,
        totalMinor: 6000
      }
    ],
    paymentAllocations: [
      {
        id: "allocation_1",
        invoiceId: "invoice_1",
        amountMinor: 12000,
        allocatedAt: "2026-01-15",
        status: "allocated"
      }
    ],
    royaltyRules: [],
    statementSequences: [],
    royaltyStatements: [],
    royaltyLines: [],
    royaltyAdjustments: []
  };
}

function audit() {
  return {
    events: [] as Array<{ action: string }>,
    async record(event: { action: string }) {
      this.events.push(event);
    }
  };
}

const hqContext = { userId: ids.users.hq, organisationId: ids.organisations.hq };
const franchiseeContext = {
  userId: ids.users.franchisee,
  organisationId: ids.organisations.franchise,
  territoryId: ids.territories.own
};

async function withActiveRule(financeData: FinanceData, overrides?: Partial<Parameters<typeof upsertRoyaltyRule>[4]>) {
  return upsertRoyaltyRule(hqContext, permissionData, audit(), financeData, {
    id: "rule_1",
    franchiseId: ids.franchises.own,
    revenueBasis: "collected",
    rateBps: 1000,
    effectiveFrom: "2025-01-01",
    ...overrides
  });
}

describe("royalty rules", () => {
  it("activates a rule and supersedes the previous active rule", async () => {
    const financeData = data();
    const first = await withActiveRule(financeData);
    expect(first.status).toBe("active");

    const second = await upsertRoyaltyRule(hqContext, permissionData, audit(), financeData, {
      id: "rule_2",
      franchiseId: ids.franchises.own,
      revenueBasis: "collected",
      rateBps: 1200,
      effectiveFrom: "2026-06-01"
    });

    const supersededFirst = financeData.royaltyRules.find((rule) => rule.id === "rule_1");
    expect(supersededFirst?.status).toBe("superseded");
    expect(supersededFirst?.supersededByRuleId).toBe("rule_2");
    expect(supersededFirst?.effectiveTo).toBe("2026-05-31");
    expect(second.status).toBe("active");
  });

  it("denies rule changes without the manage capability", async () => {
    const financeData = data();

    await expect(
      upsertRoyaltyRule(franchiseeContext, permissionData, audit(), financeData, {
        id: "rule_1",
        franchiseId: ids.franchises.own,
        revenueBasis: "collected",
        rateBps: 1000,
        effectiveFrom: "2025-01-01"
      })
    ).rejects.toThrow();
  });

  it("rejects an out-of-range rate", async () => {
    const financeData = data();

    await expect(withActiveRule(financeData, { rateBps: 20000 })).rejects.toThrow(
      "Royalty rate must be between"
    );
  });
});

describe("royalty statement generation", () => {
  it("computes a statement from collected revenue and is reproducible from source transactions", async () => {
    const financeData = data();
    await withActiveRule(financeData);

    const statement = await generateRoyaltyStatement(hqContext, permissionData, audit(), financeData, {
      id: "statement_1",
      franchiseId: ids.franchises.own,
      issuerOrganisationId: ids.organisations.hq,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    });

    expect(statement.grossRevenueMinor).toBe(12000);
    expect(statement.calculatedRoyaltyMinor).toBe(1200);
    expect(statement.totalDueMinor).toBe(1200);
    expect(statement.statementNumber).toBe("ROY-00001");
    expect(statement.status).toBe("draft");

    const lines = financeData.royaltyLines.filter((line) => line.statementId === statement.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.sourcePaymentAllocationId).toBe("allocation_1");
    expect(
      lines.reduce((sum, line) => sum + line.royaltyMinor, 0)
    ).toBe(statement.calculatedRoyaltyMinor);
  });

  it("excludes revenue collected outside the statement period", async () => {
    const financeData = data();
    await withActiveRule(financeData);

    const statement = await generateRoyaltyStatement(hqContext, permissionData, audit(), financeData, {
      id: "statement_1",
      franchiseId: ids.franchises.own,
      issuerOrganisationId: ids.organisations.hq,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28"
    });

    expect(statement.grossRevenueMinor).toBe(0);
    expect(statement.calculatedRoyaltyMinor).toBe(0);
  });

  it("applies the rule minimum when calculated royalty falls short", async () => {
    const financeData = data();
    await withActiveRule(financeData, { minimumDueMinor: 5000 });

    const statement = await generateRoyaltyStatement(hqContext, permissionData, audit(), financeData, {
      id: "statement_1",
      franchiseId: ids.franchises.own,
      issuerOrganisationId: ids.organisations.hq,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    });

    expect(statement.calculatedRoyaltyMinor).toBe(5000);
    expect(statement.totalDueMinor).toBe(5000);
  });

  it("regenerates a draft statement in place instead of duplicating it", async () => {
    const financeData = data();
    await withActiveRule(financeData);
    const input = {
      id: "statement_1",
      franchiseId: ids.franchises.own,
      issuerOrganisationId: ids.organisations.hq,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    };

    const first = await generateRoyaltyStatement(hqContext, permissionData, audit(), financeData, input);
    financeData.paymentAllocations.push({
      id: "allocation_2",
      invoiceId: "invoice_1",
      amountMinor: 1000,
      allocatedAt: "2026-01-20",
      status: "allocated"
    });
    const second = await generateRoyaltyStatement(hqContext, permissionData, audit(), financeData, input);

    expect(second.id).toBe(first.id);
    expect(financeData.royaltyStatements).toHaveLength(1);
    expect(second.grossRevenueMinor).toBe(13000);
    expect(financeData.royaltyLines.filter((line) => line.statementId === first.id)).toHaveLength(2);
  });

  it("refuses to regenerate an approved statement", async () => {
    const financeData = data();
    await withActiveRule(financeData);
    const input = {
      id: "statement_1",
      franchiseId: ids.franchises.own,
      issuerOrganisationId: ids.organisations.hq,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    };

    const statement = await generateRoyaltyStatement(hqContext, permissionData, audit(), financeData, input);
    await submitRoyaltyStatementForApproval(hqContext, permissionData, audit(), financeData, statement.id);
    await approveRoyaltyStatement(hqContext, permissionData, audit(), financeData, statement.id);

    await expect(
      generateRoyaltyStatement(hqContext, permissionData, audit(), financeData, input)
    ).rejects.toThrow("durable");
  });

  it("refuses to generate without an active royalty rule covering the period", async () => {
    const financeData = data();

    await expect(
      generateRoyaltyStatement(hqContext, permissionData, audit(), financeData, {
        id: "statement_1",
        franchiseId: ids.franchises.own,
        issuerOrganisationId: ids.organisations.hq,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31"
      })
    ).rejects.toThrow("No active royalty rule");
  });
});

describe("royalty adjustments and approval", () => {
  async function draftStatement(financeData: FinanceData) {
    await withActiveRule(financeData);
    return generateRoyaltyStatement(hqContext, permissionData, audit(), financeData, {
      id: "statement_1",
      franchiseId: ids.franchises.own,
      issuerOrganisationId: ids.organisations.hq,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    });
  }

  it("records an auditable adjustment and updates the total due", async () => {
    const financeData = data();
    const statement = await draftStatement(financeData);

    const adjustment = await addRoyaltyAdjustment(hqContext, permissionData, audit(), financeData, {
      id: "adjustment_1",
      statementId: statement.id,
      amountMinor: -200,
      reason: "Duplicate invoice removed after reconciliation"
    });

    expect(adjustment.reason).toContain("Duplicate invoice");
    expect(statement.adjustmentsMinor).toBe(-200);
    expect(statement.totalDueMinor).toBe(1000);
    expect(financeData.royaltyAdjustments).toHaveLength(1);
  });

  it("requires a non-empty reason for an adjustment", async () => {
    const financeData = data();
    const statement = await draftStatement(financeData);

    await expect(
      addRoyaltyAdjustment(hqContext, permissionData, audit(), financeData, {
        id: "adjustment_1",
        statementId: statement.id,
        amountMinor: -200,
        reason: "   "
      })
    ).rejects.toThrow("reason is required");
  });

  it("moves a statement from draft to pending approval to approved", async () => {
    const financeData = data();
    const statement = await draftStatement(financeData);

    const submitted = await submitRoyaltyStatementForApproval(hqContext, permissionData, audit(), financeData, statement.id);
    expect(submitted.status).toBe("pending_approval");
    expect(submitted.submittedAt).toBeTruthy();

    const approved = await approveRoyaltyStatement(hqContext, permissionData, audit(), financeData, statement.id);
    expect(approved.status).toBe("approved");
    expect(approved.approvedByUserId).toBe(ids.users.hq);
  });

  it("refuses to approve a statement that is not pending approval", async () => {
    const financeData = data();
    const statement = await draftStatement(financeData);

    await expect(
      approveRoyaltyStatement(hqContext, permissionData, audit(), financeData, statement.id)
    ).rejects.toThrow("pending approval");
  });

  it("blocks adjustments once a statement is approved", async () => {
    const financeData = data();
    const statement = await draftStatement(financeData);
    await submitRoyaltyStatementForApproval(hqContext, permissionData, audit(), financeData, statement.id);
    await approveRoyaltyStatement(hqContext, permissionData, audit(), financeData, statement.id);

    await expect(
      addRoyaltyAdjustment(hqContext, permissionData, audit(), financeData, {
        id: "adjustment_1",
        statementId: statement.id,
        amountMinor: -100,
        reason: "Too late"
      })
    ).rejects.toThrow("Only draft or pending-approval");
  });
});

describe("royalty statement visibility", () => {
  it("lets a franchisee view their own franchise statement", async () => {
    const financeData = data();
    await withActiveRule(financeData);
    await generateRoyaltyStatement(hqContext, permissionData, audit(), financeData, {
      id: "statement_1",
      franchiseId: ids.franchises.own,
      issuerOrganisationId: ids.organisations.hq,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    });

    const statements = getFranchiseRoyaltyStatements(franchiseeContext, permissionData, financeData, ids.franchises.own);
    expect(statements).toHaveLength(1);
  });

  it("denies a franchisee viewing another franchise's statement", async () => {
    const financeData = data();
    await withActiveRule(financeData);
    await generateRoyaltyStatement(hqContext, permissionData, audit(), financeData, {
      id: "statement_1",
      franchiseId: ids.franchises.own,
      issuerOrganisationId: ids.organisations.hq,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31"
    });

    expect(() =>
      getFranchiseRoyaltyStatements(franchiseeContext, permissionData, financeData, ids.franchises.other)
    ).toThrow("outside the active territory");
  });
});
