import { auditEvents } from "@raring2go/db";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { assertAuditAction } from "./actions";
import { redactSensitiveData } from "./redaction";
import type {
  AuditDatabase,
  AuditEventQuery,
  AuditEventRecord,
  AuditPayload,
  RecordAuditEventInput
} from "./types";

const defaultLimit = 50;
const maxLimit = 250;

export async function recordAuditEvent(
  db: AuditDatabase,
  input: RecordAuditEventInput
): Promise<AuditEventRecord> {
  assertAuditAction(input.action);

  const payload: AuditPayload = redactSensitiveData({
    actor: input.actor,
    context: input.context,
    before: input.before,
    after: input.after,
    changes: input.changes,
    metadata: input.metadata
  });

  const [event] = await db
    .insert(auditEvents)
    .values({
      actorUserId: input.actor.type === "human" ? input.actor.userId : null,
      action: input.action,
      entityType: input.entity.type,
      entityId: input.entity.id,
      organisationId: input.scope?.organisationId,
      territoryId: input.scope?.territoryId,
      payload
    })
    .returning();

  if (!event) {
    throw new Error("Audit event was not recorded.");
  }

  return event;
}

export async function recordAuditEvents(
  db: AuditDatabase,
  inputs: RecordAuditEventInput[]
): Promise<AuditEventRecord[]> {
  const events: AuditEventRecord[] = [];

  for (const input of inputs) {
    events.push(await recordAuditEvent(db, input));
  }

  return events;
}

export async function listAuditEvents(
  db: AuditDatabase,
  query: AuditEventQuery
): Promise<AuditEventRecord[]> {
  const filters = [
    query.actorUserId ? eq(auditEvents.actorUserId, query.actorUserId) : undefined,
    query.action ? eq(auditEvents.action, query.action) : undefined,
    query.entityType ? eq(auditEvents.entityType, query.entityType) : undefined,
    query.entityId ? eq(auditEvents.entityId, query.entityId) : undefined,
    query.organisationId
      ? eq(auditEvents.organisationId, query.organisationId)
      : undefined,
    query.territoryId ? eq(auditEvents.territoryId, query.territoryId) : undefined,
    query.from ? gte(auditEvents.createdAt, query.from) : undefined,
    query.to ? lte(auditEvents.createdAt, query.to) : undefined
  ].filter((filter) => filter !== undefined);

  const limit = Math.min(query.limit ?? defaultLimit, maxLimit);

  return db
    .select()
    .from(auditEvents)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(auditEvents.createdAt), asc(auditEvents.id))
    .limit(limit);
}
