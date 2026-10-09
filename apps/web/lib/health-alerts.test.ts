import { createDb, opsAlertState } from "@raring2go/db";
import type { HealthReport } from "@raring2go/observability";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AlertDeliveryError, alertBody, alertWebhookUrl, runHealthAlert } from "./health-alerts";

describe("alert webhook configuration", () => {
  it("is optional, but when set must be a plain https URL", () => {
    expect(alertWebhookUrl({})).toBeNull();
    expect(alertWebhookUrl({ ALERT_WEBHOOK_URL: "https://hooks.example.test/abc" })?.hostname).toBe("hooks.example.test");
    for (const bad of ["http://hooks.example.test/abc", "https://user:pw@hooks.example.test/abc", "not a url", "ftp://x.test/y"]) {
      expect(() => alertWebhookUrl({ ALERT_WEBHOOK_URL: bad }), bad).toThrow(AlertDeliveryError);
    }
  });

  it("builds a chat-friendly body that names the problems and carries no secrets", () => {
    const body = alertBody({ send: "alert", status: "down", message: "Raring2go is down: database (down).", problems: [{ name: "database", status: "down", detail: "unreachable" }] }, "2026-10-09T12:00:00Z");
    expect(body.text).toBe("[Raring2go DOWN] Raring2go is down: database (down).");
    expect(body).toMatchObject({ event: "alert", status: "down", problems: [{ name: "database" }] });
  });
});

/** Real database: alerts go out on change, are not repeated, and are retried when delivery fails. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("health alerting job (postgres)", () => {
  const { db, sql } = createDb();
  const env = { ALERT_WEBHOOK_URL: "https://hooks.example.test/alerts" };
  const report = (status: HealthReport["status"]): HealthReport => ({
    status,
    checkedAt: new Date().toISOString(),
    checks: [{ name: "job_queue", status, detail: status === "ok" ? "nothing overdue" : "3 jobs are overdue", durationMs: 1 }]
  });
  const posted: Array<Record<string, unknown>> = [];
  const accepting = (async (_url: unknown, init?: RequestInit) => { posted.push(JSON.parse(String(init?.body))); return new Response("ok", { status: 200 }); }) as unknown as typeof fetch;
  const rejecting = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  const run = (status: HealthReport["status"], fetchImpl: typeof fetch, at = new Date()) => runHealthAlert(at, { report: async () => report(status), fetch: fetchImpl, env });
  const state = async () => (await db.select().from(opsAlertState).where(eq(opsAlertState.key, "health")))[0];

  beforeAll(async () => { await db.delete(opsAlertState).where(eq(opsAlertState.key, "health")); });
  afterAll(async () => { await db.delete(opsAlertState).where(eq(opsAlertState.key, "health")); await sql.end(); });

  it("does nothing without a webhook", async () => {
    await expect(runHealthAlert(new Date(), { report: async () => report("down"), env: {} })).resolves.toMatchObject({ sent: "none", reason: "no_webhook_configured" });
  });

  it("stays quiet while healthy, alerts once when degraded, and does not repeat itself", async () => {
    await expect(run("ok", accepting)).resolves.toMatchObject({ sent: "none" });
    expect(posted).toHaveLength(0);

    await expect(run("degraded", accepting)).resolves.toMatchObject({ sent: "alert", status: "degraded" });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ event: "alert", status: "degraded" });
    expect(await state()).toMatchObject({ lastStatus: "degraded" });

    await expect(run("degraded", accepting)).resolves.toMatchObject({ sent: "none" });
    expect(posted).toHaveLength(1);
  });

  it("reminds after the interval, escalates when worse, and says once when recovered", async () => {
    await expect(run("degraded", accepting, new Date(Date.now() + 7 * 3_600_000))).resolves.toMatchObject({ sent: "reminder" });
    await expect(run("down", accepting)).resolves.toMatchObject({ sent: "alert", status: "down" });
    await expect(run("ok", accepting)).resolves.toMatchObject({ sent: "recovered" });
    await expect(run("ok", accepting)).resolves.toMatchObject({ sent: "none" });
    expect(posted.map((entry) => entry.event)).toEqual(["alert", "reminder", "alert", "recovered"]);
  });

  it("keeps the alert pending when delivery fails, so the next tick sends it", async () => {
    const before = posted.length;
    await expect(run("down", rejecting)).rejects.toThrow(/answered 500/);
    expect(await state()).toMatchObject({ lastStatus: "ok" });
    await expect(run("down", accepting)).resolves.toMatchObject({ sent: "alert" });
    expect(posted.length).toBe(before + 1);
  });
});
