import { auditActions, recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import { enforceRetention } from "@raring2go/security";
import { defineJobHandler } from "@raring2go/workflows";
import type { JobHandler } from "@raring2go/workflows";
import { appLogger } from "./logger";

export const ENFORCE_RETENTION_KIND = "security.enforce_retention";
export const enforceRetentionIdempotencyKey = (now: Date) => `${ENFORCE_RETENTION_KIND}:${now.toISOString().slice(0, 10)}`;

/**
 * Daily: delete security data that has outlived its retention period (sessions, sign-in links,
 * invitations, expired public analytics, rate-limit counters). The result is audited as counts so
 * there is a record of what was purged without keeping what was purged.
 */
export function createEnforceRetentionHandler(): JobHandler {
  return defineJobHandler({
    kind: ENFORCE_RETENTION_KIND,
    maxAttempts: 3,
    handle: async ({ now }) => {
      const { db, sql } = createDb();
      try {
        const counts = await enforceRetention(db, now());
        await recordAuditEvent(db, {
          action: auditActions.securityRetentionEnforce,
          actor: { type: "system", systemId: "retention-job", displayName: "Retention job" },
          entity: { type: "retention_run" },
          metadata: { counts }
        });
        appLogger.info("retention enforced", counts);
      } finally {
        await sql.end();
      }
    }
  });
}
