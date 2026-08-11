import { listAuditEvents } from "@raring2go/audit";
import { createDb } from "@raring2go/db";

export async function readRecentAuditEvents() {
  const { db, sql } = createDb();

  try {
    return await listAuditEvents(db, {
      limit: 40
    });
  } finally {
    await sql.end();
  }
}
