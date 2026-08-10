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
  permissionRoleCreate: "permission.role.create",
  permissionRoleUpdate: "permission.role.update",
  permissionRoleDelete: "permission.role.delete",
  permissionAssignmentCreate: "permission.assignment.create",
  permissionAssignmentRevoke: "permission.assignment.revoke",
  permissionDelegationCreate: "permission.delegation.create",
  permissionDelegationRevoke: "permission.delegation.revoke",
  aiGenerate: "ai.generate",
  aiApprove: "ai.approve",
  systemRun: "system.run",
  authSignIn: "auth.sign.in",
  authSignOut: "auth.sign.out",
  authInviteSend: "auth.invite.send",
  authInviteAccept: "auth.invite.accept",
  authEmailVerify: "auth.email.verify",
  authAccountRecover: "auth.account.recover",
  authSessionRevoke: "auth.session.revoke",
  authSecurityChange: "auth.security.change",
  franchiseCreate: "franchise.create",
  franchiseUpdate: "franchise.update",
  franchiseArchive: "franchise.archive",
  franchiseContactUpdate: "franchise.contact.update",
  franchiseAgreementGenerate: "franchise.agreement.generate",
  franchiseAgreementSubmit: "franchise.agreement.submit",
  franchiseAgreementApprove: "franchise.agreement.approve",
  franchiseAgreementVoid: "franchise.agreement.void",
  franchiseAgreementSupersede: "franchise.agreement.supersede",
  franchiseAgreementSent: "franchise.agreement.sent",
  franchiseAgreementSignerCompleted: "franchise.agreement.signer.completed",
  franchiseAgreementDeclined: "franchise.agreement.declined",
  franchiseAgreementExpired: "franchise.agreement.expired",
  franchiseAgreementCancelled: "franchise.agreement.cancelled",
  franchiseAgreementExecuted: "franchise.agreement.executed",
  franchiseAgreementResent: "franchise.agreement.resent",
  franchiseAgreementReissued: "franchise.agreement.reissued"
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
