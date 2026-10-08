import { createDb } from "@raring2go/db";
import { evaluateQueueHealth, runHealthChecks } from "@raring2go/observability";
import type { HealthCheck } from "@raring2go/observability";
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
    }
  ];
}

export function readSystemHealth() {
  return runHealthChecks(buildHealthChecks());
}
