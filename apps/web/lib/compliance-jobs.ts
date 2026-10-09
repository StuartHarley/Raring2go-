import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import type { RecordAuditEventInput } from "@raring2go/audit";
import { createDb, franchiseComplianceReminders } from "@raring2go/db";
import { createEmailProviderFromEnv } from "@raring2go/email";
import type { EmailDeliveryProvider } from "@raring2go/email";
import {
  dueComplianceReminders,
  ensureComplianceActions,
  insertComplianceActionRecords,
  insertComplianceReminderRecords,
  isReminderUndeliverable,
  loadFranchiseData,
  scheduleOverdueComplianceReminders
} from "@raring2go/franchise";
import { systemFranchiseIdentity } from "./franchise-system";
import { defineJobHandler } from "@raring2go/workflows";
import type { JobHandler } from "@raring2go/workflows";
import { and, eq } from "drizzle-orm";

export const COMPLIANCE_DAILY_KIND = "franchise.compliance_daily";
export const complianceDailyIdempotencyKey = (now: Date) => `${COMPLIANCE_DAILY_KIND}:${now.toISOString().slice(0, 10)}`;

// A dedicated system identity: it never acts as a person, and holds the franchise capabilities only in memory for the run.
const system = systemFranchiseIdentity("compliance-scheduler", COMPLIANCE_DAILY_KIND);
const systemContext = system.context;
const systemPermissions = system.permissions;

type Db = ReturnType<typeof createDb>["db"];

const systemAudit = system.audit;

function reminderEmail(input: { title: string; reminderType: string; dueDate?: string | null; territoryName?: string; recipientName?: string | null; appUrl: string }) {
  const overdue = input.reminderType === "overdue";
  const subject = overdue ? `Overdue: ${input.title}` : `Action needed: ${input.title}`;
  const lines = [
    `Hello${input.recipientName ? ` ${input.recipientName}` : ""},`,
    "",
    overdue
      ? `This compliance item is now overdue${input.dueDate ? ` (it was due ${input.dueDate})` : ""}: ${input.title}.`
      : `A compliance item needs your attention${input.dueDate ? ` by ${input.dueDate}` : ""}: ${input.title}.`,
    input.territoryName ? `Territory: ${input.territoryName}` : "",
    "",
    `Sign in to upload evidence or see what is needed: ${input.appUrl}/app/franchisees`,
    "",
    "Raring2go! Head Office"
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "");
  return { subject, text: lines.join("\n") };
}

/**
 * Daily compliance: create actions for requirements that are missing, expiring or expired, add a firmer reminder
 * for ones still open a week after they were due, and email every reminder that is due.
 *
 * Delivery is at least once: the email goes out first and the reminder is then marked sent with a conditional update,
 * so a crash in between can repeat a reminder but never lose one, and two runs cannot both mark it. A reminder for
 * something since resolved is cancelled, not sent; one that cannot be delivered for two weeks is cancelled and audited.
 */
export function createComplianceDailyHandler(provider: () => EmailDeliveryProvider = () => createEmailProviderFromEnv()): JobHandler {
  return defineJobHandler({
    kind: COMPLIANCE_DAILY_KIND,
    maxAttempts: 3,
    handle: async ({ now }) => {
      const at = now();
      const today = at.toISOString().slice(0, 10);
      const { db, sql } = createDb();
      try {
        const scheduled = await db.transaction(async (tx) => {
          const data = await loadFranchiseData(tx);
          const audit = systemAudit(tx);
          let actions = 0;
          let reminders = 0;
          for (const franchise of data.franchises.filter((candidate) => candidate.status === "active" && !candidate.deletedAt)) {
            const result = await ensureComplianceActions(systemContext, systemPermissions, audit, data, franchise.id);
            await insertComplianceActionRecords(tx, result.actions);
            await insertComplianceReminderRecords(tx, result.reminders);
            actions += result.actions.length;
            reminders += result.reminders.length;
          }
          const overdue = scheduleOverdueComplianceReminders(data, today, randomUUID);
          await insertComplianceReminderRecords(tx, overdue);
          return { actions, reminders: reminders + overdue.length, overdue: overdue.length };
        });

        const delivered = await deliverDueReminders(db, provider(), today);
        return { ...scheduled, ...delivered };
      } finally {
        await sql.end();
      }
    }
  });
}

async function deliverDueReminders(db: Db, provider: EmailDeliveryProvider, today: string) {
  const data = await loadFranchiseData(db);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const summary = { sent: 0, cancelled: 0, failed: 0, undeliverable: 0 };

  const settle = async (reminderId: string, status: "sent" | "cancelled", action: string, payload: Record<string, unknown>, territoryId?: string | null) => {
    // Conditional: only a reminder still "scheduled" can be settled, so two overlapping runs cannot both do it.
    const updated = await db
      .update(franchiseComplianceReminders)
      .set({ status, sentAt: status === "sent" ? new Date(`${today}T00:00:00Z`) : null })
      .where(and(eq(franchiseComplianceReminders.id, reminderId), eq(franchiseComplianceReminders.status, "scheduled")))
      .returning({ id: franchiseComplianceReminders.id });
    if (updated.length === 0) return false;
    await systemAudit(db).record({
      action: action as RecordAuditEventInput["action"],
      actor: { type: "automation", automationId: COMPLIANCE_DAILY_KIND },
      entity: { type: "franchise_compliance_reminder", id: reminderId },
      scope: { territoryId: territoryId ?? undefined },
      after: payload
    });
    return true;
  };

  for (const due of dueComplianceReminders(data, today)) {
    const territoryId = due.franchise.primaryTerritoryId;

    if (due.skip === "action_resolved") {
      if (await settle(due.reminder.id, "cancelled", "franchise.compliance.reminder.cancel", { reason: "action_resolved" }, territoryId)) summary.cancelled += 1;
      continue;
    }

    if (!due.recipient) {
      if (isReminderUndeliverable(due.reminder, today) && (await settle(due.reminder.id, "cancelled", "franchise.compliance.reminder.cancel", { reason: "no_recipient" }, territoryId))) summary.undeliverable += 1;
      continue;
    }

    const territory = data.territories.find((candidate) => candidate.id === territoryId);
    const content = reminderEmail({ title: due.action.title, reminderType: due.reminder.reminderType, dueDate: due.action.dueDate, territoryName: territory?.name, recipientName: due.recipient.name, appUrl });
    let ok = false;
    try {
      const result = await provider.send({
        idempotencyKey: `compliance-reminder:${due.reminder.id}`,
        purpose: "transactional",
        to: [{ email: due.recipient.email, name: due.recipient.name ?? undefined }],
        from: { email: process.env.EMAIL_FROM ?? "no-reply@raring2go.local", name: "Raring2go" },
        subject: content.subject,
        text: content.text,
        metadata: { purpose: "compliance_reminder", reminderId: due.reminder.id }
      });
      ok = result.status !== "failed" && result.accepted.length > 0;
    } catch {
      ok = false;
    }

    if (ok) {
      if (await settle(due.reminder.id, "sent", "franchise.compliance.reminder.send", { reminderType: due.reminder.reminderType, to: due.recipient.email }, territoryId)) summary.sent += 1;
    } else if (isReminderUndeliverable(due.reminder, today)) {
      if (await settle(due.reminder.id, "cancelled", "franchise.compliance.reminder.cancel", { reason: "undeliverable" }, territoryId)) summary.undeliverable += 1;
    } else {
      summary.failed += 1;
    }
  }
  return summary;
}
