import { randomUUID } from "node:crypto";
import { complianceRequirements, createDb, franchiseComplianceActions, franchiseComplianceReminders } from "@raring2go/db";
import type { EmailDeliveryProvider, EmailMessage } from "@raring2go/email";
import { eq, inArray, like, notInArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createComplianceDailyHandler } from "./compliance-jobs";

/** Real database: compliance actions and reminders are created, delivered once, and escalated. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("daily compliance job (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const requirementName = `Test requirement ${tag}`;
  let requirementId = "";
  let existingActions: string[] = [];
  let existingReminders: string[] = [];

  function fakeProvider(mode: "ok" | "fail" = "ok") {
    const sent: EmailMessage[] = [];
    const provider: EmailDeliveryProvider = {
      providerKey: "test",
      async send(message) {
        sent.push(message);
        return mode === "ok"
          ? { providerKey: "test", providerMessageId: `m_${message.idempotencyKey}`, accepted: message.to.map((to) => to.email), rejected: [], status: "sent" }
          : { providerKey: "test", providerMessageId: `f_${message.idempotencyKey}`, accepted: [], rejected: message.to.map((to) => to.email), status: "failed" };
      }
    };
    return { provider, sent };
  }
  const run = (provider: EmailDeliveryProvider, now = new Date()) => (createComplianceDailyHandler(() => provider) as unknown as { handle: (context: { now: () => Date }) => Promise<Record<string, number>> }).handle({ now: () => now });

  beforeAll(async () => {
    // A requirement nobody has met, so the seeded franchise has a real gap for the job to find.
    requirementId = randomUUID();
    await db.insert(complianceRequirements).values({ id: requirementId, key: `test-${tag}`, name: requirementName, expiryWarningDays: 30, active: true });
    existingActions = (await db.select({ id: franchiseComplianceActions.id }).from(franchiseComplianceActions)).map((row) => row.id);
    existingReminders = (await db.select({ id: franchiseComplianceReminders.id }).from(franchiseComplianceReminders)).map((row) => row.id);
  });

  afterAll(async () => {
    // Remove only what this suite's runs created, leaving anything that was there before.
    const reminders = existingReminders.length ? await db.select({ id: franchiseComplianceReminders.id }).from(franchiseComplianceReminders).where(notInArray(franchiseComplianceReminders.id, existingReminders)) : await db.select({ id: franchiseComplianceReminders.id }).from(franchiseComplianceReminders);
    if (reminders.length) await db.delete(franchiseComplianceReminders).where(inArray(franchiseComplianceReminders.id, reminders.map((row) => row.id)));
    const actions = existingActions.length ? await db.select({ id: franchiseComplianceActions.id }).from(franchiseComplianceActions).where(notInArray(franchiseComplianceActions.id, existingActions)) : await db.select({ id: franchiseComplianceActions.id }).from(franchiseComplianceActions);
    if (actions.length) await db.delete(franchiseComplianceActions).where(inArray(franchiseComplianceActions.id, actions.map((row) => row.id)));
    await db.delete(complianceRequirements).where(eq(complianceRequirements.id, requirementId));
    await sql.end();
  });

  const ourAction = async () => (await db.select().from(franchiseComplianceActions).where(like(franchiseComplianceActions.title, `${requirementName}%`)))[0]!;

  it("creates actions from compliance gaps, emails each due reminder to the owner once, and does nothing on a rerun", async () => {
    const first = fakeProvider();
    const summary = await run(first.provider);
    expect(summary.actions).toBeGreaterThan(0);
    expect(summary.sent).toBeGreaterThan(0);
    expect(first.sent.length).toBe(summary.sent);
    for (const message of first.sent) {
      expect(message.purpose).toBe("transactional");
      expect(message.to).toHaveLength(1);
      expect(message.subject).toMatch(/Action needed|Overdue/);
      expect(message.idempotencyKey).toMatch(/^compliance-reminder:/);
    }

    const sentRows = await db.select().from(franchiseComplianceReminders).where(eq(franchiseComplianceReminders.status, "sent"));
    expect(sentRows.length).toBeGreaterThanOrEqual(summary.sent!);

    const second = fakeProvider();
    const again = await run(second.provider);
    expect(again.actions).toBe(0);
    expect(second.sent).toHaveLength(0);
  });

  it("leaves a reminder scheduled when the email fails, and sends it on the next run", async () => {
    // Put one sent reminder back to scheduled to stand in for a delivery that did not go through.
    const reminder = (await db.select().from(franchiseComplianceReminders).where(eq(franchiseComplianceReminders.complianceActionId, (await ourAction()).id)))[0];
    expect(reminder).toBeDefined();
    await db.update(franchiseComplianceReminders).set({ status: "scheduled", sentAt: null }).where(eq(franchiseComplianceReminders.id, reminder!.id));

    const failing = fakeProvider("fail");
    const failed = await run(failing.provider);
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(franchiseComplianceReminders).where(eq(franchiseComplianceReminders.id, reminder!.id)))[0]!.status).toBe("scheduled");

    const working = fakeProvider();
    await run(working.provider);
    expect((await db.select().from(franchiseComplianceReminders).where(eq(franchiseComplianceReminders.id, reminder!.id)))[0]!.status).toBe("sent");
    expect(working.sent.some((message) => message.idempotencyKey === `compliance-reminder:${reminder!.id}`)).toBe(true);
  });

  it("cancels a reminder whose requirement was resolved instead of sending it", async () => {
    const action = await ourAction();
    const reminder = (await db.select().from(franchiseComplianceReminders).where(eq(franchiseComplianceReminders.complianceActionId, action.id)))[0];
    await db.update(franchiseComplianceActions).set({ status: "resolved", resolvedAt: new Date() }).where(eq(franchiseComplianceActions.id, action.id));
    await db.update(franchiseComplianceReminders).set({ status: "scheduled", sentAt: null }).where(eq(franchiseComplianceReminders.id, reminder!.id));

    const spy = fakeProvider();
    const summary = await run(spy.provider);
    expect(summary.cancelled).toBeGreaterThanOrEqual(1);
    expect(spy.sent.some((message) => message.idempotencyKey === `compliance-reminder:${reminder!.id}`)).toBe(false);
    expect((await db.select().from(franchiseComplianceReminders).where(eq(franchiseComplianceReminders.id, reminder!.id)))[0]!.status).toBe("cancelled");
  });

  it("escalates a requirement still open a week past due with one overdue reminder, and gives up on undeliverable ones after two weeks", async () => {
    const action = await ourAction();
    // The previous test resolved it; reopen it for this one.
    await db.update(franchiseComplianceActions).set({ status: "open", resolvedAt: null }).where(eq(franchiseComplianceActions.id, action.id));
    const longAgo = new Date(Date.now() - 20 * 86_400_000);
    await db.update(franchiseComplianceActions).set({ dueDate: longAgo }).where(eq(franchiseComplianceActions.id, action.id));
    await db.update(franchiseComplianceReminders).set({ scheduledFor: longAgo, status: "scheduled", sentAt: null }).where(eq(franchiseComplianceReminders.complianceActionId, action.id));

    // Nothing can be delivered: the original reminder is 20 days old, so it is abandoned; the overdue one is new and stays.
    const failing = fakeProvider("fail");
    const summary = await run(failing.provider);
    expect(summary.overdue).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(franchiseComplianceReminders).where(eq(franchiseComplianceReminders.complianceActionId, action.id));
    expect(rows.filter((row) => row.reminderType === "overdue")).toHaveLength(1);
    expect(rows.find((row) => row.reminderType !== "overdue")!.status).toBe("cancelled");
    expect(rows.find((row) => row.reminderType === "overdue")!.status).toBe("scheduled");

    await run(fakeProvider().provider);
    expect((await db.select().from(franchiseComplianceReminders).where(eq(franchiseComplianceReminders.complianceActionId, action.id))).filter((row) => row.reminderType === "overdue")).toHaveLength(1);
  });
});
