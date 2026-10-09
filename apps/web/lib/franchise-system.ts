import { recordAuditEvent } from "@raring2go/audit";
import type { RecordAuditEventInput } from "@raring2go/audit";
import { franchiseCapabilities } from "@raring2go/franchise";
import type { FranchiseActorContext } from "@raring2go/franchise";
import type { PermissionData } from "@raring2go/permissions";

/**
 * Identities for work no person is doing (scheduled jobs, provider callbacks). They exist only in memory for the
 * run, hold franchise capabilities at network scope, and are recorded in the audit trail as automation.
 */
export function systemFranchiseIdentity(systemUserId: string, automationId: string) {
  const roleId = `${systemUserId}-role`;
  const context: FranchiseActorContext = { userId: systemUserId, organisationId: "system" };
  const permissions: PermissionData = {
    roleAssignments: [{ id: `${systemUserId}-assignment`, userId: systemUserId, roleId }],
    rolePermissions: Object.values(franchiseCapabilities).map((capability) => ({
      roleId,
      permission: { id: `${systemUserId}:${capability.module}:${capability.action}`, module: capability.module, action: capability.action },
      scope: "network"
    }))
  };

  /** The franchise domain records events as a "human" actor; ours is not a person, so those are re-labelled as automation. */
  const audit = (db: Parameters<typeof recordAuditEvent>[0]) => ({
    record: async (input: RecordAuditEventInput) => {
      const actor = input.actor.type === "human" && input.actor.userId === systemUserId ? ({ type: "automation", automationId } as const) : input.actor;
      await recordAuditEvent(db, { ...input, actor });
    }
  });

  return { context, permissions, audit };
}
