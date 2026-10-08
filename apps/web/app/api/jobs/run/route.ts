import { NextResponse } from "next/server";
import { correlationHeader, correlationIdFrom } from "@raring2go/observability";
import { runJobWorkerTick } from "../../../../lib/jobs-runtime";

export const maxDuration = 60;

export async function GET(request: Request) {
  return tick(request);
}

export async function POST(request: Request) {
  return tick(request);
}

async function tick(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const correlationId = correlationIdFrom(request.headers);
  const summary = await runJobWorkerTick({ correlationId });
  return NextResponse.json(summary, { headers: { [correlationHeader]: correlationId } });
}

function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return process.env.APP_ENV !== "production";
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}
