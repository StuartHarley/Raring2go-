import { auditActions } from "@raring2go/audit";
import type {
  AuditActor,
  AuditChange,
  AuditContext,
  AuditScope,
  RecordAuditEventInput
} from "@raring2go/audit";

export const permissionAuditActions = {
  roleCreate: auditActions.permissionRoleCreate,
  roleUpdate: auditActions.permissionRoleUpdate,
  roleDelete: auditActions.permissionRoleDelete,
  assignmentCreate: auditActions.permissionAssignmentCreate,
  assignmentRevoke: auditActions.permissionAssignmentRevoke,
  delegationCreate: auditActions.permissionDelegationCreate,
  delegationRevoke: auditActions.permissionDelegationRevoke
} as const;

export type PermissionAuditAction =
  (typeof permissionAuditActions)[keyof typeof permissionAuditActions];

export type PermissionAuditEventInput = {
  action: PermissionAuditAction;
  actor: AuditActor;
  entityType: "role" | "role_assignment" | "delegation" | "permission";
  entityId?: string;
  scope?: AuditScope;
  context?: AuditContext;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  changes?: AuditChange[];
  metadata?: Record<string, unknown>;
};

export function createPermissionAuditEvent(
  input: PermissionAuditEventInput
): RecordAuditEventInput {
  return {
    action: input.action,
    actor: input.actor,
    entity: {
      type: input.entityType,
      id: input.entityId
    },
    scope: input.scope,
    context: input.context,
    before: input.before,
    after: input.after,
    changes: input.changes,
    metadata: input.metadata
  };
}
