export const auditActions = {
  recordCreate: "record.create",
  recordUpdate: "record.update",
  recordDelete: "record.delete",
  recordApprove: "record.approve",
  recordPublish: "record.publish",
  recordSign: "record.sign",
  recordSend: "record.send",
  permissionAssign: "permission.assign",
  permissionRevoke: "permission.revoke",
  aiGenerate: "ai.generate",
  aiApprove: "ai.approve",
  systemRun: "system.run"
} as const;

export type AuditAction = (typeof auditActions)[keyof typeof auditActions] | (string & {});

const actionPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

export function assertAuditAction(action: string) {
  if (!actionPattern.test(action)) {
    throw new Error(
      `Invalid audit action "${action}". Use stable dot-case names such as "record.update".`
    );
  }
}
