import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Online payment providers behind one neutral shape. A provider turns an invoice balance into a hosted page the
 * advertiser pays on (card and bank details never touch this system), and later tells us the outcome by signed
 * webhook, which `PaymentOutcome` describes without any provider vocabulary.
 */
export type PaymentLinkInput = {
  requestId: string;
  invoiceNumber: string;
  amountMinor: number;
  currency: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Stable per attempt, so a retried call cannot create a second live link. */
  idempotencyKey: string;
};

export type PaymentLink = { providerRequestId: string; url: string; expiresAt: Date | null };

/** What a webhook tells us, translated. `ref` finds our request: by the id we were given, or by the provider's payment id. */
export type PaymentOutcome = {
  providerEventId: string;
  kind: "succeeded" | "failed" | "expired" | "refunded" | "disputed" | "ignored";
  ref: { providerRequestId?: string; providerPaymentId?: string };
  /** The connected provider account the event came from; it must match the one the request was made on. */
  accountId?: string | null;
  amountMinor?: number;
  currency?: string;
  providerPaymentId?: string;
  reason?: string;
};

export class PaymentProviderError extends Error {
  constructor(message: string, readonly transient: boolean) {
    super(message);
    this.name = "PaymentProviderError";
  }
}


export const SIGNATURE_TOLERANCE_SECONDS = 300;

function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

async function send(fetcher: typeof fetch, url: string, init: RequestInit): Promise<{ status: number; body: Record<string, any> }> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new PaymentProviderError(`Could not reach the payment provider: ${error instanceof Error ? error.message : "network error"}`, true);
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (response.status === 429 || response.status >= 500) throw new PaymentProviderError(`The payment provider answered ${response.status}.`, true);
  return { status: response.status, body };
}

// ---- Stripe (default) ------------------------------------------------------------------------

export type StripeConfig = { secretKey: string; connectClientId?: string; webhookSecret?: string };

export function createStripeConnectUrl(input: { clientId: string; state: string; redirectUri?: string }) {
  const url = new URL("https://connect.stripe.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("state", input.state);
  if (input.redirectUri) url.searchParams.set("redirect_uri", input.redirectUri);
  return url;
}

/** Exchanges the Connect authorisation code for the franchise's Stripe account id. No token is stored: calls use our key and `Stripe-Account`. */
export async function exchangeStripeConnectCode(input: { secretKey: string; code: string; fetch?: typeof fetch }): Promise<{ accountId: string }> {
  const { status, body } = await send(input.fetch ?? fetch, "https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: { authorization: `Bearer ${input.secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: input.code }).toString()
  });
  if (status !== 200 || typeof body.stripe_user_id !== "string") throw new PaymentProviderError("Stripe refused the connection.", false);
  return { accountId: body.stripe_user_id };
}

export async function createStripePaymentLink(input: { config: StripeConfig; accountId: string; link: PaymentLinkInput; fetch?: typeof fetch; now?: Date }): Promise<PaymentLink> {
  const { link } = input;
  const expiresAtSeconds = Math.floor(((input.now ?? new Date()).getTime() + 23 * 3_600_000) / 1000);
  const form = new URLSearchParams({
    mode: "payment",
    success_url: link.successUrl,
    cancel_url: link.cancelUrl,
    client_reference_id: link.requestId,
    expires_at: String(expiresAtSeconds),
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": link.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(link.amountMinor),
    "line_items[0][price_data][product_data][name]": `Invoice ${link.invoiceNumber}`,
    "payment_intent_data[description]": `Invoice ${link.invoiceNumber}`,
    "payment_intent_data[metadata][payment_request_id]": link.requestId,
    "metadata[payment_request_id]": link.requestId
  });
  if (link.customerEmail) form.set("customer_email", link.customerEmail);
  const { status, body } = await send(input.fetch ?? fetch, "https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${input.config.secretKey}`, "stripe-account": input.accountId, "idempotency-key": link.idempotencyKey.slice(0, 255), "content-type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  if (status !== 200 || typeof body.id !== "string" || typeof body.url !== "string") {
    throw new PaymentProviderError(typeof body.error?.message === "string" ? `Stripe: ${String(body.error.message).slice(0, 200)}` : "Stripe did not create the payment page.", false);
  }
  return { providerRequestId: body.id, url: body.url, expiresAt: new Date(expiresAtSeconds * 1000) };
}

/** Ends an unpaid Checkout Session so an old link stops working. A session that is already over is not an error. */
export async function expireStripePaymentLink(input: { config: StripeConfig; accountId: string; providerRequestId: string; fetch?: typeof fetch }) {
  const { status } = await send(input.fetch ?? fetch, `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(input.providerRequestId)}/expire`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.config.secretKey}`, "stripe-account": input.accountId }
  });
  return status === 200;
}

/** `Stripe-Signature: t=<unix>,v1=<hmac sha256 of "t.body">` (more than one v1 may be present during secret rotation). */
export function verifyStripeSignature(input: { header: string | null; body: string; secrets: string[]; nowSeconds?: number }): boolean {
  if (!input.header || input.secrets.length === 0) return false;
  const parts = input.header.split(",").map((part) => part.trim().split("="));
  const t = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value ?? "");
  if (!t || !/^\d+$/.test(t) || signatures.length === 0) return false;
  if (Math.abs((input.nowSeconds ?? Math.floor(Date.now() / 1000)) - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  return input.secrets.some((secret) => {
    const expected = createHmac("sha256", secret).update(`${t}.${input.body}`).digest("hex");
    return signatures.some((signature) => safeEqualHex(expected, signature));
  });
}

export function signStripeBody(secret: string, body: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  return `t=${nowSeconds},v1=${createHmac("sha256", secret).update(`${nowSeconds}.${body}`).digest("hex")}`;
}

/** Translates a Stripe event. Anything we do not act on is `ignored` (acknowledged, never an error). */
export function parseStripeEvent(raw: unknown): PaymentOutcome {
  const event = raw as { id?: string; type?: string; account?: string; data?: { object?: Record<string, any> } } | null;
  if (!event || typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) throw new PaymentProviderError("Not a Stripe event.", false);
  const object = event.data.object;
  const base = { providerEventId: event.id, accountId: event.account ?? null };
  const session = () => ({ ref: { providerRequestId: String(object.id) }, providerPaymentId: typeof object.payment_intent === "string" ? object.payment_intent : undefined, amountMinor: typeof object.amount_total === "number" ? object.amount_total : undefined, currency: typeof object.currency === "string" ? object.currency.toUpperCase() : undefined });

  switch (event.type) {
    case "checkout.session.completed":
      // Card payments are paid at once; bank and delayed methods arrive later as async_payment_succeeded.
      return object.payment_status === "paid" ? { ...base, kind: "succeeded", ...session() } : { ...base, kind: "ignored", ref: {} };
    case "checkout.session.async_payment_succeeded":
      return { ...base, kind: "succeeded", ...session() };
    case "checkout.session.async_payment_failed":
      return { ...base, kind: "failed", ...session(), reason: "The payment did not go through." };
    case "checkout.session.expired":
      return { ...base, kind: "expired", ...session() };
    case "charge.refunded":
      return { ...base, kind: "refunded", ref: { providerPaymentId: typeof object.payment_intent === "string" ? object.payment_intent : undefined }, amountMinor: typeof object.amount_refunded === "number" ? object.amount_refunded : undefined };
    case "charge.dispute.created":
      return { ...base, kind: "disputed", ref: { providerPaymentId: typeof object.payment_intent === "string" ? object.payment_intent : undefined }, amountMinor: typeof object.amount === "number" ? object.amount : undefined, reason: typeof object.reason === "string" ? object.reason : undefined };
    default:
      return { ...base, kind: "ignored", ref: {} };
  }
}

// ---- GoCardless ------------------------------------------------------------------------------

export type GoCardlessEnvironment = "sandbox" | "live";
const gcApi = (environment: GoCardlessEnvironment) => (environment === "live" ? "https://api.gocardless.com" : "https://api-sandbox.gocardless.com");
const gcConnect = (environment: GoCardlessEnvironment) => (environment === "live" ? "https://connect.gocardless.com" : "https://connect-sandbox.gocardless.com");

export function createGoCardlessConnectUrl(input: { clientId: string; redirectUri: string; state: string; environment: GoCardlessEnvironment }) {
  const url = new URL(`${gcConnect(input.environment)}/oauth/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  return url;
}

export async function exchangeGoCardlessCode(input: { clientId: string; clientSecret: string; redirectUri: string; code: string; environment: GoCardlessEnvironment; fetch?: typeof fetch }): Promise<{ accessToken: string; organisationId: string }> {
  const { status, body } = await send(input.fetch ?? fetch, `${gcConnect(input.environment)}/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: input.clientId, client_secret: input.clientSecret, grant_type: "authorization_code", redirect_uri: input.redirectUri, code: input.code }).toString()
  });
  if (status !== 200 || typeof body.access_token !== "string" || typeof body.organisation_id !== "string") throw new PaymentProviderError("GoCardless refused the connection.", false);
  return { accessToken: body.access_token, organisationId: body.organisation_id };
}

function goCardlessHeaders(accessToken: string, idempotencyKey?: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}`, "gocardless-version": "2015-07-06", "content-type": "application/json", accept: "application/json", ...(idempotencyKey ? { "idempotency-key": idempotencyKey.slice(0, 255) } : {}) };
}

/** A GoCardless billing request for one payment, plus the hosted page the payer completes it on (bank pay or Direct Debit). */
export async function createGoCardlessPaymentLink(input: { accessToken: string; environment: GoCardlessEnvironment; link: PaymentLinkInput; fetch?: typeof fetch }): Promise<PaymentLink> {
  const fetcher = input.fetch ?? fetch;
  const base = gcApi(input.environment);
  const request = await send(fetcher, `${base}/billing_requests`, {
    method: "POST",
    headers: goCardlessHeaders(input.accessToken, `${input.link.idempotencyKey}:request`),
    body: JSON.stringify({ billing_requests: { payment_request: { description: `Invoice ${input.link.invoiceNumber}`, amount: input.link.amountMinor, currency: input.link.currency }, metadata: { payment_request_id: input.link.requestId } } })
  });
  const requestId = request.body.billing_requests?.id;
  if (request.status >= 300 || typeof requestId !== "string") throw new PaymentProviderError(typeof request.body.error?.message === "string" ? `GoCardless: ${String(request.body.error.message).slice(0, 200)}` : "GoCardless did not create the payment request.", false);

  const flow = await send(fetcher, `${base}/billing_request_flows`, {
    method: "POST",
    headers: goCardlessHeaders(input.accessToken, `${input.link.idempotencyKey}:flow`),
    body: JSON.stringify({ billing_request_flows: { redirect_uri: input.link.successUrl, exit_uri: input.link.cancelUrl, links: { billing_request: requestId }, ...(input.link.customerEmail ? { prefilled_customer: { email: input.link.customerEmail } } : {}) } })
  });
  const url = flow.body.billing_request_flows?.authorisation_url;
  if (flow.status >= 300 || typeof url !== "string") throw new PaymentProviderError("GoCardless did not create the payment page.", false);
  return { providerRequestId: requestId, url, expiresAt: null };
}

/** The payment a fulfilled billing request created, so later payment events can be matched back to our request. */
export async function getGoCardlessBillingRequestPayment(input: { accessToken: string; environment: GoCardlessEnvironment; billingRequestId: string; fetch?: typeof fetch }): Promise<string | null> {
  const { status, body } = await send(input.fetch ?? fetch, `${gcApi(input.environment)}/billing_requests/${encodeURIComponent(input.billingRequestId)}`, { method: "GET", headers: goCardlessHeaders(input.accessToken) });
  if (status !== 200) throw new PaymentProviderError("GoCardless did not return the payment request.", false);
  const payment = body.billing_requests?.links?.payment_request_payment;
  return typeof payment === "string" ? payment : null;
}

export async function getGoCardlessPayment(input: { accessToken: string; environment: GoCardlessEnvironment; paymentId: string; fetch?: typeof fetch }): Promise<{ amountMinor: number; currency: string; status: string }> {
  const { status, body } = await send(input.fetch ?? fetch, `${gcApi(input.environment)}/payments/${encodeURIComponent(input.paymentId)}`, { method: "GET", headers: goCardlessHeaders(input.accessToken) });
  const payment = body.payments;
  if (status !== 200 || typeof payment?.amount !== "number") throw new PaymentProviderError("GoCardless did not return the payment.", false);
  return { amountMinor: payment.amount, currency: String(payment.currency ?? "GBP").toUpperCase(), status: String(payment.status ?? "") };
}

/** `Webhook-Signature`: hex HMAC SHA256 of the raw body with the webhook endpoint secret. */
export function verifyGoCardlessSignature(input: { header: string | null; body: string; secrets: string[] }): boolean {
  if (!input.header || input.secrets.length === 0) return false;
  return input.secrets.some((secret) => safeEqualHex(createHmac("sha256", secret).update(input.body).digest("hex"), input.header!.trim().toLowerCase()));
}

export function signGoCardlessBody(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export type GoCardlessEvent = { id: string; resourceType: string; action: string; links: Record<string, string>; details?: Record<string, any> };

export function parseGoCardlessEvents(raw: unknown): GoCardlessEvent[] {
  const events = (raw as { events?: unknown[] } | null)?.events;
  if (!Array.isArray(events)) throw new PaymentProviderError("Not a GoCardless webhook.", false);
  return events.map((entry) => {
    const event = entry as { id?: string; resource_type?: string; action?: string; links?: Record<string, string>; details?: Record<string, any> };
    if (typeof event.id !== "string" || typeof event.resource_type !== "string" || typeof event.action !== "string") throw new PaymentProviderError("Malformed GoCardless event.", false);
    return { id: event.id, resourceType: event.resource_type, action: event.action, links: event.links ?? {}, details: event.details };
  });
}

/**
 * Translates one event. Money counts as received at `payments.confirmed`; `billing_requests.fulfilled` only tells us
 * which payment belongs to our request, so the later payment events can be matched (the caller fetches it).
 */
export function outcomeFromGoCardlessEvent(event: GoCardlessEvent): PaymentOutcome {
  const base = { providerEventId: event.id, accountId: event.links.organisation ?? null };
  if (event.resourceType === "billing_requests" && event.action === "fulfilled") return { ...base, kind: "ignored", ref: { providerRequestId: event.links.billing_request } };
  if (event.resourceType === "billing_requests" && ["cancelled", "failed", "expired"].includes(event.action)) return { ...base, kind: event.action === "expired" ? "expired" : "failed", ref: { providerRequestId: event.links.billing_request }, reason: event.details?.description };
  if (event.resourceType === "payments") {
    const ref = { providerPaymentId: event.links.payment };
    if (event.action === "confirmed") return { ...base, kind: "succeeded", ref, providerPaymentId: event.links.payment };
    if (["failed", "cancelled", "customer_approval_denied"].includes(event.action)) return { ...base, kind: "failed", ref, reason: event.details?.description };
    if (event.action === "charged_back") return { ...base, kind: "disputed", ref, reason: "Charged back." };
    if (event.action === "refunded" || event.action === "refund_settled") return { ...base, kind: "refunded", ref };
  }
  return { ...base, kind: "ignored", ref: {} };
}

