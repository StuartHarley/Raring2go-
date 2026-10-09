import { describe, expect, it } from "vitest";
import { decideHealthAlert } from "./alerts";
import type { HealthReport } from "./health";

const at = new Date("2026-10-09T12:00:00Z");
const report = (status: HealthReport["status"], checks: Array<[string, HealthReport["status"]]> = []): HealthReport => ({
  status,
  checkedAt: at.toISOString(),
  checks: checks.map(([name, checkStatus]) => ({ name, status: checkStatus, detail: `${name} is ${checkStatus}`, durationMs: 1 }))
});
const state = (lastStatus: HealthReport["status"], hoursAgo: number) => ({ lastStatus, lastAlertedAt: new Date(at.getTime() - hoursAgo * 3_600_000) });

describe("health alert decisions", () => {
  it("stays quiet while everything is healthy, including on the very first run", () => {
    expect(decideHealthAlert(null, report("ok"), at)).toEqual({ send: "none" });
    expect(decideHealthAlert(state("ok", 1), report("ok"), at)).toEqual({ send: "none" });
  });

  it("alerts when the system first becomes unhealthy, naming what is wrong", () => {
    const decision = decideHealthAlert(null, report("degraded", [["database", "ok"], ["job_queue", "degraded"]]), at);
    expect(decision).toMatchObject({ send: "alert", status: "degraded", problems: [{ name: "job_queue", status: "degraded" }] });
    expect((decision as { message: string }).message).toContain("job_queue (degraded)");
  });

  it("alerts again when it gets worse, but not when it improves or stays the same", () => {
    expect(decideHealthAlert(state("degraded", 1), report("down", [["database", "down"]]), at).send).toBe("alert");
    expect(decideHealthAlert(state("down", 1), report("degraded", [["job_queue", "degraded"]]), at).send).toBe("none");
    expect(decideHealthAlert(state("degraded", 1), report("degraded", [["job_queue", "degraded"]]), at).send).toBe("none");
  });

  it("reminds once the reminder interval has passed, not before", () => {
    const unhealthy = report("degraded", [["job_queue", "degraded"]]);
    expect(decideHealthAlert(state("degraded", 5.9), unhealthy, at).send).toBe("none");
    expect(decideHealthAlert(state("degraded", 6), unhealthy, at).send).toBe("reminder");
    expect(decideHealthAlert(state("degraded", 1), unhealthy, at, { reminderMs: 30 * 60_000 }).send).toBe("reminder");
  });

  it("says once that it has recovered", () => {
    expect(decideHealthAlert(state("down", 2), report("ok"), at)).toMatchObject({ send: "recovered", status: "ok" });
    expect(decideHealthAlert(state("ok", 2), report("ok"), at).send).toBe("none");
  });
});
