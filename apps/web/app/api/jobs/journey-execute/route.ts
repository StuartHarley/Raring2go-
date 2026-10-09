import { isAuthorizedCronRequest } from "@raring2go/security";
import { NextResponse } from "next/server";
import { createDb } from "@raring2go/db";
import { processNextJourneyExecution } from "../../../../lib/journey-worker";

/**
 * Manual or external-cron trigger for one journey step. The durable job runtime (`marketing.run_journeys`) now
 * does this work on every worker tick; this endpoint stays for operators and runs the same code.
 */
export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db, sql } = createDb();
  try {
    return NextResponse.json(await processNextJourneyExecution(db));
  } finally {
    await sql.end();
  }
}
