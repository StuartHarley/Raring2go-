import { createDb, opsAlertState } from "@raring2go/db";
import { decideHealthAlert } from "@raring2go/observability";
import type { AlertDecision, HealthReport, HealthStatus } from "@raring2go/observability";
import { defineJobHandler } from "@raring2go/workflows";
import type { JobHandler } from "@raring2go/workflows";
import { eq } from "drizzle-orm";
import { readSystemHealth } from "./health-runtime";

export const HEALTH_ALERT_KIND = "ops.health_alert";
const STATE_KEY = "health";

/** Cron ticks about every minute; checking every five is plenty for paging. */
export const healthAlertIdempotencyKey = (now: Date) => `${HEALTH_ALERT_KIND}:${Math.floor(now.getTime() / 300_000)}`;

export class AlertDeliveryError extends Error {}

/** The webhook is operator-configured, but it still must be a plain https URL with no embedded credentials. */
export function alertWebhookUrl(env: Record<string, string | undefined> = process.env): URL | null {
  const raw = env.ALERT_WEBHOOK_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AlertDeliveryError("ALERT_WEBHOOK_URL is not a valid URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new AlertDeliveryError("ALERT_WEBHOOK_URL must be a plain https URL.");
  return url;
}

/** A body that Slack, Teams and most chat webhooks accept (`text`), plus structured fields for anything else. */
export function alertBody(decision: Exclude<AlertDecision, { send: "none" }>, checkedAt: string) {
  const prefix = decision.send === "recovered" ? "RECOVERED" : decision.status === "down" ? "DOWN" : "DEGRADED";
  return { text: `[Raring2go ${prefix}] ${decision.message}`, event: decision.send, status: decision.status, checkedAt, problems: decision.problems };
}

export type HealthAlertDeps = {
  report?: () => Promise<HealthReport>;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
};

/**
 * Pages a person when health changes. State is only advanced after the webhook accepted the message, so a failed
 * delivery is retried on the next tick (and the job fails visibly in the Job Console) rather than being lost.
 * With no webhook configured it does nothing and says so: production config checks warn about that.
 */
export async function runHealthAlert(now: Date, deps: HealthAlertDeps = {}) {
  const url = alertWebhookUrl(deps.env ?? process.env);
  if (!url) return { sent: "none" as const, reason: "no_webhook_configured" };

  const report = await (deps.report ?? readSystemHealth)();
  const { db, sql } = createDb();
  try {
    const [row] = await db.select().from(opsAlertState).where(eq(opsAlertState.key, STATE_KEY));
    const decision = decideHealthAlert(row ? { lastStatus: row.lastStatus as HealthStatus, lastAlertedAt: row.lastAlertedAt } : null, report, now);
    if (decision.send === "none") return { sent: "none" as const, reason: "no_change", status: report.status };

    const response = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(alertBody(decision, report.checkedAt)),
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    }).catch((error: unknown) => {
      throw new AlertDeliveryError(`Alert delivery failed: ${error instanceof Error ? error.message : "network error"}`);
    });
    if (!response.ok) throw new AlertDeliveryError(`The alert webhook answered ${response.status}.`);

    await db
      .insert(opsAlertState)
      .values({ key: STATE_KEY, lastStatus: report.status, lastAlertedAt: now, lastChangedAt: now })
      .onConflictDoUpdate({
        target: opsAlertState.key,
        set: { lastStatus: report.status, lastAlertedAt: now, ...(row?.lastStatus !== report.status ? { lastChangedAt: now } : {}) }
      });
    return { sent: decision.send, status: report.status };
  } finally {
    await sql.end();
  }
}

export function createHealthAlertHandler(deps: HealthAlertDeps = {}): JobHandler {
  return defineJobHandler({
    kind: HEALTH_ALERT_KIND,
    maxAttempts: 3,
    handle: async ({ now }) => runHealthAlert(now(), deps)
  });
}
