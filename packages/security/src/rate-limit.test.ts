import { describe, expect, it } from "vitest";
import { checkRateLimit, clientIpFrom, createMemoryRateLimitStore, rateLimitHeaders, rateLimitKey, rateLimitRules, windowStartFor } from "./rate-limit";
import type { RateLimitRule, RateLimitStore } from "./rate-limit";

const rule: RateLimitRule = { name: "test", limit: 3, windowSeconds: 60, onStoreError: "deny" };
const t0 = new Date("2026-10-08T10:00:10Z");

describe("rate limiting", () => {
  it("allows up to the limit in a window, then rejects with a retry time", async () => {
    const store = createMemoryRateLimitStore();
    const decisions = [];
    for (let i = 0; i < 5; i += 1) decisions.push(await checkRateLimit(store, rule, "1.2.3.4", t0));
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false, false]);
    expect(decisions[2]!.remaining).toBe(0);
    expect(decisions[3]!.retryAfterSeconds).toBe(50);
    expect(rateLimitHeaders(decisions[3]!)["retry-after"]).toBe("50");
  });

  it("resets in the next window and keeps identifiers and rules separate", async () => {
    const store = createMemoryRateLimitStore();
    for (let i = 0; i < 4; i += 1) await checkRateLimit(store, rule, "a", t0);
    expect((await checkRateLimit(store, rule, "a", t0)).allowed).toBe(false);
    expect((await checkRateLimit(store, rule, "b", t0)).allowed).toBe(true);
    expect((await checkRateLimit(store, { ...rule, name: "other" }, "a", t0)).allowed).toBe(true);
    expect((await checkRateLimit(store, rule, "a", new Date("2026-10-08T10:01:00Z"))).allowed).toBe(true);
  });

  it("hashes the identifier so the key holds no personal data, and normalises case", () => {
    const key = rateLimitKey(rule, "Person@Example.com");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("example");
    expect(rateLimitKey(rule, "person@example.com")).toBe(key);
    expect(rateLimitKey({ name: "other" }, "person@example.com")).not.toBe(key);
  });

  it("aligns windows to fixed boundaries", () => {
    expect(windowStartFor(rule, t0).toISOString()).toBe("2026-10-08T10:00:00.000Z");
  });

  it("follows the rule's policy when the store fails", async () => {
    const broken: RateLimitStore = { increment: async () => { throw new Error("db down"); } };
    expect((await checkRateLimit(broken, { ...rule, onStoreError: "deny" }, "x", t0)).allowed).toBe(false);
    expect((await checkRateLimit(broken, { ...rule, onStoreError: "allow" }, "x", t0)).allowed).toBe(true);
  });

  it("fails closed for credential and upload endpoints and open only for telemetry", () => {
    for (const [name, value] of Object.entries(rateLimitRules)) {
      expect(value.onStoreError, name).toBe(name === "publicAnalyticsIp" ? "allow" : "deny");
    }
  });

  it("reads the client address from platform headers and never throws", () => {
    const h = (map: Record<string, string>) => ({ get: (n: string) => map[n.toLowerCase()] ?? null });
    expect(clientIpFrom(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIpFrom(h({ "x-vercel-forwarded-for": "198.51.100.2", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.2");
    expect(clientIpFrom(h({}))).toBe("unknown");
    expect(clientIpFrom(h({ "x-forwarded-for": "x".repeat(200) }))).toBe("unknown");
  });
});
