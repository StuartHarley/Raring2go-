import {
  auditEvents,
  notifications,
  workflowApprovals,
  workflowDefinitions,
  workflowEventCursors,
  workflowEvents,
  workflowRunSteps,
  workflowRuns,
  workflowTasks,
  workflowVersions
} from "@raring2go/db";
import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import type { WorkflowsDb } from "../repository";
import type { EngineStore } from "./store";
import type {
  NotificationRecord,
  RunStepRecord,
  WorkflowApprovalRecord,
  WorkflowDefinitionRecord,
  WorkflowEventRecord,
  WorkflowRunRecord,
  WorkflowTaskRecord,
  WorkflowVersionRecord
} from "./types";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const cap = (limit: number | undefined) => Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

const asDefinition = (row: typeof workflowDefinitions.$inferSelect) => row as WorkflowDefinitionRecord;
const asVersion = (row: typeof workflowVersions.$inferSelect) => row as unknown as WorkflowVersionRecord;
const asEvent = (row: typeof workflowEvents.$inferSelect) => row as WorkflowEventRecord;
const asRun = (row: typeof workflowRuns.$inferSelect) => row as WorkflowRunRecord;
const asStep = (row: typeof workflowRunSteps.$inferSelect) => row as RunStepRecord;
const asTask = (row: typeof workflowTasks.$inferSelect) => row as WorkflowTaskRecord;
const asApproval = (row: typeof workflowApprovals.$inferSelect) => row as WorkflowApprovalRecord;
const asNotification = (row: typeof notifications.$inferSelect) => row as NotificationRecord;

function required<T>(row: T | undefined, what: string): T {
  if (!row) throw new Error(`${what} was not found.`);
  return row;
}

export function createDrizzleEngineStore(db: WorkflowsDb): EngineStore {
  return {
    async upsertDefinition(input, now) {
      const [row] = await db
        .insert(workflowDefinitions)
        .values({ key: input.key, name: input.name, description: input.description ?? null, status: input.status ?? "enabled", createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: workflowDefinitions.key,
          set: {
            name: input.name,
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.status ? { status: input.status } : {}),
            updatedAt: now
          }
        })
        .returning();
      return asDefinition(required(row, "Definition"));
    },
    async getDefinition(id) {
      const [row] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
      return row ? asDefinition(row) : undefined;
    },
    async getDefinitionByKey(key) {
      const [row] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.key, key));
      return row ? asDefinition(row) : undefined;
    },
    async listDefinitions() {
      return (await db.select().from(workflowDefinitions).orderBy(asc(workflowDefinitions.key))).map(asDefinition);
    },
    async setDefinitionStatus(id, status, now) {
      const [row] = await db.update(workflowDefinitions).set({ status, updatedAt: now }).where(eq(workflowDefinitions.id, id)).returning();
      return row ? asDefinition(row) : undefined;
    },

    async createVersion(definitionId, draft, createdByUserId, now) {
      return db.transaction(async (tx) => {
        // Serialise concurrent drafts of one definition so version numbers stay dense and unique.
        await tx.execute(sql`SELECT id FROM workflow_definitions WHERE id = ${definitionId} FOR UPDATE`);
        const [latest] = await tx
          .select({ n: sql<number>`coalesce(max(${workflowVersions.versionNumber}), 0)::int` })
          .from(workflowVersions)
          .where(eq(workflowVersions.definitionId, definitionId));
        const [row] = await tx
          .insert(workflowVersions)
          .values({
            definitionId,
            versionNumber: (latest?.n ?? 0) + 1,
            status: "draft",
            triggerEvent: draft.triggerEvent,
            conditions: draft.conditions as unknown as Array<Record<string, unknown>>,
            steps: draft.steps as unknown as Array<Record<string, unknown>>,
            settings: draft.settings,
            changeNote: draft.changeNote ?? null,
            createdByUserId,
            createdAt: now,
            updatedAt: now
          })
          .returning();
        return asVersion(required(row, "Version"));
      });
    },
    async getVersion(id) {
      const [row] = await db.select().from(workflowVersions).where(eq(workflowVersions.id, id));
      return row ? asVersion(row) : undefined;
    },
    async listVersions(definitionId) {
      return (await db.select().from(workflowVersions).where(eq(workflowVersions.definitionId, definitionId)).orderBy(desc(workflowVersions.versionNumber))).map(asVersion);
    },
    async updateDraftVersion(id, draft, now) {
      const [row] = await db
        .update(workflowVersions)
        .set({
          triggerEvent: draft.triggerEvent,
          conditions: draft.conditions as unknown as Array<Record<string, unknown>>,
          steps: draft.steps as unknown as Array<Record<string, unknown>>,
          settings: draft.settings,
          ...(draft.changeNote !== undefined ? { changeNote: draft.changeNote } : {}),
          updatedAt: now
        })
        .where(and(eq(workflowVersions.id, id), eq(workflowVersions.status, "draft")))
        .returning();
      return row ? asVersion(row) : undefined;
    },
    async activateVersion(id, userId, now) {
      return db.transaction(async (tx) => {
        const [target] = await tx.select().from(workflowVersions).where(and(eq(workflowVersions.id, id), eq(workflowVersions.status, "draft"))).for("update");
        if (!target) return undefined;
        await tx
          .update(workflowVersions)
          .set({ status: "retired", updatedAt: now })
          .where(and(eq(workflowVersions.definitionId, target.definitionId), eq(workflowVersions.status, "active")));
        const [row] = await tx
          .update(workflowVersions)
          .set({ status: "active", activatedByUserId: userId, activatedAt: now, updatedAt: now })
          .where(eq(workflowVersions.id, id))
          .returning();
        return row ? asVersion(row) : undefined;
      });
    },
    async listActiveWorkflows() {
      const rows = await db
        .select({ definition: workflowDefinitions, version: workflowVersions })
        .from(workflowVersions)
        .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowVersions.definitionId))
        .where(and(eq(workflowVersions.status, "active"), eq(workflowDefinitions.status, "enabled")));
      return rows.map((row) => ({ definition: asDefinition(row.definition), version: asVersion(row.version) }));
    },

    async insertEvent(input, now) {
      const [inserted] = await db
        .insert(workflowEvents)
        .values({
          eventKey: input.eventKey,
          type: input.type,
          source: input.source,
          organisationId: input.organisationId ?? null,
          territoryId: input.territoryId ?? null,
          subjectType: input.subjectType ?? null,
          subjectId: input.subjectId ?? null,
          actorUserId: input.actorUserId ?? null,
          payload: input.payload ?? {},
          occurredAt: input.occurredAt,
          createdAt: now
        })
        .onConflictDoNothing({ target: workflowEvents.eventKey })
        .returning();
      if (inserted) return { event: asEvent(inserted), created: true };
      const [existing] = await db.select().from(workflowEvents).where(eq(workflowEvents.eventKey, input.eventKey));
      return { event: asEvent(required(existing, "Event")), created: false };
    },
    async pendingEvents(limit) {
      return (await db.select().from(workflowEvents).where(isNull(workflowEvents.dispatchedAt)).orderBy(asc(workflowEvents.occurredAt)).limit(cap(limit))).map(asEvent);
    },
    async markEventDispatched(id, now) {
      await db.update(workflowEvents).set({ dispatchedAt: now }).where(eq(workflowEvents.id, id));
    },
    async getCursor(name) {
      const [row] = await db.select().from(workflowEventCursors).where(eq(workflowEventCursors.name, name));
      return row ? { lastCreatedAt: row.lastCreatedAt, lastId: row.lastId } : undefined;
    },
    async setCursor(name, cursor, now) {
      await db
        .insert(workflowEventCursors)
        .values({ name, lastCreatedAt: cursor.lastCreatedAt, lastId: cursor.lastId, updatedAt: now })
        .onConflictDoUpdate({ target: workflowEventCursors.name, set: { lastCreatedAt: cursor.lastCreatedAt, lastId: cursor.lastId, updatedAt: now } });
    },
    async auditEventsSince({ actions, since, before, limit }) {
      if (actions.length === 0) return [];
      const rows = await db
        .select()
        .from(auditEvents)
        .where(and(inArray(auditEvents.action, actions), gt(auditEvents.createdAt, since), lte(auditEvents.createdAt, before)))
        .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))
        .limit(cap(limit));
      return rows.map((row) => ({ ...row, payload: (row.payload ?? {}) as Record<string, unknown> }));
    },

    async createRun(input, now) {
      const [inserted] = await db
        .insert(workflowRuns)
        .values({
          definitionId: input.definitionId,
          versionId: input.versionId,
          eventId: input.eventId,
          organisationId: input.organisationId,
          territoryId: input.territoryId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          context: input.context,
          isTest: Boolean(input.isTest),
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) return { run: asRun(inserted), created: true };
      const [existing] = await db
        .select()
        .from(workflowRuns)
        .where(and(eq(workflowRuns.definitionId, input.definitionId), input.eventId ? eq(workflowRuns.eventId, input.eventId) : isNull(workflowRuns.eventId)));
      return { run: asRun(required(existing, "Run")), created: false };
    },
    async getRun(id) {
      const [row] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
      return row ? asRun(row) : undefined;
    },
    async updateRun(id, patch, now) {
      const [row] = await db.update(workflowRuns).set({ ...patch, updatedAt: now }).where(eq(workflowRuns.id, id)).returning();
      return asRun(required(row, "Run"));
    },
    async listRuns(filter) {
      const conditions = [];
      if (filter.statuses && filter.statuses.length > 0) conditions.push(inArray(workflowRuns.status, filter.statuses));
      if (filter.territoryId) conditions.push(eq(workflowRuns.territoryId, filter.territoryId));
      if (filter.definitionId) conditions.push(eq(workflowRuns.definitionId, filter.definitionId));
      if (filter.subjectType) conditions.push(eq(workflowRuns.subjectType, filter.subjectType));
      if (filter.subjectId) conditions.push(eq(workflowRuns.subjectId, filter.subjectId));
      return (await db.select().from(workflowRuns).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(workflowRuns.createdAt)).limit(cap(filter.limit))).map(asRun);
    },
    async dueTimerRuns(now, limit) {
      return (
        await db
          .select()
          .from(workflowRuns)
          .where(and(eq(workflowRuns.status, "waiting"), eq(workflowRuns.waitingOn, "timer"), lte(workflowRuns.resumeAt, now)))
          .orderBy(asc(workflowRuns.resumeAt))
          .limit(cap(limit))
      ).map(asRun);
    },
    async getSteps(runId) {
      return (await db.select().from(workflowRunSteps).where(eq(workflowRunSteps.runId, runId)).orderBy(asc(workflowRunSteps.stepIndex))).map(asStep);
    },
    async saveStep(step) {
      const [row] = await db
        .insert(workflowRunSteps)
        .values(step)
        .onConflictDoUpdate({
          target: [workflowRunSteps.runId, workflowRunSteps.stepIndex],
          set: { action: step.action, status: step.status, attempts: step.attempts, result: step.result, error: step.error, startedAt: step.startedAt, completedAt: step.completedAt }
        })
        .returning();
      return asStep(required(row, "Step"));
    },

    async createTask(input, now) {
      const [inserted] = await db
        .insert(workflowTasks)
        .values({
          title: input.title,
          description: input.description ?? null,
          assigneeScope: input.assigneeScope,
          organisationId: input.organisationId,
          territoryId: input.territoryId,
          dueDate: input.dueDate ?? null,
          runId: input.runId,
          stepIndex: input.stepIndex,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          link: input.link ?? null,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing({ target: workflowTasks.idempotencyKey })
        .returning();
      if (inserted) return { task: asTask(inserted), created: true };
      const [existing] = await db.select().from(workflowTasks).where(eq(workflowTasks.idempotencyKey, input.idempotencyKey));
      return { task: asTask(required(existing, "Task")), created: false };
    },
    async listTasks(filter) {
      const conditions = [];
      if (filter.status) conditions.push(eq(workflowTasks.status, filter.status));
      if (filter.territoryId) conditions.push(eq(workflowTasks.territoryId, filter.territoryId));
      if (filter.assigneeScope) conditions.push(eq(workflowTasks.assigneeScope, filter.assigneeScope));
      return (await db.select().from(workflowTasks).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(workflowTasks.createdAt)).limit(cap(filter.limit))).map(asTask);
    },
    async getTask(id) {
      const [row] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, id));
      return row ? asTask(row) : undefined;
    },
    async completeTask(id, userId, now) {
      const [row] = await db
        .update(workflowTasks)
        .set({ status: "done", completedByUserId: userId, completedAt: now, updatedAt: now })
        .where(and(eq(workflowTasks.id, id), eq(workflowTasks.status, "open")))
        .returning();
      return row ? asTask(row) : undefined;
    },
    async createApproval(input, now) {
      const [inserted] = await db
        .insert(workflowApprovals)
        .values({
          runId: input.runId,
          stepIndex: input.stepIndex,
          title: input.title,
          description: input.description ?? null,
          approverScope: input.approverScope,
          organisationId: input.organisationId,
          territoryId: input.territoryId,
          expiresAt: input.expiresAt ?? null,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) return { approval: asApproval(inserted), created: true };
      const [existing] = await db.select().from(workflowApprovals).where(and(eq(workflowApprovals.runId, input.runId), eq(workflowApprovals.stepIndex, input.stepIndex)));
      return { approval: asApproval(required(existing, "Approval")), created: false };
    },
    async getApproval(runId, stepIndex) {
      const [row] = await db.select().from(workflowApprovals).where(and(eq(workflowApprovals.runId, runId), eq(workflowApprovals.stepIndex, stepIndex)));
      return row ? asApproval(row) : undefined;
    },
    async getApprovalById(id) {
      const [row] = await db.select().from(workflowApprovals).where(eq(workflowApprovals.id, id));
      return row ? asApproval(row) : undefined;
    },
    async listApprovals(filter) {
      const conditions = [];
      if (filter.status) conditions.push(eq(workflowApprovals.status, filter.status));
      if (filter.territoryId) conditions.push(eq(workflowApprovals.territoryId, filter.territoryId));
      if (filter.approverScope) conditions.push(eq(workflowApprovals.approverScope, filter.approverScope));
      return (await db.select().from(workflowApprovals).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(workflowApprovals.createdAt)).limit(cap(filter.limit))).map(asApproval);
    },
    async decideApproval(id, decision, now) {
      const [row] = await db
        .update(workflowApprovals)
        .set({ status: decision.status, decidedByUserId: decision.userId, decidedAt: now, decisionNote: decision.note ?? null, updatedAt: now })
        .where(and(eq(workflowApprovals.id, id), eq(workflowApprovals.status, "pending")))
        .returning();
      return row ? asApproval(row) : undefined;
    },
    async expireApprovals(now) {
      const rows = await db
        .update(workflowApprovals)
        .set({ status: "expired", decidedAt: now, updatedAt: now })
        .where(and(eq(workflowApprovals.status, "pending"), lte(workflowApprovals.expiresAt, now)))
        .returning();
      return rows.map(asApproval);
    },
    async createNotification(input, now) {
      const [inserted] = await db
        .insert(notifications)
        .values({
          recipientScope: input.recipientScope,
          recipientUserId: input.recipientUserId ?? null,
          organisationId: input.organisationId,
          territoryId: input.territoryId,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
          sourceType: input.sourceType ?? null,
          sourceId: input.sourceId ?? null,
          idempotencyKey: input.idempotencyKey,
          createdAt: now
        })
        .onConflictDoNothing({ target: notifications.idempotencyKey })
        .returning();
      if (inserted) return { notification: asNotification(inserted), created: true };
      const [existing] = await db.select().from(notifications).where(eq(notifications.idempotencyKey, input.idempotencyKey));
      return { notification: asNotification(required(existing, "Notification")), created: false };
    },
    async listNotifications(filter) {
      const conditions = [];
      if (filter.territoryId) conditions.push(eq(notifications.territoryId, filter.territoryId));
      if (filter.recipientScope) conditions.push(eq(notifications.recipientScope, filter.recipientScope));
      if (filter.unreadOnly) conditions.push(isNull(notifications.readAt));
      return (await db.select().from(notifications).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(notifications.createdAt)).limit(cap(filter.limit))).map(asNotification);
    }
  };
}
