import { describe, expect, it } from "vitest";
import {
  PaymentProviderError, createGoCardlessConnectUrl, createGoCardlessPaymentLink, createStripeConnectUrl, createStripePaymentLink, exchangeGoCardlessCode, exchangeStripeConnectCode, expireStripePaymentLink,
  getGoCardlessBillingRequestPayment, getGoCardlessPayment, outcomeFromGoCardlessEvent, parseGoCardlessEvents, parseStripeEvent, signGoCardlessBody, signStripeBody, verifyGoCardlessSignature, verifyStripeSignature
} from "./payments";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };
function fake(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), method: init?.method ?? "GET", headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), body: String(init?.body ?? "") };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const link = { requestId: "req-1", invoiceNumber: "R2G-0001", amountMinor: 63000, currency: "GBP", customerEmail: "ads@example.test", successUrl: "https://app.example.test/ok", cancelUrl: "https://app.example.test/no", idempotencyKey: "pay:inv-1:63000:1" };

describe("Stripe", () => {
  it("builds the Connect URL and exchanges a code for the account id only", async () => {
    const url = createStripeConnectUrl({ clientId: "ca_1", state: "st" });
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "ca_1", state: "st", scope: "read_write", response_type: "code" });
    const { calls, fetchImpl } = fake(() => json({ stripe_user_id: "acct_123", access_token: "never-stored" }));
    await expect(exchangeStripeConnectCode({ secretKey: "sk_test", code: "c", fetch: fetchImpl })).resolves.toEqual({ accountId: "acct_123" });
    expect(calls[0]!.headers.authorization).toBe("Bearer sk_test");
    await expect(exchangeStripeConnectCode({ secretKey: "sk", code: "c", fetch: fake(() => json({ error: "invalid_grant" }, 400)).fetchImpl })).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it("creates a hosted Checkout page on the franchise's own account for exactly the balance, with an idempotency key", async () => {
    const { calls, fetchImpl } = fake(() => json({ id: "cs_1", url: "https://checkout.stripe.test/c/pay/cs_1" }));
    const result = await createStripePaymentLink({ config: { secretKey: "sk" }, accountId: "acct_123", link, fetch: fetchImpl, now: new Date("2026-10-09T12:00:00Z") });
    expect(result).toMatchObject({ providerRequestId: "cs_1", url: "https://checkout.stripe.test/c/pay/cs_1" });
    const call = calls[0]!;
    expect(call.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(call.headers).toMatchObject({ authorization: "Bearer sk", "stripe-account": "acct_123", "idempotency-key": "pay:inv-1:63000:1" });
    const form = new URLSearchParams(call.body);
    expect(Object.fromEntries(form)).toMatchObject({ mode: "payment", client_reference_id: "req-1", customer_email: "ads@example.test", "line_items[0][price_data][currency]": "gbp", "line_items[0][price_data][unit_amount]": "63000", "line_items[0][quantity]": "1", "metadata[payment_request_id]": "req-1" });
    expect(Number(form.get("expires_at"))).toBe(Math.floor(new Date("2026-10-10T11:00:00Z").getTime() / 1000));
  });

  it("treats rate limits and outages as transient and a refusal as permanent, and expires a session", async () => {
    await expect(createStripePaymentLink({ config: { secretKey: "sk" }, accountId: "a", link, fetch: fake(() => json({}, 429)).fetchImpl })).rejects.toMatchObject({ transient: true });
    await expect(createStripePaymentLink({ config: { secretKey: "sk" }, accountId: "a", link, fetch: fake(() => json({ error: { message: "No such account" } }, 400)).fetchImpl })).rejects.toMatchObject({ transient: false });
    expect(await expireStripePaymentLink({ config: { secretKey: "sk" }, accountId: "a", providerRequestId: "cs_1", fetch: fake(() => json({}, 200)).fetchImpl })).toBe(true);
  });

  it("verifies the signature, the timestamp window and secret rotation, and refuses everything else", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const now = 1_800_000_000;
    const header = signStripeBody("whsec_a", body, now);
    expect(verifyStripeSignature({ header, body, secrets: ["whsec_a"], nowSeconds: now })).toBe(true);
    expect(verifyStripeSignature({ header, body, secrets: ["whsec_old", "whsec_a"], nowSeconds: now + 100 })).toBe(true);
    expect(verifyStripeSignature({ header, body, secrets: ["whsec_b"], nowSeconds: now })).toBe(false);
    expect(verifyStripeSignature({ header, body: body + " ", secrets: ["whsec_a"], nowSeconds: now })).toBe(false);
    expect(verifyStripeSignature({ header, body, secrets: ["whsec_a"], nowSeconds: now + 3600 })).toBe(false);
    expect(verifyStripeSignature({ header: null, body, secrets: ["whsec_a"], nowSeconds: now })).toBe(false);
    expect(verifyStripeSignature({ header: "t=abc,v1=zz", body, secrets: ["whsec_a"], nowSeconds: now })).toBe(false);
    expect(verifyStripeSignature({ header, body, secrets: [], nowSeconds: now })).toBe(false);
  });

  it("translates events, acting only on real money and failure outcomes", () => {
    const completed = (payment_status: string) => ({ id: "evt_1", type: "checkout.session.completed", account: "acct_1", data: { object: { id: "cs_1", payment_status, amount_total: 63000, currency: "gbp", payment_intent: "pi_1" } } });
    expect(parseStripeEvent(completed("paid"))).toMatchObject({ kind: "succeeded", ref: { providerRequestId: "cs_1" }, providerPaymentId: "pi_1", amountMinor: 63000, currency: "GBP", accountId: "acct_1" });
    // A bank payment that has not cleared yet is not money.
    expect(parseStripeEvent(completed("unpaid")).kind).toBe("ignored");
    expect(parseStripeEvent({ ...completed("paid"), type: "checkout.session.async_payment_succeeded" }).kind).toBe("succeeded");
    expect(parseStripeEvent({ ...completed("unpaid"), type: "checkout.session.async_payment_failed" }).kind).toBe("failed");
    expect(parseStripeEvent({ ...completed("unpaid"), type: "checkout.session.expired" }).kind).toBe("expired");
    expect(parseStripeEvent({ id: "e", type: "charge.refunded", data: { object: { payment_intent: "pi_1", amount_refunded: 1000 } } })).toMatchObject({ kind: "refunded", ref: { providerPaymentId: "pi_1" }, amountMinor: 1000 });
    expect(parseStripeEvent({ id: "e", type: "charge.dispute.created", data: { object: { payment_intent: "pi_1", amount: 63000, reason: "fraudulent" } } })).toMatchObject({ kind: "disputed", reason: "fraudulent" });
    expect(parseStripeEvent({ id: "e", type: "customer.created", data: { object: {} } }).kind).toBe("ignored");
    expect(() => parseStripeEvent({ nope: true })).toThrow(PaymentProviderError);
  });
});

describe("GoCardless", () => {
  it("connects through OAuth for the right environment and returns the access token and organisation", async () => {
    const url = createGoCardlessConnectUrl({ clientId: "c", redirectUri: "https://app.example.test/cb", state: "st", environment: "sandbox" });
    expect(url.origin).toBe("https://connect-sandbox.gocardless.com");
    expect(createGoCardlessConnectUrl({ clientId: "c", redirectUri: "r", state: "s", environment: "live" }).origin).toBe("https://connect.gocardless.com");
    const { fetchImpl } = fake(() => json({ access_token: "tok", organisation_id: "OR123" }));
    await expect(exchangeGoCardlessCode({ clientId: "c", clientSecret: "s", redirectUri: "r", code: "x", environment: "sandbox", fetch: fetchImpl })).resolves.toEqual({ accessToken: "tok", organisationId: "OR123" });
    await expect(exchangeGoCardlessCode({ clientId: "c", clientSecret: "s", redirectUri: "r", code: "x", environment: "sandbox", fetch: fake(() => json({}, 400)).fetchImpl })).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it("creates a billing request for the exact amount and a hosted flow, each with its own idempotency key", async () => {
    const { calls, fetchImpl } = fake((call) => (call.url.endsWith("/billing_requests") ? json({ billing_requests: { id: "BRQ1" } }) : json({ billing_request_flows: { authorisation_url: "https://pay.gocardless.test/flow/x" } })));
    const result = await createGoCardlessPaymentLink({ accessToken: "tok", environment: "sandbox", link, fetch: fetchImpl });
    expect(result).toEqual({ providerRequestId: "BRQ1", url: "https://pay.gocardless.test/flow/x", expiresAt: null });
    expect(calls[0]!.headers).toMatchObject({ authorization: "Bearer tok", "gocardless-version": "2015-07-06", "idempotency-key": "pay:inv-1:63000:1:request" });
    expect(JSON.parse(calls[0]!.body).billing_requests.payment_request).toEqual({ description: "Invoice R2G-0001", amount: 63000, currency: "GBP" });
    expect(JSON.parse(calls[1]!.body).billing_request_flows).toMatchObject({ redirect_uri: link.successUrl, links: { billing_request: "BRQ1" } });
    expect(calls[1]!.headers["idempotency-key"]).toBe("pay:inv-1:63000:1:flow");
  });

  it("looks up the payment a request created and its amount, and refuses odd answers", async () => {
    await expect(getGoCardlessBillingRequestPayment({ accessToken: "t", environment: "sandbox", billingRequestId: "BRQ1", fetch: fake(() => json({ billing_requests: { links: { payment_request_payment: "PM1" } } })).fetchImpl })).resolves.toBe("PM1");
    await expect(getGoCardlessBillingRequestPayment({ accessToken: "t", environment: "sandbox", billingRequestId: "BRQ1", fetch: fake(() => json({ billing_requests: { links: {} } })).fetchImpl })).resolves.toBeNull();
    await expect(getGoCardlessPayment({ accessToken: "t", environment: "sandbox", paymentId: "PM1", fetch: fake(() => json({ payments: { amount: 63000, currency: "GBP", status: "confirmed" } })).fetchImpl })).resolves.toEqual({ amountMinor: 63000, currency: "GBP", status: "confirmed" });
    await expect(getGoCardlessPayment({ accessToken: "t", environment: "sandbox", paymentId: "PM1", fetch: fake(() => json({}, 404)).fetchImpl })).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it("verifies the webhook signature against the exact body", () => {
    const body = JSON.stringify({ events: [] });
    const header = signGoCardlessBody("secret", body);
    expect(verifyGoCardlessSignature({ header, body, secrets: ["secret"] })).toBe(true);
    expect(verifyGoCardlessSignature({ header: header.toUpperCase(), body, secrets: ["secret"] })).toBe(true);
    expect(verifyGoCardlessSignature({ header, body: body + "x", secrets: ["secret"] })).toBe(false);
    expect(verifyGoCardlessSignature({ header, body, secrets: ["other"] })).toBe(false);
    expect(verifyGoCardlessSignature({ header: null, body, secrets: ["secret"] })).toBe(false);
  });

  it("parses events and counts money only when a payment is confirmed", () => {
    const events = parseGoCardlessEvents({ events: [
      { id: "EV1", resource_type: "payments", action: "confirmed", links: { payment: "PM1", organisation: "OR1" } },
      { id: "EV2", resource_type: "payments", action: "failed", links: { payment: "PM1" }, details: { description: "Insufficient funds" } },
      { id: "EV3", resource_type: "payments", action: "charged_back", links: { payment: "PM1" } },
      { id: "EV4", resource_type: "billing_requests", action: "fulfilled", links: { billing_request: "BRQ1" } },
      { id: "EV5", resource_type: "payments", action: "submitted", links: { payment: "PM1" } },
      { id: "EV6", resource_type: "billing_requests", action: "cancelled", links: { billing_request: "BRQ1" } }
    ] });
    const kinds = events.map((event) => outcomeFromGoCardlessEvent(event).kind);
    expect(kinds).toEqual(["succeeded", "failed", "disputed", "ignored", "ignored", "failed"]);
    expect(outcomeFromGoCardlessEvent(events[0]!)).toMatchObject({ ref: { providerPaymentId: "PM1" }, accountId: "OR1" });
    expect(outcomeFromGoCardlessEvent(events[3]!).ref.providerRequestId).toBe("BRQ1");
    expect(() => parseGoCardlessEvents({ nope: 1 })).toThrow(PaymentProviderError);
    expect(() => parseGoCardlessEvents({ events: [{ id: 1 }] })).toThrow(PaymentProviderError);
  });
});
