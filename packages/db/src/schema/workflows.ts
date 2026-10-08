import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, timestamps } from "./common";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

/**
 * Workflow engine (AUT-001). A definition is a stable identity; its behaviour lives
 * in immutable, versioned rows so a run always records exactly which rules it used.
 */
export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id,
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Master switch: a disabled definition never matches events, whatever its versions say. */
    status: text("status").notNull().default("enabled"),
    ...timestamps
  },
  (table) => [uniqueIndex("workflow_definitions_key_uidx").on(table.key)]
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id,
    definitionId: uuid("definition_id").notNull().references(() => workflowDefinitions.id),
    versionNumber: integer("version_number").notNull(),
    /** draft (editable, testable) -> active (immutable) -> retired. */
    status: text("status").notNull().default("draft"),
    triggerEvent: text("trigger_event").notNull(),
    conditions: jsonb("conditions").$type<Array<Record<string, unknown>>>().notNull().default([]),
    steps: jsonb("steps").$type<Array<Record<string, unknown>>>().notNull().default([]),
    /** Named thresholds (days, amounts) the steps reference, so they can be tuned without editing steps. */
    settings: jsonb("settings").$type<Record<string, number | string | boolean>>().notNull().default({}),
    changeNote: text("change_note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    activatedByUserId: uuid("activated_by_user_id").references(() => users.id),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("workflow_versions_definition_number_uidx").on(table.definitionId, table.versionNumber),
    // At most one active version per definition, enforced by the database.
    uniqueIndex("workflow_versions_one_active_uidx").on(table.definitionId).where(sql`${table.status} = 'active'`),
    index("workflow_versions_trigger_idx").on(table.triggerEvent, table.status)
  ]
);

/** Normalised stream of things that happened. Producers: audit tailer, scanners, manual. */
export const workflowEvents = pgTable(
  "workflow_events",
  {
    id,
    eventKey: text("event_key").notNull(),
    type: text("type").notNull(),
    source: text("source").notNull(),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("workflow_events_event_key_uidx").on(table.eventKey),
    index("workflow_events_pending_idx").on(table.dispatchedAt, table.occurredAt),
    index("workflow_events_type_idx").on(table.type)
  ]
);

export const workflowEventCursors = pgTable("workflow_event_cursors", {
  name: text("name").primaryKey(),
  lastCreatedAt: timestamp("last_created_at", { withTimezone: true }).notNull(),
  lastId: uuid("last_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id,
    definitionId: uuid("definition_id").notNull().references(() => workflowDefinitions.id),
    versionId: uuid("version_id").notNull().references(() => workflowVersions.id),
    eventId: uuid("event_id").references(() => workflowEvents.id),
    /** pending, running, waiting, completed, failed, cancelled. */
    status: text("status").notNull().default("pending"),
    /** When waiting: "timer" or "approval". */
    waitingOn: text("waiting_on"),
    resumeAt: timestamp("resume_at", { withTimezone: true }),
    currentStep: integer("current_step").notNull().default(0),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    /** Test runs record what would happen and cause no side effects. */
    isTest: boolean("is_test").notNull().default(false),
    outcome: text("outcome"),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    // One run per definition per event: replaying an event can never double-execute it.
    uniqueIndex("workflow_runs_definition_event_uidx").on(table.definitionId, table.eventId),
    index("workflow_runs_status_idx").on(table.status),
    index("workflow_runs_territory_id_idx").on(table.territoryId),
    index("workflow_runs_subject_idx").on(table.subjectType, table.subjectId)
  ]
);

export const workflowRunSteps = pgTable(
  "workflow_run_steps",
  {
    id,
    runId: uuid("run_id").notNull().references(() => workflowRuns.id),
    stepIndex: integer("step_index").notNull(),
    action: text("action").notNull(),
    /** pending, completed, waiting, skipped, failed. */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("workflow_run_steps_run_step_uidx").on(table.runId, table.stepIndex),
    index("workflow_run_steps_run_id_idx").on(table.runId)
  ]
);

export const workflowTasks = pgTable(
  "workflow_tasks",
  {
    id,
    title: text("title").notNull(),
    description: text("description"),
    /** open, done, cancelled. */
    status: text("status").notNull().default("open"),
    /** Who it is for: the owning territory's team, or Head Office. */
    assigneeScope: text("assignee_scope").notNull(),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    dueDate: date("due_date", { mode: "date" }),
    runId: uuid("run_id").references(() => workflowRuns.id),
    stepIndex: integer("step_index"),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    link: text("link"),
    idempotencyKey: text("idempotency_key").notNull(),
    completedByUserId: uuid("completed_by_user_id").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("workflow_tasks_idempotency_uidx").on(table.idempotencyKey),
    index("workflow_tasks_status_idx").on(table.status, table.assigneeScope),
    index("workflow_tasks_territory_id_idx").on(table.territoryId),
    index("workflow_tasks_run_id_idx").on(table.runId)
  ]
);

export const workflowApprovals = pgTable(
  "workflow_approvals",
  {
    id,
    runId: uuid("run_id").notNull().references(() => workflowRuns.id),
    stepIndex: integer("step_index").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    approverScope: text("approver_scope").notNull(),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    /** pending, approved, rejected, expired. */
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps
  },
  (table) => [
    uniqueIndex("workflow_approvals_run_step_uidx").on(table.runId, table.stepIndex),
    index("workflow_approvals_status_idx").on(table.status, table.approverScope),
    index("workflow_approvals_territory_id_idx").on(table.territoryId)
  ]
);

export const notifications = pgTable(
  "notifications",
  {
    id,
    recipientScope: text("recipient_scope").notNull(),
    recipientUserId: uuid("recipient_user_id").references(() => users.id),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("notifications_idempotency_uidx").on(table.idempotencyKey),
    index("notifications_scope_idx").on(table.recipientScope, table.readAt),
    index("notifications_territory_id_idx").on(table.territoryId)
  ]
);
