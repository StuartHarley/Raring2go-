import { createDb } from "@raring2go/db";
import { checkRateLimit, clientIpFrom, createPostgresRateLimitStore, rateLimitHeaders } from "@raring2go/security";
import type { RateLimitDecision, RateLimitRule } from "@raring2go/security";
import { NextResponse } from "next/server";

export type RateLimitCheck = { rule: RateLimitRule; identifier: string };

/**
 * Run each check against the shared Postgres counters and return the first refusal, or
 * undefined when every limit has room. All checks are counted even after one refuses, so a
 * caller cannot keep probing one dimension for free while another is exhausted.
 */
export async function firstRateLimitRefusal(checks: RateLimitCheck[], now: Date = new Date()): Promise<RateLimitDecision | undefined> {
  const { db, sql } = createDb();
  try {
    const store = createPostgresRateLimitStore(db);
    const decisions = await Promise.all(checks.map((check) => checkRateLimit(store, check.rule, check.identifier, now)));
    return decisions.find((decision) => !decision.allowed);
  } finally {
    await sql.end();
  }
}

export const clientIp = (headers: { get(name: string): string | null }) => clientIpFrom(headers);

export function tooManyRequestsResponse(decision: RateLimitDecision) {
  return NextResponse.json({ error: "Too many requests. Please wait and try again." }, { status: 429, headers: { ...rateLimitHeaders(decision), "cache-control": "no-store" } });
}
