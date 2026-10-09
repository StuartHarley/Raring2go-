import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, newNonce } from "./csp";

const directive = (policy: string, name: string) => policy.split("; ").find((entry) => entry.startsWith(`${name} `)) ?? "";

describe("content security policy", () => {
  it("allows scripts only with this request's nonce, never inline or eval in production", () => {
    const policy = buildContentSecurityPolicy("abc123", { development: false });
    const script = directive(policy, "script-src");
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("blocks plugins, base-tag injection and framing by other sites, and keeps connections same-origin", () => {
    const policy = buildContentSecurityPolicy("n", { development: false });
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'self'");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
    expect(directive(policy, "default-src")).toBe("default-src 'self'");
  });

  it("only relaxes for development tooling", () => {
    const policy = buildContentSecurityPolicy("n", { development: true });
    expect(directive(policy, "script-src")).toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("makes an unpredictable nonce per request", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
  });
});
