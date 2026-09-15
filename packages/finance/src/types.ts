export type RevenueBasis = "invoiced" | "collected";
export type RoyaltyRuleStatus = "draft" | "active" | "superseded";
export type RoyaltyStatementStatus = "draft" | "pending_approval" | "approved" | "void";
export type RoyaltyLineSourceType = "advertiser_invoice" | "advertiser_payment_allocation";

export type RoyaltyRule = {
  id: string;
  franchiseId: string;
  territoryId: string;
  revenueBasis: RevenueBasis;
  rateBps: number;
  minimumDueMinor: number;
  status: RoyaltyRuleStatus;
  effectiveFrom: string;
  effectiveTo?: string | null;
  notes?: string | null;
  createdByUserId?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  supersededByRuleId?: string | null;
  deletedAt?: Date | null;
};

export type RoyaltyStatementSequence = {
  id: string;
  issuerOrganisationId: string;
  key: string;
  prefix: string;
  nextNumber: number;
  padding: number;
};

export type RoyaltyStatement = {
  id: string;
  franchiseId: string;
  territoryId: string;
  issuerOrganisationId: string;
  royaltyRuleId: string;
  statementNumber: string;
  status: RoyaltyStatementStatus;
  periodStart: string;
  periodEnd: string;
  currency: string;
  revenueBasis: RevenueBasis;
  royaltyRateBpsSnapshot: number;
  grossRevenueMinor: number;
  calculatedRoyaltyMinor: number;
  adjustmentsMinor: number;
  totalDueMinor: number;
  generatedByUserId?: string | null;
  generatedAt: string;
  submittedAt?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  voidedAt?: string | null;
  deletedAt?: Date | null;
};

export type RoyaltyLine = {
  id: string;
  statementId: string;
  sourceType: RoyaltyLineSourceType;
  sourceInvoiceId?: string | null;
  sourcePaymentAllocationId?: string | null;
  description: string;
  revenueMinor: number;
  royaltyMinor: number;
};

export type RoyaltyAdjustment = {
  id: string;
  statementId: string;
  amountMinor: number;
  reason: string;
  createdByUserId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
};

export type FinanceFranchiseRecord = {
  id: string;
  franchiseOrganisationId: string;
  primaryTerritoryId: string;
  status: string;
  deletedAt?: Date | null;
};

export type FinanceInvoiceRecord = {
  id: string;
  issuerOrganisationId: string;
  territoryId: string;
  status: string;
  issueDate?: string | null;
  subtotalMinor: number;
  totalMinor: number;
  deletedAt?: Date | null;
};

export type FinancePaymentAllocationRecord = {
  id: string;
  invoiceId: string;
  amountMinor: number;
  allocatedAt: string;
  status: string;
  deletedAt?: Date | null;
};

export type FinanceTerritoryRecord = {
  id: string;
  franchiseOrganisationId?: string | null;
};

export type FinanceData = {
  franchises: FinanceFranchiseRecord[];
  territories: FinanceTerritoryRecord[];
  invoices: FinanceInvoiceRecord[];
  paymentAllocations: FinancePaymentAllocationRecord[];
  royaltyRules: RoyaltyRule[];
  statementSequences: RoyaltyStatementSequence[];
  royaltyStatements: RoyaltyStatement[];
  royaltyLines: RoyaltyLine[];
  royaltyAdjustments: RoyaltyAdjustment[];
};

export type FinanceActorContext = {
  userId: string;
  organisationId: string;
  territoryId?: string;
};
