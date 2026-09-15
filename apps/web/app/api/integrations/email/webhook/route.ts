import { randomUUID } from "node:crypto";
import {
  createEmailDeliveryEventDedupe,
  createEmailProviderFromEnv,
  type EmailDeliveryEvent,
  type EmailDeliveryProvider
} from "@raring2go/email";
import {
  applyEmailDeliveryEvent,
  insertEmailDeliveryRecordRows,
  insertSuppressionRecord,
  loadDeliveryEventContext,
  updateContactEmailStatusRecord
} from "@raring2go/marketing";
import type { EmailDeliveryRecord } from "@raring2go/marketing";
import { createDb } from "@raring2go/db";
import { NextResponse } from "next/server";

const dedupe = createEmailDeliveryEventDedupe();

export async function POST(request: Request) {
  const provider: EmailDeliveryProvider = createEmailProviderFromEnv();

  if (!provider.verifyWebhook) {
    return NextResponse.json({ error: "Email provider webhooks are not configured." }, { status: 400 });
  }

  try {
    const body = await request.text();
    const events = await provider.verifyWebhook({
      headers: Object.fromEntries(request.headers.entries()),
      body,
      secret: process.env.POSTMARK_WEBHOOK_SECRET ?? process.env.EMAIL_WEBHOOK_SECRET
    });
    const accepted = events.filter((event) => dedupe.accept(event));
    const persisted = await persistEvents(provider.providerKey, accepted);

    return NextResponse.json({
      accepted: accepted.length,
      duplicate: events.length - accepted.length,
      persisted,
      providerKey: provider.providerKey
    });
  } catch {
    return NextResponse.json({ error: "Email webhook rejected." }, { status: 401 });
  }
}

async function persistEvents(providerKey: string, events: EmailDeliveryEvent[]) {
  if (events.length === 0) {
    return 0;
  }

  const { db, sql } = createDb();
  let persisted = 0;

  try {
    for (const event of events) {
      const context = await loadDeliveryEventContext(db, providerKey, event.providerMessageId);

      if (!context) {
        continue;
      }

      const data = { contacts: context.contacts, suppressions: context.suppressions, emailDeliveryRecords: [] as EmailDeliveryRecord[] };
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

      applyEmailDeliveryEvent(data, delivery);
      await insertEmailDeliveryRecordRows(db, [delivery]);

      const newSuppression = data.suppressions.find((suppression) => !context.suppressions.includes(suppression));

      if (newSuppression) {
        await insertSuppressionRecord(db, newSuppression);
        await updateContactEmailStatusRecord(db, newSuppression.contactId, "suppressed");
      }

      persisted += 1;
    }
  } finally {
    await sql.end();
  }

  return persisted;
}
