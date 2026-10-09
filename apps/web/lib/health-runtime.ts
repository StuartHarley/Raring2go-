import { createDb } from "@raring2go/db";
import { evaluateQueueHealth, runHealthChecks } from "@raring2go/observability";
import type { HealthCheck } from "@raring2go/observability";
import { checkSecurityConfig } from "@raring2go/security";
import { readQueueStats } from "@raring2go/workflows";
import { sql as rawSql } from "drizzle-orm";

export function buildHealthChecks(): HealthCheck[] {
  return [
    {
      name: "database",
      critical: true,
      async run() {
        const { db, sql } = createDb();
        try {
          await db.execute(rawSql`select 1`);
          return { status: "ok", detail: "reachable" };
        } finally {
          await sql.end();
        }
      }
    },
    {
      name: "job_queue",
      critical: false,
      async run() {
        const { db, sql } = createDb();
        try {
          return evaluateQueueHealth(await readQueueStats(db, new Date()));
        } finally {
          await sql.end();
        }
      }
    },
    {
      name: "accounting_sync",
      critical: false,
      async run() {
        const { db, sql } = createDb();
        try {
          const rows = (await db.execute(rawSql`
            select count(*) filter (where status = 'failed')::int as failed,
                   count(*) filter (where status = 'pending' and created_at < now() - interval '1 day')::int as stale
            from advertiser_provider_sync_references where provider_type = 'accounting'`)) as unknown as Array<{ failed: number; stale: number }>;
          const { failed = 0, stale = 0 } = rows[0] ?? {};
          if (failed > 0) return { status: "degraded", detail: `${failed} invoice or credit note hand-off(s) to accounting need attention`, data: { failed, stale } };
          if (stale > 0) return { status: "degraded", detail: `${stale} hand-off(s) to accounting have waited over a day`, data: { failed, stale } };
          return { status: "ok", detail: "nothing waiting", data: { failed, stale } };
        } finally {
          await sql.end();
        }
      }
    },
    {
      name: "security_config",
      critical: false,
      async run() {
        // Codes only: the health endpoint's detail view is not a place for configuration values.
        const findings = checkSecurityConfig(process.env);
        const errors = findings.filter((finding) => finding.severity === "error");
        if (errors.length) return { status: "degraded", detail: `${errors.length} security configuration error(s): ${errors.map((finding) => finding.code).join(", ")}` };
        if (findings.length) return { status: "ok", detail: `${findings.length} advisory warning(s): ${findings.map((finding) => finding.code).join(", ")}` };
        return { status: "ok", detail: "no findings" };
      }
    }
  ];
}

export function readSystemHealth() {
  return runHealthChecks(buildHealthChecks());
}
