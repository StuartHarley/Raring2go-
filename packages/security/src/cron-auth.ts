import { timingSafeEqual } from "node:crypto";

/**
 * Is this request allowed to trigger scheduled work (job worker, health detail)?
 *
 * With CRON_SECRET set, the bearer token must match it, compared in constant time. Without a
 * secret the request is allowed ONLY in local development or tests. Anything else, including a
 * production deploy where the variable was forgotten, fails closed: an unset secret must never
 * mean "open to the internet". (The previous check keyed off APP_ENV, which defaults to
 * "development" when unset, so a misconfigured production deploy was open.)
 */
export function isAuthorizedCronRequest(headers: { get(name: string): string | null }, env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.CRON_SECRET;

  if (!secret) {
    return env.NODE_ENV === "development" || env.NODE_ENV === "test";
  }

  const supplied = headers.get("authorization");
  if (!supplied) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
