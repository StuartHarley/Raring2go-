export type ConditionOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "exists" | "contains";

/** `field` is a dotted path into the event context, e.g. `event.payload.balanceMinor`. */
export type WorkflowCondition = { field: string; op: ConditionOp; value?: unknown };

/** A number written inline, or the name of a threshold in the version's `settings`. */
export type NumberRef = number | { setting: string };

export type WorkflowStep =
  | { type: "create_task"; title: string; description?: string; assignee: "territory" | "hq"; dueInDays?: NumberRef; link?: string }
  | { type: "notify"; audience: "territory" | "hq"; title: string; body?: string; link?: string }
  | { type: "request_approval"; approver: "territory" | "hq"; title: string; description?: string; expiresInDays?: NumberRef }
  | { type: "wait"; days?: NumberRef; hours?: NumberRef }
  | { type: "guard"; check: string; params?: Record<string, unknown> }
  | { type: "run_action"; action: string; params?: Record<string, unknown> };

export type WorkflowStepType = WorkflowStep["type"];
export const workflowStepTypes: WorkflowStepType[] = ["create_task", "notify", "request_approval", "wait", "guard", "run_action"];

export type WorkflowSettings = Record<string, number | string | boolean>;

export type DefinitionStatus = "enabled" | "disabled";
export type VersionStatus = "draft" | "active" | "retired";

export type WorkflowDefinitionRecord = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: DefinitionStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkflowVersionRecord = {
  id: string;
  definitionId: string;
  versionNumber: number;
  status: VersionStatus;
  triggerEvent: string;
  conditions: WorkflowCondition[];
  steps: WorkflowStep[];
  settings: WorkflowSettings;
  changeNote: string | null;
  createdByUserId: string | null;
  activatedByUserId: string | null;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkflowEventRecord = {
  id: string;
  eventKey: string;
  type: string;
  source: "audit" | "scanner" | "manual";
  organisationId: string | null;
  territoryId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  actorUserId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
  dispatchedAt: Date | null;
  createdAt: Date;
};

export type RunStatus = "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type WaitingOn = "timer" | "approval";

export type WorkflowRunRecord = {
  id: string;
  definitionId: string;
  versionId: string;
  eventId: string | null;
  status: RunStatus;
  waitingOn: WaitingOn | null;
  resumeAt: Date | null;
  currentStep: number;
  organisationId: string | null;
  territoryId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  context: Record<string, unknown>;
  isTest: boolean;
  outcome: string | null;
  lastError: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StepStatus = "pending" | "completed" | "waiting" | "skipped" | "failed";

export type RunStepRecord = {
  id: string;
  runId: string;
  stepIndex: number;
  action: string;
  status: StepStatus;
  attempts: number;
  result: Record<string, unknown>;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type TaskStatus = "open" | "done" | "cancelled";

export type WorkflowTaskRecord = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeScope: "territory" | "hq";
  organisationId: string | null;
  territoryId: string | null;
  assignedUserId: string | null;
  dueDate: Date | null;
  runId: string | null;
  stepIndex: number | null;
  subjectType: string | null;
  subjectId: string | null;
  link: string | null;
  idempotencyKey: string;
  completedByUserId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type WorkflowApprovalRecord = {
  id: string;
  runId: string;
  stepIndex: number;
  title: string;
  description: string | null;
  approverScope: "territory" | "hq";
  organisationId: string | null;
  territoryId: string | null;
  status: ApprovalStatus;
  expiresAt: Date | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationRecord = {
  id: string;
  recipientScope: "territory" | "hq" | "user";
  recipientUserId: string | null;
  organisationId: string | null;
  territoryId: string | null;
  title: string;
  body: string | null;
  link: string | null;
  sourceType: string | null;
  sourceId: string | null;
  idempotencyKey: string;
  readAt: Date | null;
  createdAt: Date;
};

/** What a template/condition can see. Nothing else is reachable from a workflow definition. */
export type EvaluationContext = {
  event: {
    type: string;
    subjectType: string | null;
    subjectId: string | null;
    actorUserId: string | null;
    occurredAt: string;
    payload: Record<string, unknown>;
  };
  scope: { organisationId: string | null; territoryId: string | null };
  settings: WorkflowSettings;
};
