import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * SignWell e-signature client (https://developers.signwell.com). Nothing here reads configuration or the database:
 * the caller supplies the API key and a `fetch`, so it is testable with a fake. Used behind the platform's
 * provider-neutral e-signature port and webhook translator (docs/ESIGN_PROVIDER_CONTRACT.md, docs/SIGNWELL.md).
 */
const API = "https://www.signwell.com/api/v1";

export class SignWellError extends Error {
  constructor(message: string, readonly transient: boolean, readonly status?: number) {
    super(message);
    this.name = "SignWellError";
  }
}

export type SignWellRecipient = { id: string; name: string; email: string };

export type SignWellDocument = {
  id: string;
  status: string;
  name?: string;
  metadata: Record<string, string>;
  recipients: Array<{ id: string; email: string; name: string; status: string | null; signingUrl: string | null }>;
};

type Json = Record<string, unknown>;

async function call(input: { apiKey: string; method: "GET" | "POST" | "DELETE"; path: string; body?: Json; fetch?: typeof fetch; okStatuses?: number[] }): Promise<{ status: number; body: Json }> {
  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(`${API}${input.path}`, {
      method: input.method,
      headers: { "x-api-key": input.apiKey, accept: "application/json", ...(input.body ? { "content-type": "application/json" } : {}) },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    throw new SignWellError(`Could not reach SignWell: ${error instanceof Error ? error.message : "network error"}`, true);
  }
  const body = (await response.json().catch(() => ({}))) as Json;
  if (response.status === 429 || response.status >= 500) throw new SignWellError(`SignWell answered ${response.status}.`, true, response.status);
  const ok = input.okStatuses ?? [200, 201];
  if (!ok.includes(response.status)) {
    const detail = typeof body.error === "string" ? body.error : body.errors ? JSON.stringify(body.errors).slice(0, 200) : `status ${response.status}`;
    throw new SignWellError(`SignWell refused the request: ${String(detail).slice(0, 200)}`, false, response.status);
  }
  return { status: response.status, body };
}

const toDocument = (body: Json): SignWellDocument => {
  const recipients = Array.isArray(body.recipients) ? (body.recipients as Array<Record<string, unknown>>) : [];
  return {
    id: String(body.id ?? ""),
    status: String(body.status ?? ""),
    name: typeof body.name === "string" ? body.name : undefined,
    metadata: (body.metadata && typeof body.metadata === "object" ? body.metadata : {}) as Record<string, string>,
    recipients: recipients.map((recipient) => ({ id: String(recipient.id ?? ""), email: String(recipient.email ?? ""), name: String(recipient.name ?? ""), status: typeof recipient.status === "string" ? recipient.status : null, signingUrl: typeof recipient.signing_url === "string" ? recipient.signing_url : null }))
  };
};

/**
 * Sends the agreement for signing. Recipients sign in order on a signature page SignWell adds to the end of the
 * document, so no field placement is needed. `testMode` documents are watermarked and not legally binding.
 */
export async function createSignWellDocument(input: {
  apiKey: string;
  testMode: boolean;
  name: string;
  subject: string;
  message: string;
  pdf: { name: string; base64: string };
  recipients: SignWellRecipient[];
  metadata: Record<string, string>;
  expiresInDays: number;
  /** Where the signer is sent after signing or declining. */
  redirectUrl?: string;
  declineRedirectUrl?: string;
  fetch?: typeof fetch;
}): Promise<SignWellDocument> {
  if (input.recipients.length === 0) throw new SignWellError("A document needs at least one signer.", false);
  const { body } = await call({
    apiKey: input.apiKey,
    method: "POST",
    path: "/documents",
    fetch: input.fetch,
    okStatuses: [200, 201],
    body: {
      test_mode: input.testMode,
      name: input.name,
      subject: input.subject,
      message: input.message,
      files: [{ name: input.pdf.name, file_base64: input.pdf.base64 }],
      recipients: input.recipients.map((recipient) => ({ id: recipient.id, name: recipient.name, email: recipient.email })),
      with_signature_page: true,
      apply_signing_order: true,
      allow_decline: true,
      allow_reassign: false,
      reminders: true,
      expires_in: input.expiresInDays,
      draft: false,
      metadata: input.metadata,
      ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {}),
      ...(input.declineRedirectUrl ? { decline_redirect_url: input.declineRedirectUrl } : {})
    }
  });
  const document = toDocument(body);
  if (!document.id) throw new SignWellError("SignWell did not return a document.", false);
  return document;
}

export async function getSignWellDocument(input: { apiKey: string; documentId: string; fetch?: typeof fetch }): Promise<SignWellDocument> {
  const { body } = await call({ apiKey: input.apiKey, method: "GET", path: `/documents/${encodeURIComponent(input.documentId)}`, fetch: input.fetch });
  return toDocument(body);
}

export async function remindSignWellDocument(input: { apiKey: string; documentId: string; fetch?: typeof fetch }) {
  await call({ apiKey: input.apiKey, method: "POST", path: `/documents/${encodeURIComponent(input.documentId)}/remind`, body: {}, fetch: input.fetch, okStatuses: [200, 201] });
}

/** Deleting also cancels signing in progress. A document that is already gone counts as cancelled. */
export async function cancelSignWellDocument(input: { apiKey: string; documentId: string; fetch?: typeof fetch }) {
  try {
    await call({ apiKey: input.apiKey, method: "DELETE", path: `/documents/${encodeURIComponent(input.documentId)}`, fetch: input.fetch, okStatuses: [200, 204] });
  } catch (error) {
    if (error instanceof SignWellError && error.status === 404) return;
    throw error;
  }
}

/** The address of the completed PDF, with or without SignWell's audit page (the audit page is the completion certificate). */
export async function getSignWellCompletedPdfUrl(input: { apiKey: string; documentId: string; auditPage: boolean; fetch?: typeof fetch }): Promise<string> {
  const { body } = await call({ apiKey: input.apiKey, method: "GET", path: `/documents/${encodeURIComponent(input.documentId)}/completed_pdf?url_only=true&audit_page=${input.auditPage}`, fetch: input.fetch });
  if (typeof body.file_url !== "string") throw new SignWellError("SignWell did not return the completed document.", false);
  return body.file_url;
}

/** One-off setup: register our callback address. The returned id is the secret used to verify events. */
export async function createSignWellWebhook(input: { apiKey: string; callbackUrl: string; fetch?: typeof fetch }): Promise<{ id: string }> {
  const { body } = await call({ apiKey: input.apiKey, method: "POST", path: "/hooks", body: { callback_url: input.callbackUrl }, fetch: input.fetch, okStatuses: [200, 201] });
  if (typeof body.id !== "string") throw new SignWellError("SignWell did not return a webhook id.", false);
  return { id: body.id };
}

// ---- Webhook events -------------------------------------------------------------------------

export type SignWellEventKind = "signer_completed" | "completed" | "declined" | "expired" | "cancelled" | "ignored";

export type SignWellEvent = {
  type: string;
  time: string;
  hash: string;
  kind: SignWellEventKind;
  documentId: string;
  relatedSignerEmail: string | null;
};

const KINDS: Record<string, SignWellEventKind> = {
  document_signed: "signer_completed",
  document_completed: "completed",
  document_declined: "declined",
  document_expired: "expired",
  document_canceled: "cancelled"
};

/**
 * SignWell signs `<type>@<time>` with the webhook id (hex HMAC-SHA256). That proves an event is of that type and
 * time, but it does NOT cover the document id or signer in the body, so the body must never be believed on its own:
 * the caller confirms against the SignWell API before acting (see the translator in the web app).
 */
export function verifySignWellHash(input: { type: string; time: string; hash: string; webhookIds: string[] }): boolean {
  if (!input.hash || input.webhookIds.length === 0) return false;
  const received = Buffer.from(input.hash.toLowerCase(), "utf8");
  return input.webhookIds.some((id) => {
    const expected = Buffer.from(createHmac("sha256", id).update(`${input.type}@${input.time}`).digest("hex"), "utf8");
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}

export function signSignWellEvent(webhookId: string, type: string, time: string) {
  return createHmac("sha256", webhookId).update(`${type}@${time}`).digest("hex");
}

export function parseSignWellEvent(raw: unknown): SignWellEvent {
  const payload = raw as { event?: { type?: unknown; time?: unknown; hash?: unknown; related_signer?: { email?: unknown } }; data?: { object?: { id?: unknown } } } | null;
  const event = payload?.event;
  const id = payload?.data?.object?.id;
  if (!event || typeof event.type !== "string" || (typeof event.time !== "string" && typeof event.time !== "number") || typeof event.hash !== "string") throw new SignWellError("Not a SignWell event.", false);
  if (typeof id !== "string" || !id) throw new SignWellError("The event names no document.", false);
  return {
    type: event.type,
    time: String(event.time),
    hash: event.hash,
    kind: KINDS[event.type] ?? "ignored",
    documentId: id,
    relatedSignerEmail: typeof event.related_signer?.email === "string" ? event.related_signer.email : null
  };
}
