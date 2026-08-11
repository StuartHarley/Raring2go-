import {
  createEmailDeliveryEventDedupe,
  createEmailProviderFromEnv,
  type EmailDeliveryProvider
} from "@raring2go/email";
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

    return NextResponse.json({
      accepted: accepted.length,
      duplicate: events.length - accepted.length,
      providerKey: provider.providerKey
    });
  } catch {
    return NextResponse.json({ error: "Email webhook rejected." }, { status: 401 });
  }
}
