import { NextResponse } from "next/server";
import { readSystemHealth } from "../../../lib/health-runtime";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness for uptime monitors. The public response is only the overall
 * status; per-check detail (queue depth, error text) needs the cron bearer secret.
 */
export async function GET(request: Request) {
  const report = await readSystemHealth();
  const secret = process.env.CRON_SECRET;
  const detailed = secret ? request.headers.get("authorization") === `Bearer ${secret}` : process.env.APP_ENV !== "production";
  const status = report.status === "down" ? 503 : 200;

  return NextResponse.json(detailed ? report : { status: report.status, checkedAt: report.checkedAt }, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
