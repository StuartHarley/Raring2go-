import {
  advertiserInvoices,
  advertiserPaymentAllocations,
  franchises,
  royaltyAdjustments,
  royaltyLines,
  royaltyRules,
  royaltyStatementSequences,
  royaltyStatements,
  territories
} from "@raring2go/db";
import { eq } from "drizzle-orm";
import type { FinanceData, RoyaltyAdjustment, RoyaltyLine, RoyaltyRule, RoyaltyStatement } from "./types";

type FinanceDb = any;

export async function loadFinanceData(db: FinanceDb): Promise<FinanceData> {
  const [
    franchiseRows,
    territoryRows,
    invoiceRows,
    allocationRows,
    ruleRows,
    sequenceRows,
    statementRows,
    lineRows,
    adjustmentRows
  ] = await Promise.all([
    db.select().from(franchises),
    db.select().from(territories),
    db.select().from(advertiserInvoices),
    db.select().from(advertiserPaymentAllocations),
    db.select().from(royaltyRules),
    db.select().from(royaltyStatementSequences),
    db.select().from(royaltyStatements),
    db.select().from(royaltyLines),
    db.select().from(royaltyAdjustments)
  ]);

  return {
    franchises: franchiseRows,
    territories: territoryRows,
    invoices: invoiceRows.map((invoice: any) => ({
      ...invoice,
      issueDate: dateToString(invoice.issueDate)
    })),
    paymentAllocations: allocationRows.map((allocation: any) => ({
      ...allocation,
      allocatedAt: dateToString(allocation.allocatedAt)
    })),
    royaltyRules: ruleRows.map((rule: any) => ({
      ...rule,
      effectiveFrom: dateToString(rule.effectiveFrom),
      effectiveTo: dateToString(rule.effectiveTo),
      approvedAt: dateToString(rule.approvedAt)
    })),
    statementSequences: sequenceRows,
    royaltyStatements: statementRows.map((statement: any) => ({
      ...statement,
      periodStart: dateToString(statement.periodStart),
      periodEnd: dateToString(statement.periodEnd),
      generatedAt: dateToString(statement.generatedAt),
      submittedAt: dateToString(statement.submittedAt),
      approvedAt: dateToString(statement.approvedAt),
      voidedAt: dateToString(statement.voidedAt)
    })),
    royaltyLines: lineRows,
    royaltyAdjustments: adjustmentRows
  };
}

export async function insertRoyaltyRuleRecord(db: FinanceDb, rule: RoyaltyRule) {
  await db.insert(royaltyRules).values({
    ...rule,
    effectiveFrom: new Date(rule.effectiveFrom),
    effectiveTo: rule.effectiveTo ? new Date(rule.effectiveTo) : null,
    approvedAt: rule.approvedAt ? new Date(rule.approvedAt) : null
  });
}

export async function updateRoyaltyRuleRecord(db: FinanceDb, rule: RoyaltyRule) {
  await db
    .update(royaltyRules)
    .set({
      status: rule.status,
      supersededByRuleId: rule.supersededByRuleId,
      effectiveTo: rule.effectiveTo ? new Date(rule.effectiveTo) : null
    })
    .where(eq(royaltyRules.id, rule.id));
}

export async function upsertStatementSequenceRecord(
  db: FinanceDb,
  sequence: FinanceData["statementSequences"][number]
) {
  await db
    .insert(royaltyStatementSequences)
    .values(sequence)
    .onConflictDoUpdate({
      target: royaltyStatementSequences.id,
      set: { nextNumber: sequence.nextNumber }
    });
}

export async function insertRoyaltyStatementGraph(
  db: FinanceDb,
  input: { statement: RoyaltyStatement; lines: RoyaltyLine[] }
) {
  await db.insert(royaltyStatements).values(statementToRow(input.statement));

  if (input.lines.length > 0) {
    await db.insert(royaltyLines).values(input.lines);
  }
}

export async function updateRoyaltyStatementGraph(
  db: FinanceDb,
  input: { statement: RoyaltyStatement; lines: RoyaltyLine[] }
) {
  await db
    .update(royaltyStatements)
    .set(statementToRow(input.statement))
    .where(eq(royaltyStatements.id, input.statement.id));

  await db.delete(royaltyLines).where(eq(royaltyLines.statementId, input.statement.id));

  if (input.lines.length > 0) {
    await db.insert(royaltyLines).values(input.lines);
  }
}

export async function updateRoyaltyStatementStateRecord(db: FinanceDb, statement: RoyaltyStatement) {
  await db
    .update(royaltyStatements)
    .set({
      status: statement.status,
      adjustmentsMinor: statement.adjustmentsMinor,
      totalDueMinor: statement.totalDueMinor,
      submittedAt: statement.submittedAt ? new Date(statement.submittedAt) : null,
      approvedByUserId: statement.approvedByUserId,
      approvedAt: statement.approvedAt ? new Date(statement.approvedAt) : null,
      voidedAt: statement.voidedAt ? new Date(statement.voidedAt) : null
    })
    .where(eq(royaltyStatements.id, statement.id));
}

export async function insertRoyaltyAdjustmentRecord(db: FinanceDb, adjustment: RoyaltyAdjustment) {
  await db.insert(royaltyAdjustments).values(adjustment);
}

function statementToRow(statement: RoyaltyStatement) {
  return {
    ...statement,
    periodStart: new Date(statement.periodStart),
    periodEnd: new Date(statement.periodEnd),
    generatedAt: new Date(statement.generatedAt),
    submittedAt: statement.submittedAt ? new Date(statement.submittedAt) : null,
    approvedAt: statement.approvedAt ? new Date(statement.approvedAt) : null,
    voidedAt: statement.voidedAt ? new Date(statement.voidedAt) : null
  };
}

function dateToString(date: Date | string | null | undefined) {
  if (!date) {
    return null;
  }

  return date instanceof Date ? date.toISOString().slice(0, 10) : date;
}
