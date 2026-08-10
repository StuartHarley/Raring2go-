import { describe, expect, it } from "vitest";
import { createDevelopmentMemoryRateLimiter } from "./rate-limit";

describe("development memory rate limiter", () => {
  it("uses a provider-neutral interface for local development and tests", async () => {
    const limiter = createDevelopmentMemoryRateLimiter({
      limit: 1,
      windowMs: 60_000
    });

    await expect(limiter.check("email:test@example.com")).resolves.toMatchObject({
      allowed: true,
      remaining: 0
    });
    await expect(limiter.check("email:test@example.com")).resolves.toMatchObject({
      allowed: false,
      remaining: 0
    });
  });
});
