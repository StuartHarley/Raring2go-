import { date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";
import { advertiserInvoices, advertiserPaymentAllocations } from "./advertising";
import { franchises } from "./franchise";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

export const royaltyRules = pgTable(
  "royalty_rules",
  {
    id,
    franchiseId: uuid("franchise_id").notNull().references(() => franchises.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    revenueBasis: text("revenue_basis", { enum: ["invoiced", "collected"] })
      .notNull()
      .default("collected"),
    rateBps: integer("rate_bps").notNull(),
    minimumDueMinor: integer("minimum_due_minor").notNull().default(0),
    status: text("status", { enum: ["draft", "active", "superseded"] })
      .notNull()
      .default("draft"),
    effectiveFrom: date("effective_from", { mode: "date" }).notNull(),
    effectiveTo: date("effective_to", { mode: "date" }),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: date("approved_at", { mode: "date" }),
    supersededByRuleId: uuid("superseded_by_rule_id"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("royalty_rules_franchise_id_idx").on(table.franchiseId),
    index("royalty_rules_territory_id_idx").on(table.territoryId),
    index("royalty_rules_status_idx").on(table.status),
    index("royalty_rules_deleted_at_idx").on(table.deletedAt)
  ]
);

export const royaltyStatementSequences = pgTable(
  "royalty_statement_sequences",
  {
    id,
    issuerOrganisationId: uuid("issuer_organisation_id").notNull().references(() => organisations.id),
    key: text("key").notNull().default("default"),
    prefix: text("prefix").notNull().default("ROY"),
    nextNumber: integer("next_number").notNull().default(1),
    padding: integer("padding").notNull().default(5),
    ...timestamps
  },
  (table) => [
    uniqueIndex("royalty_statement_sequences_issuer_key_uidx").on(table.issuerOrganisationId, table.key)
  ]
);

export const royaltyStatements = pgTable(
  "royalty_statements",
  {
    id,
    franchiseId: uuid("franchise_id").notNull().references(() => franchises.id),
    territoryId: uuid("territory_id").notNull().references(() => territories.id),
    issuerOrganisationId: uuid("issuer_organisation_id").notNull().references(() => organisations.id),
    royaltyRuleId: uuid("royalty_rule_id").notNull().references(() => royaltyRules.id),
    statementNumber: text("statement_number").notNull(),
    status: text("status", {
      enum: ["draft", "pending_approval", "approved", "void"]
    })
      .notNull()
      .default("draft"),
    periodStart: date("period_start", { mode: "date" }).notNull(),
    periodEnd: date("period_end", { mode: "date" }).notNull(),
    currency: text("currency").notNull().default("GBP"),
    revenueBasis: text("revenue_basis", { enum: ["invoiced", "collected"] }).notNull(),
    royaltyRateBpsSnapshot: integer("royalty_rate_bps_snapshot").notNull(),
    grossRevenueMinor: integer("gross_revenue_minor").notNull().default(0),
    calculatedRoyaltyMinor: integer("calculated_royalty_minor").notNull().default(0),
    adjustmentsMinor: integer("adjustments_minor").notNull().default(0),
    totalDueMinor: integer("total_due_minor").notNull().default(0),
    generatedByUserId: uuid("generated_by_user_id").references(() => users.id),
    generatedAt: date("generated_at", { mode: "date" }).notNull(),
    submittedAt: date("submitted_at", { mode: "date" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: date("approved_at", { mode: "date" }),
    voidedAt: date("voided_at", { mode: "date" }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("royalty_statements_issuer_number_uidx").on(table.issuerOrganisationId, table.statementNumber),
    uniqueIndex("royalty_statements_franchise_period_uidx").on(
      table.franchiseId,
      table.periodStart,
      table.periodEnd
    ),
    index("royalty_statements_territory_id_idx").on(table.territoryId),
    index("royalty_statements_status_idx").on(table.status),
    index("royalty_statements_deleted_at_idx").on(table.deletedAt)
  ]
);

export const royaltyLines = pgTable(
  "royalty_lines",
  {
    id,
    statementId: uuid("statement_id").notNull().references(() => royaltyStatements.id),
    sourceType: text("source_type", { enum: ["advertiser_invoice", "advertiser_payment_allocation"] }).notNull(),
    sourceInvoiceId: uuid("source_invoice_id").references(() => advertiserInvoices.id),
    sourcePaymentAllocationId: uuid("source_payment_allocation_id").references(
      () => advertiserPaymentAllocations.id
    ),
    description: text("description").notNull(),
    revenueMinor: integer("revenue_minor").notNull(),
    royaltyMinor: integer("royalty_minor").notNull(),
    ...timestamps
  },
  (table) => [
    index("royalty_lines_statement_id_idx").on(table.statementId),
    index("royalty_lines_source_invoice_id_idx").on(table.sourceInvoiceId),
    index("royalty_lines_source_payment_allocation_id_idx").on(table.sourcePaymentAllocationId)
  ]
);

export const royaltyAdjustments = pgTable(
  "royalty_adjustments",
  {
    id,
    statementId: uuid("statement_id").notNull().references(() => royaltyStatements.id),
    amountMinor: integer("amount_minor").notNull(),
    reason: text("reason").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => [index("royalty_adjustments_statement_id_idx").on(table.statementId)]
);
