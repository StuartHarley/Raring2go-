import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./common";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

/**
 * One immutable row per successful AI call - append-only, like audit_events,
 * so it deliberately has no updatedAt/deletedAt.
 */
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id,
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    feature: text("feature").notNull(),
    providerKey: text("provider_key").notNull(),
    modelReference: text("model_reference").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    estimatedCostMinor: integer("estimated_cost_minor").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("ai_usage_events_organisation_id_created_at_idx").on(table.organisationId, table.createdAt),
    index("ai_usage_events_territory_id_created_at_idx").on(table.territoryId, table.createdAt)
  ]
);

/**
 * One row per AI call that matters (AI-001): who asked, why, from which records, what
 * came back, and whether a human accepted it. Unlike ai_usage_events (cost only), this
 * is the audit-grade record the AI guardrails require for consequential output.
 *
 * approval_state: not_required (informational), pending (a human must decide before it
 * is used), approved, rejected. High-risk tasks are always created pending.
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskKey: text("task_key").notNull(),
    purpose: text("purpose").notNull(),
    promptVersion: text("prompt_version").notNull(),
    providerKey: text("provider_key").notNull(),
    modelReference: text("model_reference").notNull(),
    /** succeeded | failed */
    status: text("status").notNull(),
    risk: text("risk").notNull().default("low"),
    approvalState: text("approval_state").notNull().default("not_required"),
    actorType: text("actor_type").notNull().default("human"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    /** The record the output is for, e.g. an email draft or content item. */
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    /** Records and URLs the model was given. References only, never raw record bodies. */
    sourceRefs: jsonb("source_refs").$type<Array<Record<string, unknown>>>().notNull().default([]),
    /** Bounded, redacted summary of the structured input. */
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estimatedCostMinor: integer("estimated_cost_minor").notNull().default(0),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** Set when an approved output was actually applied to the subject record. */
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("ai_runs_task_created_idx").on(table.taskKey, table.createdAt),
    index("ai_runs_territory_id_idx").on(table.territoryId),
    index("ai_runs_organisation_id_idx").on(table.organisationId),
    index("ai_runs_subject_idx").on(table.subjectType, table.subjectId),
    index("ai_runs_approval_idx").on(table.approvalState, table.createdAt)
  ]
);
