import { NextResponse } from "next/server";
import { ESignArtifactError, DocumentFileError } from "../../../../../lib/esign-runtime";
import { appLogger } from "../../../../../lib/logger";
import { SignWellNotReadyError, SignWellWebhookAuthError, SignWellWebhookMalformedError, processSignWellWebhook } from "../../../../../lib/signwell-runtime";

/**
 * SignWell callbacks. The event hash (type and time, keyed by the webhook id) is verified first; nothing the body says
 * is believed until SignWell's own API confirms it (docs/SIGNWELL.md).
 *  - 401: bad hash or too old.  - 400: malformed.  - 422: the signed documents were refused (untrusted host, not a PDF, scan).
 *  - 500: a passing fault or "not completed yet", so SignWell retries.  - 200: processed, duplicate, or not for us.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 256 * 1024) return NextResponse.json({ error: "Event too large." }, { status: 413 });
  try {
    // verifyWebhook: the hash is verified inside before the body is acted on.
    const result = await processSignWellWebhook(rawBody);
    return NextResponse.json(result, { status: result.outcome === "ignored" ? 202 : 200 });
  } catch (error) {
    if (error instanceof SignWellWebhookAuthError) return NextResponse.json({ error: "Signature rejected." }, { status: 401 });
    if (error instanceof SignWellWebhookMalformedError) return NextResponse.json({ error: "Malformed event." }, { status: 400 });
    if (error instanceof DocumentFileError || (error instanceof ESignArtifactError && error.permanent)) {
      appLogger.warn("signwell webhook refused a signed document", { reason: error.message });
      return NextResponse.json({ error: "The signed document was refused." }, { status: 422 });
    }
    if (error instanceof SignWellNotReadyError) return NextResponse.json({ error: "Not ready; retry." }, { status: 500 });
    appLogger.error("signwell webhook processing failed", { error });
    return NextResponse.json({ error: "The event could not be processed." }, { status: 500 });
  }
}
