import { recordAuditEvent } from "@raring2go/audit";

/** Adapts the advertising domain's audit port to the real audit table, inside the caller's transaction. */
export function advertisingAuditFor(db: Parameters<typeof recordAuditEvent>[0]) {
  return {
    record: (event: { action: string; actorUserId?: string | null; entityType: string; entityId?: string | null; organisationId?: string | null; territoryId?: string | null; payload?: Record<string, unknown> }) =>
      recordAuditEvent(db, {
        action: event.action,
        actor: { type: "human", userId: event.actorUserId ?? "" },
        entity: { type: event.entityType, id: event.entityId ?? undefined },
        scope: { organisationId: event.organisationId ?? undefined, territoryId: event.territoryId ?? undefined },
        after: event.payload
      }).then(() => undefined)
  };
}
