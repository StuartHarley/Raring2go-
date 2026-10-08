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
