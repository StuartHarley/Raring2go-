import { randomUUID } from "node:crypto";
import { auditActions } from "@raring2go/audit";
import { requirePermission, PermissionDeniedError } from "@raring2go/permissions";
import type { RecordAuditEventInput } from "@raring2go/audit";
import type { PermissionData } from "@raring2go/permissions";
import { financeCapabilities } from "./permissions";
import type { FinanceCapability } from "./permissions";
import type {
  FinanceActorContext,
  FinanceData,
  FinanceFranchiseRecord,
  RoyaltyAdjustment,
  RoyaltyLine,
  RoyaltyLineSourceType,
  RoyaltyRule,
  RoyaltyStatement
} from "./types";

type FinanceAuditRecorder = {
  record(input: RecordAuditEventInput): Promise<void>;
};

export function listActiveRoyaltyRules(
  context: FinanceActorContext,
  permissions: PermissionData,
  data: FinanceData
): RoyaltyRule[] {
  requirePermission(permissionRequest(context, undefined, "royaltyRuleView"), permissions);
  return data.royaltyRules.filter((rule) => !rule.deletedAt && rule.status === "active");
}

export async function upsertRoyaltyRule(
  context: FinanceActorContext,
  permissions: PermissionData,
  audit: FinanceAuditRecorder,
  data: FinanceData,
  input: {
    id: string;
    franchiseId: string;
    revenueBasis: RoyaltyRule["revenueBasis"];
    rateBps: number;
    minimumDueMinor?: number;
    effectiveFrom: string;
    notes?: string | null;
  }
): Promise<RoyaltyRule> {
  const franchise = requireFranchise(data, input.franchiseId);
  requireFinanceAccess(context, permissions, franchise, "royaltyRuleManage");

  if (input.rateBps < 0 || input.rateBps > 10000) {
    throw new Error("Royalty rate must be between 0% and 100%.");
  }

  const previous = data.royaltyRules.find(
    (rule) => rule.franchiseId === franchise.id && rule.status === "active" && !rule.deletedAt
  );

  const rule: RoyaltyRule = {
    id: input.id,
    franchiseId: franchise.id,
    territoryId: franchise.primaryTerritoryId,
    revenueBasis: input.revenueBasis,
    rateBps: input.rateBps,
    minimumDueMinor: input.minimumDueMinor ?? 0,
    status: "active",
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    notes: input.notes ?? null,
    createdByUserId: context.userId,
    approvedByUserId: context.userId,
    approvedAt: today()
  };

  if (previous) {
    previous.status = "superseded";
    previous.supersededByRuleId = rule.id;
    previous.effectiveTo = dayBefore(input.effectiveFrom);
  }

  data.royaltyRules.push(rule);

  await audit.record(
    ruleAuditEvent(
      context,
      previous ? auditActions.financeRoyaltyRuleSupersede : auditActions.financeRoyaltyRuleCreate,
      franchise,
      rule
    )
  );

  return rule;
}

export function listNetworkRoyaltyStatements(
  context: FinanceActorContext,
  permissions: PermissionData,
  data: FinanceData
): RoyaltyStatement[] {
  requirePermission(permissionRequest(context, undefined, "royaltyStatementView"), permissions);
  return [...data.royaltyStatements]
    .filter((statement) => !statement.deletedAt)
    .sort((left, right) => right.periodStart.localeCompare(left.periodStart));
}

export function getFranchiseRoyaltyStatements(
  context: FinanceActorContext,
  permissions: PermissionData,
  data: FinanceData,
  franchiseId: string
): RoyaltyStatement[] {
  const franchise = requireFranchise(data, franchiseId);
  requireFinanceAccess(context, permissions, franchise, "royaltyStatementView");

  return data.royaltyStatements
    .filter((statement) => statement.franchiseId === franchise.id && !statement.deletedAt)
    .sort((left, right) => right.periodStart.localeCompare(left.periodStart));
}

export function getRoyaltyStatementDetail(
  context: FinanceActorContext,
  permissions: PermissionData,
  data: FinanceData,
  statementId: string
) {
  const statement = requireStatement(data, statementId);
  const franchise = requireFranchise(data, statement.franchiseId);
  requireFinanceAccess(context, permissions, franchise, "royaltyStatementView");

  return {
    statement,
    franchise,
    lines: data.royaltyLines.filter((line) => line.statementId === statement.id),
    adjustments: data.royaltyAdjustments.filter((adjustment) => adjustment.statementId === statement.id)
  };
}

export async function generateRoyaltyStatement(
  context: FinanceActorContext,
  permissions: PermissionData,
  audit: FinanceAuditRecorder,
  data: FinanceData,
  input: {
    id: string;
    franchiseId: string;
    issuerOrganisationId: string;
    periodStart: string;
    periodEnd: string;
    sequenceKey?: string;
  }
): Promise<RoyaltyStatement> {
  const franchise = requireFranchise(data, input.franchiseId);
  requireFinanceAccess(context, permissions, franchise, "royaltyStatementGenerate");

  if (input.periodStart > input.periodEnd) {
    throw new Error("Statement period start must not be after period end.");
  }

  const rule = requireActiveRoyaltyRuleForPeriod(data, franchise.id, input.periodStart, input.periodEnd);
  const existing = data.royaltyStatements.find(
    (statement) =>
      statement.franchiseId === franchise.id &&
      statement.periodStart === input.periodStart &&
      statement.periodEnd === input.periodEnd &&
      !statement.deletedAt
  );

  if (existing && existing.status !== "draft") {
    throw new Error(
      "Approved royalty statements are durable. Record a correction as an adjustment on a new statement instead."
    );
  }

  const statementId = existing?.id ?? input.id;
  const lines = computeRoyaltyLines(data, franchise, rule, input.periodStart, input.periodEnd, statementId);
  const grossRevenueMinor = lines.reduce((sum, line) => sum + line.revenueMinor, 0);
  const summedRoyaltyMinor = lines.reduce((sum, line) => sum + line.royaltyMinor, 0);
  const calculatedRoyaltyMinor = Math.max(summedRoyaltyMinor, rule.minimumDueMinor);

  if (existing) {
    data.royaltyLines = data.royaltyLines.filter((line) => line.statementId !== existing.id);
    data.royaltyLines.push(...lines);

    existing.royaltyRuleId = rule.id;
    existing.revenueBasis = rule.revenueBasis;
    existing.royaltyRateBpsSnapshot = rule.rateBps;
    existing.grossRevenueMinor = grossRevenueMinor;
    existing.calculatedRoyaltyMinor = calculatedRoyaltyMinor;
    existing.totalDueMinor = calculatedRoyaltyMinor + existing.adjustmentsMinor;
    existing.generatedAt = today();
    existing.generatedByUserId = context.userId;

    await audit.record(
      statementAuditEvent(context, auditActions.financeRoyaltyStatementGenerate, franchise, existing)
    );

    return existing;
  }

  const sequence = requireStatementSequence(data, input.issuerOrganisationId, input.sequenceKey ?? "default");
  const statement: RoyaltyStatement = {
    id: input.id,
    franchiseId: franchise.id,
    territoryId: franchise.primaryTerritoryId,
    issuerOrganisationId: input.issuerOrganisationId,
    royaltyRuleId: rule.id,
    statementNumber: formatStatementNumber(sequence),
    status: "draft",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    currency: "GBP",
    revenueBasis: rule.revenueBasis,
    royaltyRateBpsSnapshot: rule.rateBps,
    grossRevenueMinor,
    calculatedRoyaltyMinor,
    adjustmentsMinor: 0,
    totalDueMinor: calculatedRoyaltyMinor,
    generatedByUserId: context.userId,
    generatedAt: today()
  };
  sequence.nextNumber += 1;

  data.royaltyStatements.push(statement);
  data.royaltyLines.push(...lines);

  await audit.record(
    statementAuditEvent(context, auditActions.financeRoyaltyStatementGenerate, franchise, statement)
  );

  return statement;
}

export async function addRoyaltyAdjustment(
  context: FinanceActorContext,
  permissions: PermissionData,
  audit: FinanceAuditRecorder,
  data: FinanceData,
  input: {
    id: string;
    statementId: string;
    amountMinor: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }
): Promise<RoyaltyAdjustment> {
  const statement = requireStatement(data, input.statementId);
  const franchise = requireFranchise(data, statement.franchiseId);
  requireFinanceAccess(context, permissions, franchise, "royaltyStatementAdjust");

  if (statement.status !== "draft" && statement.status !== "pending_approval") {
    throw new Error("Only draft or pending-approval statements can be adjusted.");
  }

  if (!input.reason.trim()) {
    throw new Error("An adjustment reason is required.");
  }

  const adjustment: RoyaltyAdjustment = {
    id: input.id,
    statementId: statement.id,
    amountMinor: input.amountMinor,
    reason: input.reason.trim(),
    createdByUserId: context.userId,
    metadata: input.metadata ?? {}
  };

  data.royaltyAdjustments.push(adjustment);
  statement.adjustmentsMinor += input.amountMinor;
  statement.totalDueMinor = statement.calculatedRoyaltyMinor + statement.adjustmentsMinor;

  await audit.record(
    adjustmentAuditEvent(context, auditActions.financeRoyaltyStatementAdjust, franchise, statement, adjustment)
  );

  return adjustment;
}

export async function submitRoyaltyStatementForApproval(
  context: FinanceActorContext,
  permissions: PermissionData,
  audit: FinanceAuditRecorder,
  data: FinanceData,
  statementId: string
): Promise<RoyaltyStatement> {
  const statement = requireStatement(data, statementId);
  const franchise = requireFranchise(data, statement.franchiseId);
  requireFinanceAccess(context, permissions, franchise, "royaltyStatementSubmit");

  if (statement.status !== "draft") {
    throw new Error("Only draft statements can be submitted for approval.");
  }

  statement.status = "pending_approval";
  statement.submittedAt = today();

  await audit.record(
    statementAuditEvent(context, auditActions.financeRoyaltyStatementSubmit, franchise, statement)
  );

  return statement;
}

export async function approveRoyaltyStatement(
  context: FinanceActorContext,
  permissions: PermissionData,
  audit: FinanceAuditRecorder,
  data: FinanceData,
  statementId: string
): Promise<RoyaltyStatement> {
  const statement = requireStatement(data, statementId);
  const franchise = requireFranchise(data, statement.franchiseId);
  requireFinanceAccess(context, permissions, franchise, "royaltyStatementApprove");

  if (statement.status !== "pending_approval") {
    throw new Error("Only statements pending approval can be approved.");
  }

  statement.status = "approved";
  statement.approvedByUserId = context.userId;
  statement.approvedAt = today();

  await audit.record(
    statementAuditEvent(context, auditActions.financeRoyaltyStatementApprove, franchise, statement)
  );

  return statement;
}

export async function voidRoyaltyStatement(
  context: FinanceActorContext,
  permissions: PermissionData,
  audit: FinanceAuditRecorder,
  data: FinanceData,
  statementId: string,
  reason: string
): Promise<RoyaltyStatement> {
  const statement = requireStatement(data, statementId);
  const franchise = requireFranchise(data, statement.franchiseId);
  requireFinanceAccess(context, permissions, franchise, "royaltyStatementApprove");

  if (statement.status === "void") {
    throw new Error("Statement is already void.");
  }

  if (!reason.trim()) {
    throw new Error("A void reason is required.");
  }

  statement.status = "void";
  statement.voidedAt = today();

  await audit.record(
    statementAuditEvent(context, auditActions.financeRoyaltyStatementVoid, franchise, statement, { reason })
  );

  return statement;
}

function computeRoyaltyLines(
  data: FinanceData,
  franchise: FinanceFranchiseRecord,
  rule: RoyaltyRule,
  periodStart: string,
  periodEnd: string,
  statementId: string
): RoyaltyLine[] {
  if (rule.revenueBasis === "invoiced") {
    return data.invoices
      .filter(
        (invoice) =>
          !invoice.deletedAt &&
          invoice.territoryId === franchise.primaryTerritoryId &&
          invoice.status !== "draft" &&
          invoice.status !== "void" &&
          invoice.issueDate != null &&
          invoice.issueDate >= periodStart &&
          invoice.issueDate <= periodEnd
      )
      .map((invoice) =>
        makeRoyaltyLine(
          statementId,
          "advertiser_invoice",
          { sourceInvoiceId: invoice.id },
          `Invoiced revenue on ${invoice.issueDate}`,
          invoice.subtotalMinor,
          rule.rateBps
        )
      );
  }

  const invoicesById = new Map(data.invoices.map((invoice) => [invoice.id, invoice]));

  return data.paymentAllocations
    .filter(
      (allocation) =>
        !allocation.deletedAt &&
        allocation.status !== "reversed" &&
        allocation.allocatedAt >= periodStart &&
        allocation.allocatedAt <= periodEnd
    )
    .filter((allocation) => {
      const invoice = invoicesById.get(allocation.invoiceId);
      return invoice && !invoice.deletedAt && invoice.territoryId === franchise.primaryTerritoryId;
    })
    .map((allocation) =>
      makeRoyaltyLine(
        statementId,
        "advertiser_payment_allocation",
        { sourceInvoiceId: allocation.invoiceId, sourcePaymentAllocationId: allocation.id },
        `Payment collected on ${allocation.allocatedAt}`,
        allocation.amountMinor,
        rule.rateBps
      )
    );
}

function makeRoyaltyLine(
  statementId: string,
  sourceType: RoyaltyLineSourceType,
  source: { sourceInvoiceId?: string; sourcePaymentAllocationId?: string },
  description: string,
  revenueMinor: number,
  rateBps: number
): RoyaltyLine {
  return {
    id: randomUUID(),
    statementId,
    sourceType,
    sourceInvoiceId: source.sourceInvoiceId ?? null,
    sourcePaymentAllocationId: source.sourcePaymentAllocationId ?? null,
    description,
    revenueMinor,
    royaltyMinor: Math.round((revenueMinor * rateBps) / 10000)
  };
}

function requireActiveRoyaltyRuleForPeriod(
  data: FinanceData,
  franchiseId: string,
  periodStart: string,
  periodEnd: string
): RoyaltyRule {
  const rule = data.royaltyRules.find(
    (candidate) =>
      candidate.franchiseId === franchiseId &&
      candidate.status === "active" &&
      !candidate.deletedAt &&
      candidate.effectiveFrom <= periodStart &&
      (!candidate.effectiveTo || candidate.effectiveTo >= periodEnd)
  );

  if (!rule) {
    throw new Error("No active royalty rule covers this statement period.");
  }

  return rule;
}

function requireStatementSequence(data: FinanceData, issuerOrganisationId: string, key: string) {
  let sequence = data.statementSequences.find(
    (candidate) => candidate.issuerOrganisationId === issuerOrganisationId && candidate.key === key
  );

  if (!sequence) {
    sequence = {
      id: randomUUID(),
      issuerOrganisationId,
      key,
      prefix: "ROY",
      nextNumber: 1,
      padding: 5
    };
    data.statementSequences.push(sequence);
  }

  return sequence;
}

function formatStatementNumber(sequence: { prefix: string; nextNumber: number; padding: number }) {
  return `${sequence.prefix}-${String(sequence.nextNumber).padStart(sequence.padding, "0")}`;
}

function requireFranchise(data: FinanceData, franchiseId: string): FinanceFranchiseRecord {
  const franchise = data.franchises.find((candidate) => candidate.id === franchiseId);

  if (!franchise || franchise.deletedAt) {
    throw new Error("Franchise was not found.");
  }

  return franchise;
}

function requireStatement(data: FinanceData, statementId: string): RoyaltyStatement {
  const statement = data.royaltyStatements.find((candidate) => candidate.id === statementId && !candidate.deletedAt);

  if (!statement) {
    throw new Error("Royalty statement was not found.");
  }

  return statement;
}

function requireFinanceAccess(
  context: FinanceActorContext,
  permissions: PermissionData,
  franchise: FinanceFranchiseRecord,
  action: FinanceCapability
) {
  assertRecordTerritory(context, franchise);
  return requirePermission(permissionRequest(context, franchise.primaryTerritoryId, action), permissions);
}

function assertRecordTerritory(context: FinanceActorContext, franchise: FinanceFranchiseRecord) {
  if (context.territoryId && context.territoryId !== franchise.primaryTerritoryId) {
    throw new PermissionDeniedError({
      allowed: false,
      reason: "scope_mismatch",
      explanation: "Franchise is outside the active territory context."
    });
  }
}

function permissionRequest(
  context: FinanceActorContext,
  _territoryId: string | undefined,
  action: FinanceCapability
) {
  return {
    userId: context.userId,
    module: financeCapabilities[action].module,
    action: financeCapabilities[action].action,
    context: {
      organisationId: context.organisationId,
      territoryId: context.territoryId
    }
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dayBefore(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function ruleAuditEvent(
  context: FinanceActorContext,
  action: string,
  franchise: FinanceFranchiseRecord,
  rule: RoyaltyRule
): RecordAuditEventInput {
  return {
    action,
    actor: { type: "human", userId: context.userId },
    entity: { type: "royalty_rule", id: rule.id },
    scope: { organisationId: franchise.franchiseOrganisationId, territoryId: franchise.primaryTerritoryId },
    after: { revenueBasis: rule.revenueBasis, rateBps: rule.rateBps, effectiveFrom: rule.effectiveFrom },
    metadata: { franchiseId: franchise.id, source: "finance" }
  };
}

function statementAuditEvent(
  context: FinanceActorContext,
  action: string,
  franchise: FinanceFranchiseRecord,
  statement: RoyaltyStatement,
  metadata?: Record<string, unknown>
): RecordAuditEventInput {
  return {
    action,
    actor: { type: "human", userId: context.userId },
    entity: { type: "royalty_statement", id: statement.id },
    scope: { organisationId: franchise.franchiseOrganisationId, territoryId: franchise.primaryTerritoryId },
    after: {
      status: statement.status,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      grossRevenueMinor: statement.grossRevenueMinor,
      calculatedRoyaltyMinor: statement.calculatedRoyaltyMinor,
      totalDueMinor: statement.totalDueMinor
    },
    metadata: { franchiseId: franchise.id, source: "finance", ...metadata }
  };
}

function adjustmentAuditEvent(
  context: FinanceActorContext,
  action: string,
  franchise: FinanceFranchiseRecord,
  statement: RoyaltyStatement,
  adjustment: RoyaltyAdjustment
): RecordAuditEventInput {
  return {
    action,
    actor: { type: "human", userId: context.userId },
    entity: { type: "royalty_adjustment", id: adjustment.id },
    scope: { organisationId: franchise.franchiseOrganisationId, territoryId: franchise.primaryTerritoryId },
    after: { amountMinor: adjustment.amountMinor, reason: adjustment.reason, totalDueMinor: statement.totalDueMinor },
    metadata: { franchiseId: franchise.id, statementId: statement.id, source: "finance" }
  };
}
