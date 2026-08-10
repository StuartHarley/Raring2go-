import type { createDb } from "@raring2go/db";
import type { AuditAction } from "./actions";

export type AuditDatabase = Pick<ReturnType<typeof createDb>["db"], "insert" | "select">;

export type AuditActor =
  | {
      type: "human";
      userId: string;
    }
  | {
      type: "system";
      systemId: string;
      displayName?: string;
    }
  | {
      type: "automation";
      automationId: string;
      runId?: string;
      displayName?: string;
    }
  | {
      type: "ai";
      runId?: string;
      model?: string;
      provider?: string;
      mode: "suggested" | "human_approved" | "auto_performed";
      approvedByUserId?: string;
    };

export type AuditEntity = {
  type: string;
  id?: string;
};

export type AuditScope = {
  organisationId?: string;
  territoryId?: string;
};

export type AuditChange = {
  field: string;
  before: unknown;
  after: unknown;
};

export type AuditContext = {
  correlationId?: string;
  requestId?: string;
  idempotencyKey?: string;
  sourceEventId?: string;
  jobId?: string;
};

export type AuditPayload = {
  actor: AuditActor;
  context?: AuditContext;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  changes?: AuditChange[];
  metadata?: Record<string, unknown>;
};

export type RecordAuditEventInput = {
  action: AuditAction;
  actor: AuditActor;
  entity: AuditEntity;
  scope?: AuditScope;
  context?: AuditContext;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  changes?: AuditChange[];
  metadata?: Record<string, unknown>;
};

export type AuditEventRecord = {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  organisationId: string | null;
  territoryId: string | null;
  payload: unknown;
  createdAt: Date;
};

export type AuditEventQuery = {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  organisationId?: string;
  territoryId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
};
