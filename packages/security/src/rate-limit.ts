import { createHash } from "node:crypto";
import { rateLimitBuckets } from "@raring2go/db";
import type { createDb } from "@raring2go/db";
import { lt, sql } from "drizzle-orm";

type Db = ReturnType<typeof createDb>["db"];

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** When the current window ends and the count resets. */
  resetAt: Date;
  /** Seconds a rejected caller should wait: suitable for a Retry-After header. */
  retryAfterSeconds: number;
};

export type RateLimitRule = {
  /** Namespaces the counter, e.g. "sign-in:email". */
  name: string;
  limit: number;
  windowSeconds: number;
  /**
   * What to do if the counter store is unavailable. Abuse-prone and credential-adjacent
   * endpoints should fail closed; low-risk telemetry can fail open so an outage in the
   * limiter never takes the endpoint down with it.
   */
  onStoreError: "allow" | "deny";
};

/** The storage seam: an atomic "increment this window and tell me the new count". */
export type RateLimitStore = {
  increment(key: string, windowStart: Date): Promise<number>;
};

/** Identifiers are hashed before they are used as a key so the table never holds an IP or email. */
export function rateLimitKey(rule: Pick<RateLimitRule, "name">, identifier: string): string {
  return createHash("sha256").update(`${rule.name}\u0000${identifier.trim().toLowerCase()}`).digest("hex");
}

export function windowStartFor(rule: Pick<RateLimitRule, "windowSeconds">, now: Date): Date {
  const size = rule.windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / size) * size);
}

export async function checkRateLimit(store: RateLimitStore, rule: RateLimitRule, identifier: string, now: Date = new Date()): Promise<RateLimitDecision> {
  const windowStart = windowStartFor(rule, now);
  const resetAt = new Date(windowStart.getTime() + rule.windowSeconds * 1000);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));

  try {
    const count = await store.increment(rateLimitKey(rule, identifier), windowStart);
    return { allowed: count <= rule.limit, limit: rule.limit, remaining: Math.max(0, rule.limit - count), resetAt, retryAfterSeconds };
  } catch {
    const allowed = rule.onStoreError === "allow";
    return { allowed, limit: rule.limit, remaining: allowed ? rule.limit : 0, resetAt, retryAfterSeconds };
  }
}

/** Counters live in Postgres so every serverless instance shares them. One atomic upsert per check. */
export function createPostgresRateLimitStore(db: Db): RateLimitStore {
  return {
    async increment(key, windowStart) {
      const [row] = await db
        .insert(rateLimitBuckets)
        .values({ key, windowStart, count: 1 })
        .onConflictDoUpdate({ target: [rateLimitBuckets.key, rateLimitBuckets.windowStart], set: { count: sql`${rateLimitBuckets.count} + 1` } })
        .returning({ count: rateLimitBuckets.count });
      if (!row) throw new Error("Rate limit counter was not updated.");
      return row.count;
    }
  };
}

export function createMemoryRateLimitStore(): RateLimitStore & { reset(): void } {
  const counts = new Map<string, number>();
  return {
    async increment(key, windowStart) {
      const id = `${key}:${windowStart.getTime()}`;
      const next = (counts.get(id) ?? 0) + 1;
      counts.set(id, next);
      return next;
    },
    reset: () => counts.clear()
  };
}

/** Standard headers for a 429 response. */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "retry-after": String(decision.retryAfterSeconds),
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": String(Math.ceil(decision.resetAt.getTime() / 1000))
  };
}

/**
 * The caller's address as seen by the platform. On Vercel the edge sets and overwrites these
 * headers, so the first hop is the real client; elsewhere they are only as trustworthy as the
 * proxy in front. Returns "unknown" rather than throwing so a missing header still shares one
 * (strict) bucket instead of bypassing the limit.
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for") ?? headers.get("x-real-ip");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : "unknown";
}

/** Delete windows nobody can still be counted in. Called by the retention job. */
export async function pruneRateLimitBuckets(db: Db, olderThan: Date): Promise<number> {
  const rows = await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.windowStart, olderThan)).returning({ key: rateLimitBuckets.key });
  return rows.length;
}

/** Named rules, so limits are reviewed in one place instead of scattered through routes. */
export const rateLimitRules = {
  signInRequestEmail: { name: "sign-in:email", limit: 5, windowSeconds: 3600, onStoreError: "deny" },
  signInRequestIp: { name: "sign-in:ip", limit: 20, windowSeconds: 3600, onStoreError: "deny" },
  signInVerifyIp: { name: "sign-in-verify:ip", limit: 30, windowSeconds: 600, onStoreError: "deny" },
  inviteAcceptIp: { name: "invite-accept:ip", limit: 20, windowSeconds: 600, onStoreError: "deny" },
  publicAnalyticsIp: { name: "public-analytics:ip", limit: 120, windowSeconds: 60, onStoreError: "allow" },
  publicUnsubscribeIp: { name: "public-unsubscribe:ip", limit: 30, windowSeconds: 60, onStoreError: "deny" },
  fileUploadUser: { name: "file-upload:user", limit: 60, windowSeconds: 600, onStoreError: "deny" },
  franchiseDocumentUploadUser: { name: "franchise-document-upload:user", limit: 30, windowSeconds: 600, onStoreError: "deny" },
  paymentLinkUser: { name: "payment-link:user", limit: 20, windowSeconds: 600, onStoreError: "deny" },
  advertiserImportUser: { name: "advertiser-import:user", limit: 20, windowSeconds: 3600, onStoreError: "deny" },
  audienceImportUser: { name: "audience-import:user", limit: 20, windowSeconds: 3600, onStoreError: "deny" },
  franchiseImportUser: { name: "franchise-import:user", limit: 10, windowSeconds: 3600, onStoreError: "deny" },
  artworkUploadUser: { name: "artwork-upload:user", limit: 30, windowSeconds: 600, onStoreError: "deny" },
  aiAssistUser: { name: "ai-assist:territory", limit: 20, windowSeconds: 3600, onStoreError: "deny" }
} as const satisfies Record<string, RateLimitRule>;
