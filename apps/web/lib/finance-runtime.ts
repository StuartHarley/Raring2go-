import {
  addRoyaltyAdjustment,
  approveRoyaltyStatement,
  generateRoyaltyStatement,
  getFranchiseRoyaltyStatements,
  getRoyaltyStatementDetail,
  insertRoyaltyAdjustmentRecord,
  insertRoyaltyRuleRecord,
  insertRoyaltyStatementGraph,
  listActiveRoyaltyRules,
  listNetworkRoyaltyStatements,
  loadFinanceData,
  submitRoyaltyStatementForApproval,
  updateRoyaltyRuleRecord,
  updateRoyaltyStatementGraph,
  updateRoyaltyStatementStateRecord,
  upsertRoyaltyRule,
  upsertStatementSequenceRecord
} from "@raring2go/finance";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb, fixtureIds, foundationSeed } from "@raring2go/db";
import type { FinanceActorContext } from "@raring2go/finance";
import type { PermissionData } from "@raring2go/permissions";

export const financePermissionData: PermissionData = {
  roleAssignments: [
    {
      id: "fixture_assignment_superadmin",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.superAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_hq",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.hqAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_franchisee",
      userId: fixtureIds.users.franchisee,
      roleId: fixtureIds.roles.franchisee,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield
    }
  ],
  rolePermissions: [
    grant(fixtureIds.roles.superAdmin, fixtureIds.permissions.royaltyRuleView, "network"),
    grant(fixtureIds.roles.superAdmin, fixtureIds.permissions.royaltyRuleManage, "network"),
    grant(fixtureIds.roles.superAdmin, fixtureIds.permissions.royaltyStatementView, "network"),
    grant(fixtureIds.roles.superAdmin, fixtureIds.permissions.royaltyStatementGenerate, "network"),
    grant(fixtureIds.roles.superAdmin, fixtureIds.permissions.royaltyStatementAdjust, "network"),
    grant(fixtureIds.roles.superAdmin, fixtureIds.permissions.royaltyStatementSubmit, "network"),
    grant(fixtureIds.roles.superAdmin, fixtureIds.permissions.royaltyStatementApprove, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.royaltyRuleView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.royaltyRuleManage, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.royaltyStatementView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.royaltyStatementGenerate, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.royaltyStatementAdjust, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.royaltyStatementSubmit, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.royaltyStatementApprove, "network"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.royaltyStatementView, "own_territory")
  ],
  territories: foundationSeed.territories.map((territory) => ({
    id: territory.id,
    franchiseOrganisationId: territory.franchiseOrganisationId
  }))
};

export async function readActiveRoyaltyRules(context: FinanceActorContext) {
  const { db, sql } = createDb();

  try {
    return listActiveRoyaltyRules(context, financePermissionData, await loadFinanceData(db));
  } finally {
    await sql.end();
  }
}

export async function readNetworkRoyaltyStatements(context: FinanceActorContext) {
  const { db, sql } = createDb();

  try {
    return listNetworkRoyaltyStatements(context, financePermissionData, await loadFinanceData(db));
  } finally {
    await sql.end();
  }
}

export async function readFranchiseRoyaltyStatements(context: FinanceActorContext, franchiseId: string) {
  const { db, sql } = createDb();

  try {
    return getFranchiseRoyaltyStatements(context, financePermissionData, await loadFinanceData(db), franchiseId);
  } finally {
    await sql.end();
  }
}

export async function readOwnFranchiseRoyaltyStatements(context: FinanceActorContext) {
  const { db, sql } = createDb();

  try {
    const data = await loadFinanceData(db);
    const franchise = data.franchises.find((candidate) => candidate.primaryTerritoryId === context.territoryId);

    if (!franchise) {
      return { franchise: undefined, statements: [] };
    }

    return {
      franchise,
      statements: getFranchiseRoyaltyStatements(context, financePermissionData, data, franchise.id)
    };
  } finally {
    await sql.end();
  }
}

export async function readRoyaltyStatementDetail(context: FinanceActorContext, statementId: string) {
  const { db, sql } = createDb();

  try {
    return getRoyaltyStatementDetail(context, financePermissionData, await loadFinanceData(db), statementId);
  } finally {
    await sql.end();
  }
}

export async function createRoyaltyRule(
  context: FinanceActorContext,
  input: Parameters<typeof upsertRoyaltyRule>[4]
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFinanceData(tx);
      const rule = await upsertRoyaltyRule(context, financePermissionData, auditFor(tx), data, input);
      const previous = data.royaltyRules.find(
        (candidate) => candidate.id !== rule.id && candidate.supersededByRuleId === rule.id
      );

      if (previous) {
        await updateRoyaltyRuleRecord(tx, previous);
      }

      await insertRoyaltyRuleRecord(tx, rule);
      return rule;
    });
  } finally {
    await sql.end();
  }
}

export async function generateStatement(
  context: FinanceActorContext,
  input: Parameters<typeof generateRoyaltyStatement>[4]
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFinanceData(tx);
      const existed = data.royaltyStatements.some(
        (candidate) =>
          candidate.franchiseId === input.franchiseId &&
          candidate.periodStart === input.periodStart &&
          candidate.periodEnd === input.periodEnd &&
          !candidate.deletedAt
      );
      const statement = await generateRoyaltyStatement(context, financePermissionData, auditFor(tx), data, input);
      const lines = data.royaltyLines.filter((line) => line.statementId === statement.id);

      if (existed) {
        await updateRoyaltyStatementGraph(tx, { statement, lines });
      } else {
        const sequence = data.statementSequences.find(
          (candidate) => candidate.issuerOrganisationId === input.issuerOrganisationId
        );

        if (sequence) {
          await upsertStatementSequenceRecord(tx, sequence);
        }

        await insertRoyaltyStatementGraph(tx, { statement, lines });
      }

      return statement;
    });
  } finally {
    await sql.end();
  }
}

export async function recordAdjustment(
  context: FinanceActorContext,
  input: Parameters<typeof addRoyaltyAdjustment>[4]
) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFinanceData(tx);
      const adjustment = await addRoyaltyAdjustment(context, financePermissionData, auditFor(tx), data, input);
      const statement = data.royaltyStatements.find((candidate) => candidate.id === input.statementId)!;
      await insertRoyaltyAdjustmentRecord(tx, adjustment);
      await updateRoyaltyStatementStateRecord(tx, statement);
      return adjustment;
    });
  } finally {
    await sql.end();
  }
}

export async function submitStatement(context: FinanceActorContext, statementId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFinanceData(tx);
      const statement = await submitRoyaltyStatementForApproval(
        context,
        financePermissionData,
        auditFor(tx),
        data,
        statementId
      );
      await updateRoyaltyStatementStateRecord(tx, statement);
      return statement;
    });
  } finally {
    await sql.end();
  }
}

export async function approveStatement(context: FinanceActorContext, statementId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadFinanceData(tx);
      const statement = await approveRoyaltyStatement(
        context,
        financePermissionData,
        auditFor(tx),
        data,
        statementId
      );
      await updateRoyaltyStatementStateRecord(tx, statement);
      return statement;
    });
  } finally {
    await sql.end();
  }
}

function grant(roleId: string, permissionId: string, scope: string) {
  const permission = foundationSeed.permissions.find((candidate) => candidate.id === permissionId);

  if (!permission) {
    throw new Error("Finance permission fixture is inconsistent.");
  }

  return {
    roleId,
    permission,
    scope,
    constraints: {}
  };
}

function auditFor(db: Parameters<typeof recordAuditEvent>[0]) {
  return {
    record: (input: Parameters<typeof recordAuditEvent>[1]) =>
      recordAuditEvent(db, input).then(() => undefined)
  };
}
