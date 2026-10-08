import { isAuthorizedCronRequest } from "@raring2go/security";
import { NextResponse } from "next/server";
import { readSystemHealth } from "../../../lib/health-runtime";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness for uptime monitors. The public response is only the overall
 * status; per-check detail (queue depth, error text) needs the cron bearer secret.
 */
export async function GET(request: Request) {
  const report = await readSystemHealth();
  const detailed = isAuthorizedCronRequest(request.headers);
  const status = report.status === "down" ? 503 : 200;

  return NextResponse.json(detailed ? report : { status: report.status, checkedAt: report.checkedAt }, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
