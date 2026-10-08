import type {
  ApprovalStatus,
  DefinitionStatus,
  NotificationRecord,
  RunStatus,
  RunStepRecord,
  TaskStatus,
  WaitingOn,
  WorkflowApprovalRecord,
  WorkflowCondition,
  WorkflowDefinitionRecord,
  WorkflowEventRecord,
  WorkflowRunRecord,
  WorkflowSettings,
  WorkflowStep,
  WorkflowTaskRecord,
  WorkflowVersionRecord
} from "./types";

export type NewWorkflowEvent = {
  eventKey: string;
  type: string;
  source: WorkflowEventRecord["source"];
  organisationId?: string | null;
  territoryId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  actorUserId?: string | null;
  payload?: Record<string, unknown>;
  occurredAt: Date;
};

export type NewRun = {
  definitionId: string;
  versionId: string;
  eventId: string | null;
  organisationId: string | null;
  territoryId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  context: Record<string, unknown>;
  isTest?: boolean;
};

export type RunPatch = Partial<{
  status: RunStatus;
  waitingOn: WaitingOn | null;
  resumeAt: Date | null;
  currentStep: number;
  outcome: string | null;
  lastError: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}>;

export type NewTask = {
  title: string;
  description?: string | null;
  assigneeScope: "territory" | "hq";
  organisationId: string | null;
  territoryId: string | null;
  dueDate?: Date | null;
  runId: string | null;
  stepIndex: number | null;
  subjectType: string | null;
  subjectId: string | null;
  link?: string | null;
  idempotencyKey: string;
};

export type NewApproval = {
  runId: string;
  stepIndex: number;
  title: string;
  description?: string | null;
  approverScope: "territory" | "hq";
  organisationId: string | null;
  territoryId: string | null;
  expiresAt?: Date | null;
};

export type NewNotification = {
  recipientScope: "territory" | "hq" | "user";
  recipientUserId?: string | null;
  organisationId: string | null;
  territoryId: string | null;
  title: string;
  body?: string | null;
  link?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  idempotencyKey: string;
};

export type RunFilter = { statuses?: RunStatus[]; territoryId?: string; definitionId?: string; subjectType?: string; subjectId?: string; limit?: number };

export type VersionDraft = {
  triggerEvent: string;
  conditions: WorkflowCondition[];
  steps: WorkflowStep[];
  settings: WorkflowSettings;
  changeNote?: string | null;
};

export type ActiveWorkflow = { definition: WorkflowDefinitionRecord; version: WorkflowVersionRecord };

export type AuditEventRow = {
  id: string;
  action: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string | null;
  organisationId: string | null;
  territoryId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

/**
 * Persistence port for the workflow engine. The Drizzle implementation is the real
 * one; the in-memory implementation shares these semantics so engine behaviour
 * (idempotency, immutability, one-active-version) is testable without a database.
 */
export type EngineStore = {
  // Definitions and versions
  upsertDefinition(input: { key: string; name: string; description?: string | null; status?: DefinitionStatus }, now: Date): Promise<WorkflowDefinitionRecord>;
  getDefinition(id: string): Promise<WorkflowDefinitionRecord | undefined>;
  getDefinitionByKey(key: string): Promise<WorkflowDefinitionRecord | undefined>;
  listDefinitions(): Promise<WorkflowDefinitionRecord[]>;
  setDefinitionStatus(id: string, status: DefinitionStatus, now: Date): Promise<WorkflowDefinitionRecord | undefined>;
  createVersion(definitionId: string, draft: VersionDraft, createdByUserId: string | null, now: Date): Promise<WorkflowVersionRecord>;
  getVersion(id: string): Promise<WorkflowVersionRecord | undefined>;
  listVersions(definitionId: string): Promise<WorkflowVersionRecord[]>;
  /** Only draft versions are editable; returns undefined for any other status. */
  updateDraftVersion(id: string, draft: VersionDraft, now: Date): Promise<WorkflowVersionRecord | undefined>;
  /** Atomically retires the current active version (if any) and activates this draft. */
  activateVersion(id: string, userId: string | null, now: Date): Promise<WorkflowVersionRecord | undefined>;
  listActiveWorkflows(): Promise<ActiveWorkflow[]>;

  // Events
  insertEvent(event: NewWorkflowEvent, now: Date): Promise<{ event: WorkflowEventRecord; created: boolean }>;
  pendingEvents(limit: number): Promise<WorkflowEventRecord[]>;
  markEventDispatched(id: string, now: Date): Promise<void>;
  getCursor(name: string): Promise<{ lastCreatedAt: Date; lastId: string | null } | undefined>;
  setCursor(name: string, cursor: { lastCreatedAt: Date; lastId: string | null }, now: Date): Promise<void>;
  auditEventsSince(input: { actions: string[]; since: Date; before: Date; limit: number }): Promise<AuditEventRow[]>;

  // Runs and steps
  createRun(input: NewRun, now: Date): Promise<{ run: WorkflowRunRecord; created: boolean }>;
  getRun(id: string): Promise<WorkflowRunRecord | undefined>;
  updateRun(id: string, patch: RunPatch, now: Date): Promise<WorkflowRunRecord>;
  listRuns(filter: RunFilter): Promise<WorkflowRunRecord[]>;
  dueTimerRuns(now: Date, limit: number): Promise<WorkflowRunRecord[]>;
  getSteps(runId: string): Promise<RunStepRecord[]>;
  saveStep(step: Omit<RunStepRecord, "id">): Promise<RunStepRecord>;

  // Effects: each keyed so a repeated call is a no-op
  createTask(input: NewTask, now: Date): Promise<{ task: WorkflowTaskRecord; created: boolean }>;
  listTasks(filter: { status?: TaskStatus; territoryId?: string; assigneeScope?: "territory" | "hq"; limit?: number }): Promise<WorkflowTaskRecord[]>;
  getTask(id: string): Promise<WorkflowTaskRecord | undefined>;
  completeTask(id: string, userId: string, now: Date): Promise<WorkflowTaskRecord | undefined>;
  createApproval(input: NewApproval, now: Date): Promise<{ approval: WorkflowApprovalRecord; created: boolean }>;
  getApproval(runId: string, stepIndex: number): Promise<WorkflowApprovalRecord | undefined>;
  getApprovalById(id: string): Promise<WorkflowApprovalRecord | undefined>;
  listApprovals(filter: { status?: ApprovalStatus; territoryId?: string; approverScope?: "territory" | "hq"; limit?: number }): Promise<WorkflowApprovalRecord[]>;
  /** Decides a pending approval exactly once; returns undefined if it was not pending. */
  decideApproval(id: string, decision: { status: "approved" | "rejected"; userId: string; note?: string | null }, now: Date): Promise<WorkflowApprovalRecord | undefined>;
  expireApprovals(now: Date): Promise<WorkflowApprovalRecord[]>;
  createNotification(input: NewNotification, now: Date): Promise<{ notification: NotificationRecord; created: boolean }>;
  listNotifications(filter: { territoryId?: string; recipientScope?: "territory" | "hq" | "user"; unreadOnly?: boolean; limit?: number }): Promise<NotificationRecord[]>;
};
