import { recordAuditEvent } from "@raring2go/audit";
import type { RecordAuditEventInput } from "@raring2go/audit";
import { advertisingCapabilities } from "@raring2go/advertising";
import type { AdvertisingActorContext } from "@raring2go/advertising";
import type { PermissionData } from "@raring2go/permissions";

/**
 * Identity for advertising work no person is doing: a payment provider's signed callback recording and allocating a
 * payment. It exists only in memory for the run, holds advertising capabilities at network scope, and appears in
 * the audit trail as automation.
 */
export function systemAdvertisingIdentity(systemUserId: string, automationId: string) {
  const roleId = `${systemUserId}-role`;
  const context: AdvertisingActorContext = { userId: systemUserId, organisationId: "system" };
  const permissions: PermissionData = {
    roleAssignments: [{ id: `${systemUserId}-assignment`, userId: systemUserId, roleId }],
    rolePermissions: Object.values(advertisingCapabilities).map((capability) => ({
      roleId,
      permission: { id: `${systemUserId}:${capability.module}:${capability.action}`, module: capability.module, action: capability.action },
      scope: "network"
    }))
  };

  const audit = (db: Parameters<typeof recordAuditEvent>[0]) => ({
    record: async (event: { action: string; actorUserId?: string | null; entityType: string; entityId?: string | null; organisationId?: string | null; territoryId?: string | null; payload?: Record<string, unknown> }) => {
      await recordAuditEvent(db, {
        action: event.action,
        actor: { type: "automation", automationId },
        entity: { type: event.entityType, id: event.entityId ?? undefined },
        scope: { organisationId: event.organisationId && event.organisationId !== "system" ? event.organisationId : undefined, territoryId: event.territoryId ?? undefined },
        after: event.payload
      } satisfies RecordAuditEventInput);
    }
  });

  return { context, permissions, audit };
}
