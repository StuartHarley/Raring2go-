import type { AuditEventRow, EngineStore, NewWorkflowEvent } from "./store";

export const AUDIT_CURSOR = "audit";
/** Set once when ingestion first runs; the overlap window can never reach back past it. */
export const AUDIT_FLOOR = "audit:floor";
/**
 * An audit row's `created_at` is the transaction start, not its commit time, so a
 * slow transaction can become visible after newer rows were already scanned. Each
 * scan therefore re-reads a trailing window; the unique event key makes the overlap free.
 */
export const DEFAULT_OVERLAP_MS = 10 * 60_000;

export type IngestResult = { scanned: number; ingested: number };

export function workflowEventFromAudit(row: AuditEventRow): NewWorkflowEvent {
  const payload = row.payload ?? {};
  const after = (payload.after ?? {}) as Record<string, unknown>;
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  const actor = (payload.actor ?? {}) as { type?: string };

  return {
    eventKey: `audit:${row.id}`,
    type: row.action,
    source: "audit",
    organisationId: row.organisationId,
    territoryId: row.territoryId,
    subjectType: row.entityType,
    subjectId: row.entityId,
    actorUserId: row.actorUserId,
    payload: { ...after, ...metadata, entityType: row.entityType, entityId: row.entityId, auditEventId: row.id, actorType: actor.type ?? null },
    occurredAt: row.createdAt
  };
}

/**
 * Copies audit events that some active workflow listens for into the workflow event
 * stream. Idempotent: re-ingesting the same audit row is a no-op.
 *
 * On first run there is no cursor: it is created at "now" and nothing is ingested, so
 * switching the engine on never replays history into live workflows.
 */
export async function ingestAuditEvents(
  store: EngineStore,
  now: Date,
  options: { overlapMs?: number; limit?: number; cursorName?: string } = {}
): Promise<IngestResult> {
  const overlapMs = options.overlapMs ?? DEFAULT_OVERLAP_MS;
  const limit = options.limit ?? 200;

  const cursorName = options.cursorName ?? AUDIT_CURSOR;
  const floorName = `${cursorName}:floor`;
  const cursor = await store.getCursor(cursorName);
  if (!cursor) {
    await store.setCursor(floorName, { lastCreatedAt: now, lastId: null }, now);
    await store.setCursor(cursorName, { lastCreatedAt: now, lastId: null }, now);
    return { scanned: 0, ingested: 0 };
  }

  const floor = (await store.getCursor(floorName))?.lastCreatedAt ?? cursor.lastCreatedAt;

  const triggers = [...new Set((await store.listActiveWorkflows()).map((workflow) => workflow.version.triggerEvent))];
  const since = new Date(Math.max(cursor.lastCreatedAt.getTime() - overlapMs, floor.getTime()));
  const rows = triggers.length > 0 ? await store.auditEventsSince({ actions: triggers, since, before: now, limit }) : [];

  let ingested = 0;
  for (const row of rows) {
    const { created } = await store.insertEvent(workflowEventFromAudit(row), now);
    if (created) ingested += 1;
  }

  // Caught up: move to the edge of the overlap window. Hit the limit: resume from the last row.
  const caughtUp = rows.length < limit;
  const last = rows[rows.length - 1];
  const next = caughtUp ? new Date(Math.max(cursor.lastCreatedAt.getTime(), now.getTime() - overlapMs)) : last!.createdAt;
  await store.setCursor(cursorName, { lastCreatedAt: next, lastId: last?.id ?? cursor.lastId }, now);

  return { scanned: rows.length, ingested };
}

/** Producer for non-audit events (scanners, manual). Idempotent on `eventKey`. */
export async function emitWorkflowEvent(store: EngineStore, event: NewWorkflowEvent, now: Date = new Date()) {
  return store.insertEvent(event, now);
}
