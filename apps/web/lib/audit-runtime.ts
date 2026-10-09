import { listAuditEventPage } from "@raring2go/audit";
import { createDb } from "@raring2go/db";

export const AUDIT_PAGE_SIZE = 40;

export type AuditFilters = {
  actionPrefix?: string;
  entityType?: string;
  actorUserId?: string;
  territoryId?: string;
  from?: string;
  to?: string;
  /** `<ISO time>_<event id>` of the last row on the previous page. */
  before?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: string | undefined, max = 80) => (value?.trim() ? value.trim().slice(0, max) : undefined);
const asDate = (value: string | undefined, endOfDay = false) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/** Everything here arrives from a query string, so it is validated; a malformed value is ignored rather than trusted. */
export function parseAuditFilters(raw: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (key: string) => (Array.isArray(raw[key]) ? raw[key]![0] : (raw[key] as string | undefined));
  const actor = clean(one("actor"));
  const territory = clean(one("territory"));
  return {
    actionPrefix: clean(one("action")),
    entityType: clean(one("entity")),
    actorUserId: actor && UUID.test(actor) ? actor : undefined,
    territoryId: territory && UUID.test(territory) ? territory : undefined,
    from: asDate(one("from")) ? one("from") : undefined,
    to: asDate(one("to")) ? one("to") : undefined,
    before: clean(one("before"), 100)
  };
}

function parseCursor(value?: string) {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)_([0-9a-f-]{36})$/i);
  return match && UUID.test(match[2]!) ? { createdAt: match[1]!, id: match[2]! } : undefined;
}

/** One page of the audit trail, newest first. `nextCursor` is set when older events exist. */
export async function readAuditEvents(filters: AuditFilters = {}) {
  const { db, sql } = createDb();
  try {
    const rows = await listAuditEventPage(db, {
      actionPrefix: filters.actionPrefix,
      entityType: filters.entityType,
      actorUserId: filters.actorUserId,
      territoryId: filters.territoryId,
      from: asDate(filters.from),
      to: asDate(filters.to, true),
      before: parseCursor(filters.before),
      limit: AUDIT_PAGE_SIZE + 1
    });
    const page = rows.slice(0, AUDIT_PAGE_SIZE);
    const last = page[page.length - 1];
    return { events: page, nextCursor: rows.length > AUDIT_PAGE_SIZE && last ? `${last.cursor}_${last.id}` : null };
  } finally {
    await sql.end();
  }
}

export async function readRecentAuditEvents() {
  return (await readAuditEvents()).events;
}
