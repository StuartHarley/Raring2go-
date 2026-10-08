import { describe, expect, it } from "vitest";
import { PermanentJobError, RetryableJobError } from "./errors";
import { canCancel, canRetryManually, computeBackoffMs, isLeaseExpired, planFailure, retryBudget, sanitiseErrorMessage } from "./policy";

const handler = { baseBackoffMs: 1_000, maxBackoffMs: 10_000 };
const now = new Date("2026-01-01T00:00:00Z");

describe("computeBackoffMs", () => {
  it("doubles per attempt, capped at the maximum", () => {
    const max = () => 1; // top of the jitter window
    expect(computeBackoffMs(1, handler, max)).toBe(1_000);
    expect(computeBackoffMs(2, handler, max)).toBe(2_000);
    expect(computeBackoffMs(3, handler, max)).toBe(4_000);
    expect(computeBackoffMs(10, handler, max)).toBe(10_000);
  });

  it("jitters between 50% and 100% of the ceiling", () => {
    expect(computeBackoffMs(2, handler, () => 0)).toBe(1_000);
    expect(computeBackoffMs(2, handler, () => 1)).toBe(2_000);
  });
});

describe("planFailure", () => {
  it("schedules a retry while attempts remain", () => {
    const plan = planFailure({ attempts: 1, maxAttempts: 3 }, handler, new Error("boom"), now, () => 1);
    expect(plan.status).toBe("queued");
    expect(plan.runAfter.getTime()).toBe(now.getTime() + 1_000);
    expect(plan.errorCode).toBe("error");
  });

  it("dead-letters when attempts are exhausted", () => {
    const plan = planFailure({ attempts: 3, maxAttempts: 3 }, handler, new Error("boom"), now);
    expect(plan.status).toBe("dead");
    expect(plan.errorCode).toBe("attempts_exhausted");
  });

  it("dead-letters immediately on a permanent error even with budget left", () => {
    const plan = planFailure({ attempts: 1, maxAttempts: 5 }, handler, new PermanentJobError("bad input", "invalid_input"), now);
    expect(plan.status).toBe("dead");
    expect(plan.errorCode).toBe("invalid_input");
  });

  it("honours a provider retry-after but never beyond the backoff ceiling", () => {
    const short = planFailure({ attempts: 1, maxAttempts: 5 }, handler, new RetryableJobError("429", { retryAfterMs: 4_000, code: "rate_limited" }), now);
    expect(short.runAfter.getTime()).toBe(now.getTime() + 4_000);
    expect(short.errorCode).toBe("rate_limited");

    const long = planFailure({ attempts: 1, maxAttempts: 5 }, handler, new RetryableJobError("429", { retryAfterMs: 999_999 }), now);
    expect(long.runAfter.getTime()).toBe(now.getTime() + 10_000);
  });
});

describe("sanitiseErrorMessage", () => {
  it("redacts bearer tokens and key=value credentials", () => {
    const message = sanitiseErrorMessage(new Error("401 with Bearer abcdef1234567890 and api_key=sk_live_123 password: hunter2"));
    expect(message).not.toContain("abcdef1234567890");
    expect(message).not.toContain("sk_live_123");
    expect(message).not.toContain("hunter2");
    expect(message).toContain("[redacted]");
  });

  it("bounds the length", () => {
    expect(sanitiseErrorMessage(new Error("x".repeat(5_000))).length).toBeLessThanOrEqual(2_001);
  });

  it("handles non-Error throws", () => {
    expect(sanitiseErrorMessage("plain")).toBe("plain");
    expect(sanitiseErrorMessage({})).toBe("Unknown error");
  });
});

describe("state guards", () => {
  it("only dead or cancelled jobs are manually retryable", () => {
    expect(canRetryManually("dead")).toBe(true);
    expect(canRetryManually("cancelled")).toBe(true);
    expect(canRetryManually("running")).toBe(false);
    expect(canRetryManually("queued")).toBe(false);
    expect(canRetryManually("succeeded")).toBe(false);
  });

  it("only queued jobs can be cancelled", () => {
    expect(canCancel("queued")).toBe(true);
    expect(canCancel("running")).toBe(false);
  });

  it("gives a retried job a fresh attempt budget on top of attempts used", () => {
    expect(retryBudget({ attempts: 5 }, 5)).toBe(10);
    expect(retryBudget({ attempts: 2 }, 0)).toBe(3);
  });

  it("detects expired leases only for running jobs", () => {
    expect(isLeaseExpired({ status: "running", leaseExpiresAt: new Date(now.getTime() - 1) }, now)).toBe(true);
    expect(isLeaseExpired({ status: "running", leaseExpiresAt: new Date(now.getTime() + 1) }, now)).toBe(false);
    expect(isLeaseExpired({ status: "queued", leaseExpiresAt: new Date(now.getTime() - 1) }, now)).toBe(false);
  });
});
