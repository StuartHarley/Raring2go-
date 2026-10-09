import type { HealthReport, HealthStatus } from "./health";

export type AlertState = {
  /** The status we last told people about. */
  lastStatus: HealthStatus;
  lastAlertedAt: Date | null;
};

export type AlertDecision =
  | { send: "none" }
  | { send: "alert" | "reminder" | "recovered"; status: HealthStatus; message: string; problems: Array<{ name: string; status: HealthStatus; detail: string }> };

export const DEFAULT_REMINDER_MS = 6 * 3_600_000;

/**
 * When to tell a person. Pure, so the policy is testable: alert when the system gets worse or first becomes
 * unhealthy, say so once when it recovers, and remind (not spam) while it stays unhealthy. An unchanged or
 * improving-but-still-unhealthy state is silent until the reminder interval passes.
 */
export function decideHealthAlert(
  previous: AlertState | null,
  report: HealthReport,
  now: Date,
  options: { reminderMs?: number } = {}
): AlertDecision {
  const reminderMs = options.reminderMs ?? DEFAULT_REMINDER_MS;
  const rank: Record<HealthStatus, number> = { ok: 0, degraded: 1, down: 2 };
  const before = previous?.lastStatus ?? "ok";
  const problems = report.checks.filter((check) => check.status !== "ok").map((check) => ({ name: check.name, status: check.status, detail: check.detail }));

  if (report.status === "ok") {
    return before === "ok" ? { send: "none" } : { send: "recovered", status: "ok", message: "Raring2go is healthy again.", problems: [] };
  }

  const summary = `Raring2go is ${report.status}: ${problems.map((problem) => `${problem.name} (${problem.status})`).join(", ")}.`;
  if (rank[report.status] > rank[before]) return { send: "alert", status: report.status, message: summary, problems };

  const quietFor = previous?.lastAlertedAt ? now.getTime() - previous.lastAlertedAt.getTime() : Infinity;
  if (quietFor >= reminderMs) return { send: "reminder", status: report.status, message: `Still unhealthy. ${summary}`, problems };
  return { send: "none" };
}
