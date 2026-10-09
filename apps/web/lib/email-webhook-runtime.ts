import { randomUUID } from "node:crypto";
import type { EmailDeliveryEvent } from "@raring2go/email";
import {
  applyEmailDeliveryEvent,
  insertEmailDeliveryRecordRows,
  insertSuppressionRecord,
  loadDeliveryEventContext,
  updateContactEmailStatusRecord
} from "@raring2go/marketing";
import type { EmailDeliveryRecord } from "@raring2go/marketing";
import { createDb } from "@raring2go/db";
import { claimWebhookEvent } from "@raring2go/security";

type Db = ReturnType<typeof createDb>["db"];

export type DeliveryEventOutcome = { persisted: number; duplicate: number; unmatched: number };

/**
 * Apply verified provider delivery events. Each event is one transaction: the idempotency claim, the delivery
 * record and any suppression commit together. A repeat of an event (provider retry, or another serverless
 * instance receiving it) finds the claim and is skipped; a failure rolls the claim back so the retry is processed.
 * An event for a message we have no record of yet is not claimed, so it can be processed when the provider retries.
 */
export async function processDeliveryEvents(providerKey: string, events: EmailDeliveryEvent[]): Promise<DeliveryEventOutcome> {
  const outcome: DeliveryEventOutcome = { persisted: 0, duplicate: 0, unmatched: 0 };
  if (events.length === 0) return outcome;

  const { db, sql } = createDb();
  try {
    for (const event of events) {
      await db.transaction(async (tx) => {
        const scoped = tx as unknown as Db;
        const context = await loadDeliveryEventContext(scoped, providerKey, event.providerMessageId);

        if (!context) {
          outcome.unmatched += 1;
          return;
        }

        if (!(await claimWebhookEvent(scoped, { providerKey, eventId: event.eventId, eventType: event.eventType }))) {
          outcome.duplicate += 1;
          return;
        }

        // A copy: applying the event pushes any new suppression onto this list, and "new" is found by comparing with the original.
        // (Sharing the array made every suppression look old, so complaints and hard bounces were never recorded.)
        const data = { contacts: context.contacts, suppressions: [...context.suppressions], emailDeliveryRecords: [] as EmailDeliveryRecord[] };
        const delivery: EmailDeliveryRecord = {
          id: randomUUID(),
          campaignId: context.original.campaignId,
          campaignVersionId: context.original.campaignVersionId,
          recipientSnapshotId: context.original.recipientSnapshotId,
          contactId: context.original.contactId,
          emailNormalised: event.recipientEmail ?? context.original.emailNormalised,
          providerKey,
          providerMessageId: event.providerMessageId,
          status: event.eventType === "failed" || event.eventType === "bounced" ? "failed" : "delivered",
          eventType: event.eventType,
          eventAt: event.occurredAt.toISOString(),
          metadata: event.metadata ?? {}
        };

        applyEmailDeliveryEvent(data, delivery, { newId: randomUUID });
        await insertEmailDeliveryRecordRows(scoped, [delivery]);

        const newSuppression = data.suppressions.find((suppression) => !context.suppressions.includes(suppression));
        if (newSuppression) {
          await insertSuppressionRecord(scoped, newSuppression);
          await updateContactEmailStatusRecord(scoped, newSuppression.contactId, "suppressed");
        }

        outcome.persisted += 1;
      });
    }
  } finally {
    await sql.end();
  }

  return outcome;
}
