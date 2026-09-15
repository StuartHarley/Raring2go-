import { NextResponse } from "next/server";
import {
  insertSuppressionRecord,
  loadContactForUnsubscribe,
  unsubscribeContactPublicly,
  updateContactEmailStatusRecord,
  verifyUnsubscribeToken
} from "@raring2go/marketing";
import { auditActions, recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";

export async function GET(request: Request) {
  return handleUnsubscribe(request, "html");
}

export async function POST(request: Request) {
  return handleUnsubscribe(request, "json");
}

async function handleUnsubscribe(request: Request, format: "html" | "json") {
  const url = new URL(request.url);
  const contactId = url.searchParams.get("c");
  const campaignId = url.searchParams.get("m");
  const token = url.searchParams.get("t");
  const secret = process.env.AUDIENCE_UNSUBSCRIBE_SECRET;

  if (!contactId || !campaignId || !token || !secret || !verifyUnsubscribeToken(secret, contactId, campaignId, token)) {
    return respond(format, 400, "This unsubscribe link is invalid or has expired.");
  }

  const { db, sql } = createDb();

  try {
    const loaded = await loadContactForUnsubscribe(db, contactId);

    if (!loaded) {
      return respond(format, 404, "We could not find that subscriber.");
    }

    const alreadySuppressed = loaded.suppressions.some(
      (suppression) => suppression.active && suppression.reason === "recipient_unsubscribe"
    );
    const result = unsubscribeContactPublicly(
      { contacts: [loaded.contact], suppressions: loaded.suppressions },
      { contactId, campaignId }
    );

    if (!result) {
      return respond(format, 404, "We could not find that subscriber.");
    }

    if (!alreadySuppressed) {
      await insertSuppressionRecord(db, result.suppression);
      await updateContactEmailStatusRecord(db, result.contact.id, "suppressed");
      await recordAuditEvent(db, {
        action: auditActions.marketingAudienceSuppress,
        actor: { type: "system", systemId: "public_unsubscribe" },
        entity: { type: "audience_contact", id: result.contact.id },
        after: { reason: result.suppression.reason, campaignId }
      });
    }

    return respond(format, 200, "You have been unsubscribed. You will not receive further emails from this list.");
  } finally {
    await sql.end();
  }
}

function respond(format: "html" | "json", status: number, message: string) {
  if (format === "json") {
    return NextResponse.json({ message }, { status });
  }

  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribe</title></head><body style="font-family: sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem;"><p>${escapeHtml(message)}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
