import { NextResponse } from "next/server";
import { ESignArtifactError, ESignAuthError, ESignEventError, DocumentFileError, processESignWebhook, verifyWebhookSignature } from "../../../../../lib/esign-runtime";
import { appLogger } from "../../../../../lib/logger";

/**
 * Provider-neutral e-signature callback. A provider-specific translator signs a small neutral event with our shared
 * secret (header `x-esign-signature: t=<unix>,v1=<hmac>`); see docs/ESIGN_PROVIDER_CONTRACT.md.
 *
 *  - 401: the signature or timestamp is not valid; nothing was read or fetched.
 *  - 400: the event is malformed, or names a signer we did not ask. Retrying cannot help.
 *  - 422: a permanent problem with the signed documents (untrusted host, not a PDF, checksum mismatch, failed scan).
 *  - 500: a passing fault (the document host was unreachable, the database was unavailable). The provider should retry.
 *  - 200/202: processed, already processed, or for a request we do not know (ignored on purpose, so it is not retried forever).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  // Bounded before verification: a signed event is a few hundred bytes.
  if (rawBody.length > 64 * 1024) return NextResponse.json({ error: "Event too large." }, { status: 413 });

  // Authenticity first: an unsigned or stale request is refused before it is parsed, looked up or fetched for.
  if (!verifyWebhookSignature(rawBody, request.headers.get("x-esign-signature"))) return NextResponse.json({ error: "Signature rejected." }, { status: 401 });

  try {
    const result = await processESignWebhook({ rawBody, signatureHeader: request.headers.get("x-esign-signature") });
    return NextResponse.json(result, { status: result.outcome === "ignored" ? 202 : 200 });
  } catch (error) {
    if (error instanceof ESignAuthError) return NextResponse.json({ error: "Signature rejected." }, { status: 401 });
    if (error instanceof ESignEventError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof DocumentFileError || (error instanceof ESignArtifactError && error.permanent)) {
      appLogger.warn("esign webhook refused a signed document", { reason: error.message });
      return NextResponse.json({ error: "The signed document was refused." }, { status: 422 });
    }
    appLogger.error("esign webhook processing failed", { error });
    return NextResponse.json({ error: "The event could not be processed." }, { status: 500 });
  }
}
