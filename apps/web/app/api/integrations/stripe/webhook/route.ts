import { NextResponse } from "next/server";
import { verifyStripeSignature } from "@raring2go/integrations";
import { appLogger } from "../../../../../lib/logger";
import { PaymentWebhookAuthError, PaymentWebhookMalformedError, processStripeWebhook, stripeWebhookSecrets } from "../../../../../lib/payments-runtime";

/**
 * Stripe (Connect) events. Signature and timestamp are checked before anything is parsed or looked up.
 *  - 401: bad or stale signature.  - 400: malformed.  - 500: a passing fault, so Stripe retries.
 *  - 200: applied, already applied (idempotent), or an event we do not act on.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 256 * 1024) return NextResponse.json({ error: "Event too large." }, { status: 413 });
  const signatureHeader = request.headers.get("stripe-signature");
  // verifyWebhook: authenticity first, before the body is read as JSON.
  if (!verifyStripeSignature({ header: signatureHeader, body: rawBody, secrets: stripeWebhookSecrets() })) return NextResponse.json({ error: "Signature rejected." }, { status: 401 });

  try {
    return NextResponse.json({ result: await processStripeWebhook({ rawBody, signatureHeader }) });
  } catch (error) {
    if (error instanceof PaymentWebhookAuthError) return NextResponse.json({ error: "Signature rejected." }, { status: 401 });
    if (error instanceof PaymentWebhookMalformedError) return NextResponse.json({ error: "Malformed event." }, { status: 400 });
    appLogger.error("stripe webhook processing failed", { error });
    return NextResponse.json({ error: "The event could not be processed." }, { status: 500 });
  }
}
