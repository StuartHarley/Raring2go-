import { randomUUID } from "node:crypto";
import type { AuditEventRow, EngineStore, NewApproval, NewNotification, NewRun, NewTask, NewWorkflowEvent, RunFilter, RunPatch, VersionDraft } from "./store";
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

/** In-memory EngineStore mirroring the database constraints (unique keys, one active version, draft-only edits). */
export function createInMemoryEngineStore(seed: { auditEvents?: AuditEventRow[] } = {}) {
  const definitions = new Map<string, WorkflowDefinitionRecord>();
  const versions = new Map<string, WorkflowVersionRecord>();
  const events = new Map<string, WorkflowEventRecord>();
  const cursors = new Map<string, { lastCreatedAt: Date; lastId: string | null }>();
  const runs = new Map<string, WorkflowRunRecord>();
  const steps = new Map<string, RunStepRecord>();
  const tasks = new Map<string, WorkflowTaskRecord>();
  const approvals = new Map<string, WorkflowApprovalRecord>();
  const notifications = new Map<string, NotificationRecord>();
  const auditEvents: AuditEventRow[] = [...(seed.auditEvents ?? [])];

  const find = <T>(map: Map<string, T>, predicate: (value: T) => boolean) => [...map.values()].find(predicate);

  const store: EngineStore = {
    async upsertDefinition(input, now) {
      const existing = find(definitions, (d) => d.key === input.key);
      if (existing) {
        const next = { ...existing, name: input.name, description: input.description ?? existing.description, status: input.status ?? existing.status, updatedAt: now };
        definitions.set(existing.id, next);
        return next;
      }
      const record: WorkflowDefinitionRecord = {
        id: randomUUID(),
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        status: input.status ?? "enabled",
        createdAt: now,
        updatedAt: now
      };
      definitions.set(record.id, record);
      return record;
    },
    async getDefinition(id) {
      return definitions.get(id);
    },
    async getDefinitionByKey(key) {
      return find(definitions, (d) => d.key === key);
    },
    async listDefinitions() {
      return [...definitions.values()].sort((a, b) => a.key.localeCompare(b.key));
    },
    async setDefinitionStatus(id, status, now) {
      const existing = definitions.get(id);
      if (!existing) return undefined;
      const next = { ...existing, status, updatedAt: now };
      definitions.set(id, next);
      return next;
    },
    async createVersion(definitionId, draft, createdByUserId, now) {
      const number = Math.max(0, ...[...versions.values()].filter((v) => v.definitionId === definitionId).map((v) => v.versionNumber)) + 1;
      const record: WorkflowVersionRecord = {
        id: randomUUID(),
        definitionId,
        versionNumber: number,
        status: "draft",
        triggerEvent: draft.triggerEvent,
        conditions: structuredClone(draft.conditions),
        steps: structuredClone(draft.steps),
        settings: { ...draft.settings },
        changeNote: draft.changeNote ?? null,
        createdByUserId,
        activatedByUserId: null,
        activatedAt: null,
        createdAt: now,
        updatedAt: now
      };
      versions.set(record.id, record);
      return record;
    },
    async getVersion(id) {
      return versions.get(id);
    },
    async listVersions(definitionId) {
      return [...versions.values()].filter((v) => v.definitionId === definitionId).sort((a, b) => b.versionNumber - a.versionNumber);
    },
    async updateDraftVersion(id, draft: VersionDraft, now) {
      const existing = versions.get(id);
      if (!existing || existing.status !== "draft") return undefined;
      const next: WorkflowVersionRecord = {
        ...existing,
        triggerEvent: draft.triggerEvent,
        conditions: structuredClone(draft.conditions),
        steps: structuredClone(draft.steps),
        settings: { ...draft.settings },
        changeNote: draft.changeNote ?? existing.changeNote,
        updatedAt: now
      };
      versions.set(id, next);
      return next;
    },
    async activateVersion(id, userId, now) {
      const target = versions.get(id);
      if (!target || target.status !== "draft") return undefined;
      for (const version of versions.values()) {
        if (version.definitionId === target.definitionId && version.status === "active") {
          versions.set(version.id, { ...version, status: "retired", updatedAt: now });
        }
      }
      const activated = { ...target, status: "active" as const, activatedByUserId: userId, activatedAt: now, updatedAt: now };
      versions.set(id, activated);
      return activated;
    },
    async listActiveWorkflows() {
      return [...versions.values()]
        .filter((version) => version.status === "active")
        .flatMap((version) => {
          const definition = definitions.get(version.definitionId);
          return definition && definition.status === "enabled" ? [{ definition, version }] : [];
        });
    },

    async insertEvent(input: NewWorkflowEvent, now) {
      const existing = find(events, (e) => e.eventKey === input.eventKey);
      if (existing) return { event: existing, created: false };
      const record: WorkflowEventRecord = {
        id: randomUUID(),
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
        dispatchedAt: null,
        createdAt: now
      };
      events.set(record.id, record);
      return { event: record, created: true };
    },
    async pendingEvents(limit) {
      return [...events.values()].filter((e) => !e.dispatchedAt).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()).slice(0, limit);
    },
    async markEventDispatched(id, now) {
      const existing = events.get(id);
      if (existing) events.set(id, { ...existing, dispatchedAt: now });
    },
    async getCursor(name) {
      return cursors.get(name);
    },
    async setCursor(name, cursor) {
      cursors.set(name, cursor);
    },
    async auditEventsSince({ actions, since, before, limit }) {
      return auditEvents
        .filter((row) => actions.includes(row.action) && row.createdAt > since && row.createdAt <= before)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .slice(0, limit);
    },

    async createRun(input: NewRun, now) {
      const existing = input.eventId ? find(runs, (r) => r.definitionId === input.definitionId && r.eventId === input.eventId) : undefined;
      if (existing) return { run: existing, created: false };
      const record: WorkflowRunRecord = {
        id: randomUUID(),
        definitionId: input.definitionId,
        versionId: input.versionId,
        eventId: input.eventId,
        status: "pending",
        waitingOn: null,
        resumeAt: null,
        currentStep: 0,
        organisationId: input.organisationId,
        territoryId: input.territoryId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        context: input.context,
        isTest: Boolean(input.isTest),
        outcome: null,
        lastError: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now
      };
      runs.set(record.id, record);
      return { run: record, created: true };
    },
    async getRun(id) {
      return runs.get(id);
    },
    async updateRun(id, patch: RunPatch, now) {
      const existing = runs.get(id);
      if (!existing) throw new Error(`Run ${id} not found.`);
      const next = { ...existing, ...patch, updatedAt: now };
      runs.set(id, next);
      return next;
    },
    async listRuns(filter: RunFilter) {
      return [...runs.values()]
        .filter((r) => !filter.statuses || filter.statuses.includes(r.status))
        .filter((r) => !filter.territoryId || r.territoryId === filter.territoryId)
        .filter((r) => !filter.definitionId || r.definitionId === filter.definitionId)
        .filter((r) => !filter.subjectType || r.subjectType === filter.subjectType)
        .filter((r) => !filter.subjectId || r.subjectId === filter.subjectId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, filter.limit ?? 100);
    },
    async dueTimerRuns(now, limit) {
      return [...runs.values()]
        .filter((r) => r.status === "waiting" && r.waitingOn === "timer" && r.resumeAt != null && r.resumeAt <= now)
        .sort((a, b) => a.resumeAt!.getTime() - b.resumeAt!.getTime())
        .slice(0, limit);
    },
    async getSteps(runId) {
      return [...steps.values()].filter((s) => s.runId === runId).sort((a, b) => a.stepIndex - b.stepIndex);
    },
    async saveStep(step) {
      const existing = find(steps, (s) => s.runId === step.runId && s.stepIndex === step.stepIndex);
      const record: RunStepRecord = { id: existing?.id ?? randomUUID(), ...step };
      steps.set(record.id, record);
      return record;
    },

    async createTask(input: NewTask, now) {
      const existing = find(tasks, (t) => t.idempotencyKey === input.idempotencyKey);
      if (existing) return { task: existing, created: false };
      const record: WorkflowTaskRecord = {
        id: randomUUID(),
        title: input.title,
        description: input.description ?? null,
        status: "open",
        assigneeScope: input.assigneeScope,
        organisationId: input.organisationId,
        territoryId: input.territoryId,
        assignedUserId: null,
        dueDate: input.dueDate ?? null,
        runId: input.runId,
        stepIndex: input.stepIndex,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        link: input.link ?? null,
        idempotencyKey: input.idempotencyKey,
        completedByUserId: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now
      };
      tasks.set(record.id, record);
      return { task: record, created: true };
    },
    async listTasks(filter) {
      return [...tasks.values()]
        .filter((t) => !filter.status || t.status === filter.status)
        .filter((t) => !filter.territoryId || t.territoryId === filter.territoryId)
        .filter((t) => !filter.assigneeScope || t.assigneeScope === filter.assigneeScope)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, filter.limit ?? 100);
    },
    async getTask(id) {
      return tasks.get(id);
    },
    async completeTask(id, userId, now) {
      const existing = tasks.get(id);
      if (!existing || existing.status !== "open") return undefined;
      const next = { ...existing, status: "done" as const, completedByUserId: userId, completedAt: now, updatedAt: now };
      tasks.set(id, next);
      return next;
    },
    async createApproval(input: NewApproval, now) {
      const existing = find(approvals, (a) => a.runId === input.runId && a.stepIndex === input.stepIndex);
      if (existing) return { approval: existing, created: false };
      const record: WorkflowApprovalRecord = {
        id: randomUUID(),
        runId: input.runId,
        stepIndex: input.stepIndex,
        title: input.title,
        description: input.description ?? null,
        approverScope: input.approverScope,
        organisationId: input.organisationId,
        territoryId: input.territoryId,
        status: "pending",
        expiresAt: input.expiresAt ?? null,
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        createdAt: now,
        updatedAt: now
      };
      approvals.set(record.id, record);
      return { approval: record, created: true };
    },
    async getApproval(runId, stepIndex) {
      return find(approvals, (a) => a.runId === runId && a.stepIndex === stepIndex);
    },
    async getApprovalById(id) {
      return approvals.get(id);
    },
    async listApprovals(filter) {
      return [...approvals.values()]
        .filter((a) => !filter.status || a.status === filter.status)
        .filter((a) => !filter.territoryId || a.territoryId === filter.territoryId)
        .filter((a) => !filter.approverScope || a.approverScope === filter.approverScope)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, filter.limit ?? 100);
    },
    async decideApproval(id, decision, now) {
      const existing = approvals.get(id);
      if (!existing || existing.status !== "pending") return undefined;
      const next = { ...existing, status: decision.status, decidedByUserId: decision.userId, decidedAt: now, decisionNote: decision.note ?? null, updatedAt: now };
      approvals.set(id, next);
      return next;
    },
    async expireApprovals(now) {
      const expired: WorkflowApprovalRecord[] = [];
      for (const approval of approvals.values()) {
        if (approval.status === "pending" && approval.expiresAt && approval.expiresAt <= now) {
          const next = { ...approval, status: "expired" as const, decidedAt: now, updatedAt: now };
          approvals.set(approval.id, next);
          expired.push(next);
        }
      }
      return expired;
    },
    async createNotification(input: NewNotification, now) {
      const existing = find(notifications, (n) => n.idempotencyKey === input.idempotencyKey);
      if (existing) return { notification: existing, created: false };
      const record: NotificationRecord = {
        id: randomUUID(),
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
        readAt: null,
        createdAt: now
      };
      notifications.set(record.id, record);
      return { notification: record, created: true };
    },
    async listNotifications(filter) {
      return [...notifications.values()]
        .filter((n) => !filter.territoryId || n.territoryId === filter.territoryId)
        .filter((n) => !filter.recipientScope || n.recipientScope === filter.recipientScope)
        .filter((n) => !filter.unreadOnly || !n.readAt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, filter.limit ?? 100);
    }
  };

  return Object.assign(store, { auditEvents, definitions, versions, events, runs, steps, tasks, approvals, notifications });
}
