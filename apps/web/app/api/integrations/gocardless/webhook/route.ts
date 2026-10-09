import { NextResponse } from "next/server";
import { verifyGoCardlessSignature } from "@raring2go/integrations";
import { appLogger } from "../../../../../lib/logger";
import { PaymentWebhookAuthError, PaymentWebhookMalformedError, PaymentWebhookRetryError, goCardlessWebhookSecrets, processGoCardlessWebhook } from "../../../../../lib/payments-runtime";

/**
 * GoCardless events. The signature is checked on the exact body before anything is parsed or looked up.
 *  - 401: bad signature.  - 400: malformed.  - 500: a passing fault or "not matched yet", so GoCardless retries.
 *  - 200: processed, already processed (idempotent), or events we do not act on.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 512 * 1024) return NextResponse.json({ error: "Event too large." }, { status: 413 });
  const signatureHeader = request.headers.get("webhook-signature");
  // verifyWebhook: authenticity first, before the body is read as JSON.
  if (!verifyGoCardlessSignature({ header: signatureHeader, body: rawBody, secrets: goCardlessWebhookSecrets() })) return NextResponse.json({ error: "Signature rejected." }, { status: 401 });

  try {
    return NextResponse.json({ results: await processGoCardlessWebhook({ rawBody, signatureHeader }) });
  } catch (error) {
    if (error instanceof PaymentWebhookAuthError) return NextResponse.json({ error: "Signature rejected." }, { status: 401 });
    if (error instanceof PaymentWebhookMalformedError) return NextResponse.json({ error: "Malformed event." }, { status: 400 });
    if (error instanceof PaymentWebhookRetryError) return NextResponse.json({ error: "Not ready; retry." }, { status: 500 });
    appLogger.error("gocardless webhook processing failed", { error });
    return NextResponse.json({ error: "The event could not be processed." }, { status: 500 });
  }
}
