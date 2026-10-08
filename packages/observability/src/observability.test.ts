import { describe, expect, it, vi } from "vitest";
import { correlationHeader, correlationIdFrom, newCorrelationId } from "./correlation";
import { evaluateQueueHealth, runHealthChecks } from "./health";
import { createLogger } from "./logger";
import type { LogRecord } from "./logger";

const fixedNow = () => new Date("2026-01-01T00:00:00Z");

describe("logger", () => {
  function capture(level?: "debug" | "info" | "warn" | "error") {
    const records: LogRecord[] = [];
    const logger = createLogger({ service: "web", level, sink: (record) => records.push(record), now: fixedNow });
    return { logger, records };
  }

  it("writes structured records with time, level and service", () => {
    const { logger, records } = capture();
    logger.info("job finished", { jobId: "j1" });
    expect(records).toEqual([{ jobId: "j1", time: "2026-01-01T00:00:00.000Z", level: "info", service: "web", message: "job finished" }]);
  });

  it("filters below the configured level", () => {
    const { logger, records } = capture("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(records.map((record) => record.level)).toEqual(["warn", "error"]);
  });

  it("child loggers stamp context onto every record", () => {
    const { logger, records } = capture();
    logger.child({ correlationId: "abc12345" }).child({ jobId: "j1" }).info("claimed");
    expect(records[0]).toMatchObject({ correlationId: "abc12345", jobId: "j1" });
  });

  it("redacts secrets in fields and context", () => {
    const { logger, records } = capture();
    logger.child({ accessToken: "tok_live_1" }).info("provider call", { apiKey: "sk_live_2", nested: { password: "hunter2" }, ok: 1 });
    const serialised = JSON.stringify(records[0]);
    expect(serialised).not.toContain("tok_live_1");
    expect(serialised).not.toContain("sk_live_2");
    expect(serialised).not.toContain("hunter2");
    expect(records[0]).toMatchObject({ ok: 1 });
  });

  it("serialises Error objects and never lets callers overwrite reserved keys", () => {
    const { logger, records } = capture();
    logger.error("failed", { error: new Error("boom"), level: "debug", service: "spoofed", message: "spoofed" });
    expect(records[0]).toMatchObject({ level: "error", service: "web", message: "failed", error: { name: "Error", message: "boom" } });
  });
});

describe("correlation ids", () => {
  const headers = (value: string | null) => ({ get: (name: string) => (name === correlationHeader ? value : null) });

  it("keeps a well-formed supplied id", () => {
    expect(correlationIdFrom(headers("req-1234:abcd"))).toBe("req-1234:abcd");
  });

  it("replaces missing or malformed ids rather than logging them", () => {
    expect(correlationIdFrom(headers(null))).toMatch(/^[0-9a-f-]{36}$/);
    const bad = correlationIdFrom(headers("<script>alert(1)</script>"));
    expect(bad).toMatch(/^[0-9a-f-]{36}$/);
    expect(newCorrelationId()).not.toBe(newCorrelationId());
  });
});

describe("runHealthChecks", () => {
  const ok = { status: "ok" as const, detail: "fine" };

  it("is ok when every check is ok", async () => {
    const report = await runHealthChecks([{ name: "db", critical: true, run: async () => ok }], { now: fixedNow });
    expect(report.status).toBe("ok");
    expect(report.checkedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("a thrown critical check makes the system down; a non-critical one only degrades it", async () => {
    const boom = async () => {
      throw new Error("connection refused");
    };
    const critical = await runHealthChecks([{ name: "db", critical: true, run: boom }]);
    expect(critical.status).toBe("down");
    expect(critical.checks[0]).toMatchObject({ name: "db", status: "down", detail: "connection refused" });

    const soft = await runHealthChecks([{ name: "db", critical: true, run: async () => ok }, { name: "queue", critical: false, run: boom }]);
    expect(soft.status).toBe("degraded");
  });

  it("times out a hung check", async () => {
    vi.useFakeTimers();
    try {
      const pending = runHealthChecks([{ name: "slow", critical: true, run: () => new Promise(() => undefined) }], { timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(101);
      const report = await pending;
      expect(report.status).toBe("down");
      expect(report.checks[0]!.detail).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leak the critical flag in results", async () => {
    const report = await runHealthChecks([{ name: "db", critical: true, run: async () => ok }]);
    expect(report.checks[0]).not.toHaveProperty("critical");
  });
});

describe("evaluateQueueHealth", () => {
  const base = { queued: 3, overdueQueued: 0, expiredLeases: 0, dead: 0 };

  it("is ok for a draining queue", () => {
    expect(evaluateQueueHealth(base)).toMatchObject({ status: "ok", detail: "3 queued, nothing overdue" });
  });

  it("degrades on a few dead-lettered jobs and goes down on many", () => {
    expect(evaluateQueueHealth({ ...base, dead: 2 }).status).toBe("degraded");
    expect(evaluateQueueHealth({ ...base, dead: 25 }).status).toBe("down");
  });

  it("flags a stalled worker via overdue jobs and expired leases", () => {
    expect(evaluateQueueHealth({ ...base, overdueQueued: 4 }).status).toBe("degraded");
    expect(evaluateQueueHealth({ ...base, overdueQueued: 80 }).status).toBe("down");
    const leases = evaluateQueueHealth({ ...base, expiredLeases: 1 });
    expect(leases.status).toBe("degraded");
    expect(leases.detail).toMatch(/expired lease/);
  });

  it("reports the worst status and every problem", () => {
    const result = evaluateQueueHealth({ queued: 9, overdueQueued: 2, expiredLeases: 1, dead: 30 });
    expect(result.status).toBe("down");
    expect(result.detail.split("; ")).toHaveLength(3);
  });
});
