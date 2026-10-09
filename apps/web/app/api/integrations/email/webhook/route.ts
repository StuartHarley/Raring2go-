import { createEmailProviderFromEnv } from "@raring2go/email";
import type { EmailDeliveryEvent, EmailDeliveryProvider } from "@raring2go/email";
import { NextResponse } from "next/server";
import { appLogger } from "../../../../../lib/logger";
import { processDeliveryEvents } from "../../../../../lib/email-webhook-runtime";

export async function POST(request: Request) {
  const provider: EmailDeliveryProvider = createEmailProviderFromEnv();

  if (!provider.verifyWebhook) {
    return NextResponse.json({ error: "Email provider webhooks are not configured." }, { status: 400 });
  }

  let events: EmailDeliveryEvent[];
  try {
    events = await provider.verifyWebhook({
      headers: Object.fromEntries(request.headers.entries()),
      body: await request.text(),
      secret: process.env.POSTMARK_WEBHOOK_SECRET ?? process.env.EMAIL_WEBHOOK_SECRET
    });
  } catch {
    // Not authentic: nothing was processed.
    return NextResponse.json({ error: "Email webhook rejected." }, { status: 401 });
  }

  try {
    const outcome = await processDeliveryEvents(provider.providerKey, events);
    return NextResponse.json({ accepted: outcome.persisted, duplicate: outcome.duplicate, unmatched: outcome.unmatched, persisted: outcome.persisted, providerKey: provider.providerKey });
  } catch (error) {
    // A verified event we could not apply: fail so the provider retries (the claim rolled back with the work).
    appLogger.error("email webhook processing failed", { error });
    return NextResponse.json({ error: "Email webhook could not be processed." }, { status: 500 });
  }
}
