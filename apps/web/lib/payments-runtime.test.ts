import { randomBytes, randomUUID } from "node:crypto";
import {
  advertiserCreditNoteLines, advertiserCreditNotes, advertiserDomainEvents, advertiserInvoiceLines, advertiserInvoices, advertiserPaymentAllocations, advertiserPayments, advertiserProposalAcceptances, advertiserProviderSyncReferences,
  advertisers, artworkRequirements, artworkVersions, auditEvents, commercialBookingItems, commercialBookings, commercialProductionRequests, commercialProposalItems, commercialProposals, createDb, fixtureIds,
  invoicePaymentRequests, inventoryReservations, inventorySlots, organisations, providerConnectionSecrets, providerConnections, rateLimitBuckets, webhookEventClaims
} from "@raring2go/db";
import { rateLimitKey, rateLimitRules } from "@raring2go/security";
import { completeProviderConnection, createDrizzleProviderConnectionRepository, createDrizzleSecretRepository, createEncryptedSecretStore, signGoCardlessBody, signStripeBody } from "@raring2go/integrations";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAdvertiserRecord } from "./advertising-mutations";
import { bookProposalRecord, createInvoiceRecord, createProposalRecord, issueInvoiceRecord, sendProposalRecord } from "./advertising-sales";
import { withFinanceGuardsDisabled } from "./finance-test-support";
import {
  PaymentRateLimitedError, PaymentNotAvailableError, PaymentWebhookAuthError, PaymentWebhookRetryError, applyPaymentOutcome, createPaymentLinkAsAdvertiser, createPaymentLinkAsStaff, paymentOptionsFor, parseBankDetails, processGoCardlessWebhook, processStripeWebhook, readPaymentsOverview
} from "./payments-runtime";

describe("bank details", () => {
  it("accepts a name, six-digit sort code and eight-digit account number, and refuses the rest", () => {
    expect(parseBankDetails({ accountName: "  Sutton  Media Ltd ", sortCode: "12 34-56", accountNumber: "1234 5678" })).toEqual({ accountName: "Sutton Media Ltd", sortCode: "12-34-56", accountNumber: "12345678" });
    for (const bad of [{ accountName: "", sortCode: "123456", accountNumber: "12345678" }, { accountName: "A<b>", sortCode: "123456", accountNumber: "12345678" }, { accountName: "Ok", sortCode: "12345", accountNumber: "12345678" }, { accountName: "Ok", sortCode: "123456", accountNumber: "1234567" }, { accountName: "Ok", sortCode: "12-34-5x", accountNumber: "12345678" }]) {
      expect(() => parseBankDetails(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

/** Real database: online payments create one live link, and a provider's signed answer is believed exactly once. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("online payments (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const product = fixtureIds.commercialProducts.fullPageAdvert;
  const ACCOUNT = `acct_${tag}`;
  const advertiserIds: string[] = [];
  const organisationIds: string[] = [];
  const slotIds: string[] = [];
  const proposalIds: string[] = [];
  const connectionIds: string[] = [];
  const stripeCalls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  let stripeSession = 0;
  let stripeFails = false;
  const SECRET = `whsec_${tag}`;
  const GC_SECRET = `gcsecret_${tag}`;

  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const call = { url, headers, body: String(init?.body ?? "") };
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith("https://api.stripe.com")) {
      stripeCalls.push(call);
      if (url.endsWith("/expire")) return respond({});
      if (stripeFails) return respond({ error: { message: "No such account" } }, 400);
      stripeSession += 1;
      return respond({ id: `cs_${tag}_${stripeSession}`, url: `https://checkout.stripe.test/c/${tag}/${stripeSession}` });
    }
    if (url.includes("/billing_request_flows")) return respond({ billing_request_flows: { authorisation_url: `https://pay.gocardless.test/${tag}` } });
    if (url.endsWith("/billing_requests")) return respond({ billing_requests: { id: `BRQ_${tag}` } });
    if (url.includes(`/billing_requests/BRQ_${tag}`)) return respond({ billing_requests: { links: { payment_request_payment: `PM_${tag}` } } });
    if (url.includes(`/payments/PM_${tag}`)) return respond({ payments: { amount: gcAmount, currency: "GBP", status: "confirmed" } });
    return respond({}, 404);
  }) as unknown as typeof fetch;
  let gcAmount = 0;

  // Rate limit keys are hashed, so clear them the way the limiter builds them.
  const clearLimits = () => db.delete(rateLimitBuckets).where(inArray(rateLimitBuckets.key, [sutton.userId, hq.userId, fixtureIds.users.advertiserUser].map((id) => rateLimitKey(rateLimitRules.paymentLinkUser, id))));
  const store = () => createEncryptedSecretStore({ repository: createDrizzleSecretRepository(db), encryptionKey: process.env.INTEGRATION_SECRET_ENCRYPTION_KEY!, keyVersion: "v1" });

  async function connectProvider(provider: "stripe" | "gocardless", accountId: string, token: object) {
    const permissions = await (await import("./permission-source")).getPermissionData();
    const connection = await completeProviderConnection({ context: sutton, permissions, repository: createDrizzleProviderConnectionRepository(db), secretStore: store(), audit: { record: async () => undefined }, provider, connectionType: "payments", externalAccountId: accountId, externalAccountDisplayName: provider, grantedScopes: [], token: JSON.stringify(token) });
    connectionIds.push(connection.id);
  }

  async function newInvoice(label: string, price = 50000, owner: "own" | "fixture" = "own") {
    let advertiserId: string;
    if (owner === "fixture") advertiserId = fixtureIds.advertisers.example;
    else {
      const created = await createAdvertiserRecord(sutton, { newOrganisationName: `Pay ${label} ${tag}`, owningTerritoryId: sutton.territoryId });
      advertiserIds.push(created.id);
      organisationIds.push(created.advertiserOrganisationId);
      advertiserId = created.id;
    }
    const slotId = randomUUID();
    await db.insert(inventorySlots).values({ id: slotId, territoryId: sutton.territoryId, productId: product, slotKey: `pay-${slotId.slice(0, 8)}`, inventoryClass: "page", exclusive: true, status: "available", metadata: {} });
    slotIds.push(slotId);
    const proposal = await createProposalRecord(sutton, { advertiserId, title: label, validUntil: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), lines: [{ productId: product, quantity: 1, unitPriceMinor: price, inventorySlotId: slotId }] });
    proposalIds.push(proposal.id);
    await sendProposalRecord(sutton, proposal.id);
    const booking = await bookProposalRecord(sutton, proposal.id);
    const draft = await createInvoiceRecord(sutton, booking.id, { dueInDays: 30 });
    return issueInvoiceRecord(sutton, draft.id);
  }

  const requestsFor = (invoiceId: string) => db.select().from(invoicePaymentRequests).where(eq(invoicePaymentRequests.invoiceId, invoiceId));
  const invoiceOf = async (id: string) => (await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, id)))[0]!;
  const paymentsFor = async (invoiceId: string) => {
    const [invoice] = await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, invoiceId));
    return db.select().from(advertiserPayments).where(and(eq(advertiserPayments.advertiserId, invoice!.advertiserId), inArray(advertiserPayments.providerKey, ["stripe", "gocardless"])));
  };
  const stripeEvent = (type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}) => JSON.stringify({ id: `evt_${randomUUID()}`, type, account: ACCOUNT, data: { object }, ...extra });
  const sendStripe = (rawBody: string, secret = SECRET, at?: number) => processStripeWebhook({ rawBody, signatureHeader: signStripeBody(secret, rawBody, at ?? Math.floor(Date.now() / 1000)) }, { secrets: [SECRET] });

  beforeAll(async () => {
    vi.stubEnv("INTEGRATION_SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_CONNECT_CLIENT_ID", "ca_x");
    vi.stubEnv("GOCARDLESS_CLIENT_ID", "gc_id");
    vi.stubEnv("GOCARDLESS_CLIENT_SECRET", "gc_secret");
    vi.stubEnv("GOCARDLESS_REDIRECT_URI", "https://app.example.test/api/integrations/gocardless/callback");
    vi.stubEnv("GOCARDLESS_WEBHOOK_SECRET", GC_SECRET);
    vi.stubEnv("APP_URL", "https://app.example.test");
    // The per-person limit is real; this suite creates many links as the same people, so it starts from a clean counter.
    await clearLimits();
    await db.update(providerConnections).set({ status: "revoked" }).where(and(inArray(providerConnections.provider, ["stripe", "gocardless"]), eq(providerConnections.organisationId, sutton.organisationId)));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await clearLimits();
    await withFinanceGuardsDisabled(db, async () => {
      const invoices = await db.select({ id: advertiserInvoices.id, advertiserId: advertiserInvoices.advertiserId }).from(advertiserInvoices).where(inArray(advertiserInvoices.advertiserId, [...advertiserIds, fixtureIds.advertisers.example]));
      const mine = invoices.filter((row) => advertiserIds.includes(row.advertiserId) || proposalIds.length > 0);
      const invoiceIds = mine.map((row) => row.id);
      const bookings = await db.select({ id: commercialBookings.id }).from(commercialBookings).where(inArray(commercialBookings.proposalId, proposalIds));
      const exampleInvoiceIds = invoiceIds.length ? (await db.select({ id: advertiserInvoices.id }).from(advertiserInvoices).where(and(inArray(advertiserInvoices.id, invoiceIds), inArray(advertiserInvoices.bookingId, bookings.map((row) => row.id))))).map((row) => row.id) : [];
      const ours = [...new Set([...invoiceIds.filter((id) => advertiserIds.includes(mine.find((row) => row.id === id)!.advertiserId)), ...exampleInvoiceIds])];
      const payments = await db.select({ id: advertiserPayments.id }).from(advertiserPayments).where(like(advertiserPayments.externalReference, `%${tag}%`));
      if (ours.length) await db.delete(invoicePaymentRequests).where(inArray(invoicePaymentRequests.invoiceId, ours));
      const credits = ours.length ? await db.select({ id: advertiserCreditNotes.id }).from(advertiserCreditNotes).where(inArray(advertiserCreditNotes.invoiceId, ours)) : [];
      const entityIds = [...ours, ...credits.map((row) => row.id), ...organisationIds];
      if (entityIds.length) await db.delete(advertiserProviderSyncReferences).where(inArray(advertiserProviderSyncReferences.entityId, entityIds));
      const paymentIds = payments.map((row) => row.id);
      if (paymentIds.length) await db.delete(advertiserPaymentAllocations).where(inArray(advertiserPaymentAllocations.paymentId, paymentIds));
      if (ours.length) await db.delete(advertiserPaymentAllocations).where(inArray(advertiserPaymentAllocations.invoiceId, ours));
      if (credits.length) await db.delete(advertiserCreditNoteLines).where(inArray(advertiserCreditNoteLines.creditNoteId, credits.map((row) => row.id)));
      if (credits.length) await db.delete(advertiserCreditNotes).where(inArray(advertiserCreditNotes.id, credits.map((row) => row.id)));
      if (paymentIds.length) await db.delete(advertiserPayments).where(inArray(advertiserPayments.id, paymentIds));
      if (ours.length) await db.delete(advertiserInvoiceLines).where(inArray(advertiserInvoiceLines.invoiceId, ours));
      if (ours.length) await db.delete(advertiserInvoices).where(inArray(advertiserInvoices.id, ours));
      await db.delete(advertiserDomainEvents).where(inArray(advertiserDomainEvents.advertiserId, [...advertiserIds, fixtureIds.advertisers.example]));
      await db.delete(advertiserProposalAcceptances).where(inArray(advertiserProposalAcceptances.proposalId, proposalIds));
      const requirements = await db.select({ id: artworkRequirements.id }).from(artworkRequirements).where(inArray(artworkRequirements.advertiserId, [...advertiserIds, fixtureIds.advertisers.example]));
      if (requirements.length) await db.delete(artworkVersions).where(inArray(artworkVersions.artworkRequirementId, requirements.map((row) => row.id)));
      if (requirements.length) await db.delete(artworkRequirements).where(inArray(artworkRequirements.id, requirements.map((row) => row.id)));
      await db.delete(commercialProductionRequests).where(inArray(commercialProductionRequests.advertiserId, [...advertiserIds, fixtureIds.advertisers.example]));
      if (bookings.length) await db.delete(commercialBookingItems).where(inArray(commercialBookingItems.bookingId, bookings.map((row) => row.id)));
      if (bookings.length) await db.delete(commercialBookings).where(inArray(commercialBookings.id, bookings.map((row) => row.id)));
      await db.delete(inventoryReservations).where(inArray(inventoryReservations.inventorySlotId, slotIds));
      await db.delete(commercialProposalItems).where(inArray(commercialProposalItems.proposalId, proposalIds));
      await db.delete(commercialProposals).where(inArray(commercialProposals.id, proposalIds));
      await db.delete(inventorySlots).where(inArray(inventorySlots.id, slotIds));
      if (advertiserIds.length) await db.delete(advertisers).where(inArray(advertisers.id, advertiserIds));
      if (organisationIds.length) await db.delete(organisations).where(inArray(organisations.id, organisationIds));
      await db.delete(webhookEventClaims).where(inArray(webhookEventClaims.providerKey, ["stripe", "gocardless"]));
      await db.delete(auditEvents).where(and(like(auditEvents.action, "advertiser.payment.%"), eq(auditEvents.actorUserId, sutton.userId)));
    });
    if (connectionIds.length) {
      await db.delete(providerConnectionSecrets).where(inArray(providerConnectionSecrets.providerConnectionId, connectionIds));
      await db.delete(providerConnections).where(inArray(providerConnections.id, connectionIds));
    }
    await sql.end();
  });

  it("offers only what the franchise has connected, and refuses a link for a way of paying that is not set up", async () => {
    const invoice = await newInvoice("none");
    expect(await paymentOptionsFor({ issuerOrganisationId: invoice.issuerOrganisationId, territoryId: invoice.territoryId })).toEqual({ stripe: false, gocardless: false, bank: null });
    await expect(createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch })).rejects.toBeInstanceOf(PaymentNotAvailableError);
    expect(await requestsFor(invoice.id)).toHaveLength(0);
  });

  it("creates one live Stripe link on the franchise's own account for exactly the balance, reuses it, and replaces it when the balance changes", async () => {
    await connectProvider("stripe", ACCOUNT, { accountId: ACCOUNT });
    const invoice = await newInvoice("stripe", 50000);
    const first = await createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch });
    expect(first).toMatchObject({ reused: false, amountMinor: 60000, provider: "stripe", url: expect.stringContaining("checkout.stripe.test") });
    const create = stripeCalls.find((call) => call.url.endsWith("/checkout/sessions"))!;
    expect(create.headers).toMatchObject({ "stripe-account": ACCOUNT });
    expect(new URLSearchParams(create.body).get("line_items[0][price_data][unit_amount]")).toBe("60000");

    const callsBefore = stripeCalls.length;
    const again = await createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch });
    expect(again).toMatchObject({ reused: true, url: first.url });
    expect(stripeCalls.length).toBe(callsBefore);

    // Two clicks at once still leave one live link.
    const [a, b] = await Promise.all([createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch }), createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch })]);
    expect(a.url).toBe(b.url);
    expect((await requestsFor(invoice.id)).filter((request) => request.status === "open")).toHaveLength(1);

    // A part payment changes the balance, so the old link is replaced and expired at Stripe.
    await db.update(advertiserInvoices).set({ amountPaidMinor: 10000, balanceMinor: 50000, status: "part_paid" }).where(eq(advertiserInvoices.id, invoice.id));
    const replaced = await createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch });
    expect(replaced).toMatchObject({ reused: false, amountMinor: 50000 });
    expect(stripeCalls.some((call) => call.url.endsWith("/expire"))).toBe(true);
    const all = await requestsFor(invoice.id);
    expect(all.filter((request) => request.status === "open")).toHaveLength(1);
    expect(all.filter((request) => request.status === "cancelled").length).toBeGreaterThanOrEqual(1);
    await db.update(advertiserInvoices).set({ amountPaidMinor: 0, balanceMinor: 60000, status: "issued" }).where(eq(advertiserInvoices.id, invoice.id));
  });

  it("keeps a provider failure visible and frees the invoice for a new attempt", async () => {
    const invoice = await newInvoice("fail");
    stripeFails = true;
    await expect(createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch })).rejects.toThrow(/Stripe/);
    stripeFails = false;
    expect((await requestsFor(invoice.id)).map((request) => request.status)).toEqual(["failed"]);
    await expect(createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch })).resolves.toMatchObject({ reused: false });
  });

  it("only lets people who may request payments, in their own territory, create a link, and an advertiser only for their own invoice", async () => {
    const invoice = await newInvoice("auth");
    await expect(createPaymentLinkAsStaff({ userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser }, invoice.id, "stripe", { fetch: fakeFetch })).rejects.toThrow();
    await expect(createPaymentLinkAsStaff({ ...hq, territoryId: fixtureIds.territories.solihull }, invoice.id, "stripe", { fetch: fakeFetch })).rejects.toThrow(/outside/);
    await expect(createPaymentLinkAsAdvertiser({ userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser }, invoice.id, "stripe", { fetch: fakeFetch })).rejects.toThrow(/not found/i);
    expect(await requestsFor(invoice.id)).toHaveLength(0);

    const own = await newInvoice("own", 50000, "fixture");
    const link = await createPaymentLinkAsAdvertiser({ userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser }, own.id, "stripe", { fetch: fakeFetch });
    expect(link.url).toContain("checkout.stripe.test");
  });

  it("records and allocates a paid Stripe checkout exactly once, however many times or in what order it is delivered", async () => {
    const invoice = await newInvoice("paid", 50000);
    const link = await createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch });
    const session = (await requestsFor(invoice.id))[0]!.providerRequestId;
    const completed = stripeEvent("checkout.session.completed", { id: session, payment_status: "paid", amount_total: 60000, currency: "gbp", payment_intent: `pi_${tag}_paid` });

    await expect(sendStripe(completed)).resolves.toBe("applied");
    await expect(sendStripe(completed)).resolves.toBe("duplicate");
    await expect(sendStripe(stripeEvent("checkout.session.async_payment_succeeded", { id: session, payment_status: "paid", amount_total: 60000, currency: "gbp", payment_intent: `pi_${tag}_paid` }))).resolves.toBe("duplicate");

    expect(await invoiceOf(invoice.id)).toMatchObject({ status: "paid", amountPaidMinor: 60000, balanceMinor: 0 });
    const payments = (await paymentsFor(invoice.id)).filter((payment) => payment.externalReference === `pi_${tag}_paid`);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amountMinor: 60000, allocatedMinor: 60000, unallocatedMinor: 0, method: "online", providerKey: "stripe" });
    expect((await requestsFor(invoice.id))[0]).toMatchObject({ status: "paid", providerPaymentId: `pi_${tag}_paid` });
    expect(link.url).toBeTruthy();
  });

  it("allocates a part payment, holds an overpayment as credit, and does not allocate to an invoice already settled", async () => {
    const part = await newInvoice("part", 50000);
    await createPaymentLinkAsStaff(sutton, part.id, "stripe", { fetch: fakeFetch });
    const partSession = (await requestsFor(part.id))[0]!.providerRequestId;
    await sendStripe(stripeEvent("checkout.session.completed", { id: partSession, payment_status: "paid", amount_total: 25000, currency: "gbp", payment_intent: `pi_${tag}_part` }));
    expect(await invoiceOf(part.id)).toMatchObject({ status: "part_paid", amountPaidMinor: 25000, balanceMinor: 35000 });

    const over = await newInvoice("over", 50000);
    await createPaymentLinkAsStaff(sutton, over.id, "stripe", { fetch: fakeFetch });
    const overSession = (await requestsFor(over.id))[0]!.providerRequestId;
    await sendStripe(stripeEvent("checkout.session.completed", { id: overSession, payment_status: "paid", amount_total: 65000, currency: "gbp", payment_intent: `pi_${tag}_over` }));
    expect(await invoiceOf(over.id)).toMatchObject({ status: "paid", balanceMinor: 0 });
    expect((await paymentsFor(over.id)).find((payment) => payment.externalReference === `pi_${tag}_over`)).toMatchObject({ amountMinor: 65000, allocatedMinor: 60000, unallocatedMinor: 5000 });
    const overview = await readPaymentsOverview(sutton);
    expect(overview.unallocated.some((payment) => payment.unallocatedMinor === 5000)).toBe(true);

    // Settled another way while the link was open: the money is held, not applied to a paid invoice.
    const settled = await newInvoice("settled", 50000);
    await createPaymentLinkAsStaff(sutton, settled.id, "stripe", { fetch: fakeFetch });
    const settledSession = (await requestsFor(settled.id))[0]!.providerRequestId;
    await db.update(advertiserInvoices).set({ status: "paid", amountPaidMinor: 60000, balanceMinor: 0 }).where(eq(advertiserInvoices.id, settled.id));
    await sendStripe(stripeEvent("checkout.session.completed", { id: settledSession, payment_status: "paid", amount_total: 60000, currency: "gbp", payment_intent: `pi_${tag}_settled` }));
    expect((await paymentsFor(settled.id)).find((payment) => payment.externalReference === `pi_${tag}_settled`)).toMatchObject({ allocatedMinor: 0, unallocatedMinor: 60000 });
  });

  it("refuses unsigned, stale or wrongly signed events, ignores another account's, flags a currency mismatch, and never counts unpaid sessions", async () => {
    const invoice = await newInvoice("guards", 50000);
    await createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch });
    const session = (await requestsFor(invoice.id))[0]!.providerRequestId;
    const event = (extra: Record<string, unknown> = {}, account: string | null = ACCOUNT) => JSON.stringify({ id: `evt_${randomUUID()}`, type: "checkout.session.completed", ...(account ? { account } : {}), data: { object: { id: session, payment_status: "paid", amount_total: 60000, currency: "gbp", payment_intent: `pi_${tag}_g`, ...extra } } });

    const body = event();
    await expect(processStripeWebhook({ rawBody: body, signatureHeader: null }, { secrets: [SECRET] })).rejects.toBeInstanceOf(PaymentWebhookAuthError);
    await expect(sendStripe(body, "whsec_wrong")).rejects.toBeInstanceOf(PaymentWebhookAuthError);
    await expect(sendStripe(body, SECRET, Math.floor(Date.now() / 1000) - 3600)).rejects.toBeInstanceOf(PaymentWebhookAuthError);
    expect(await paymentsFor(invoice.id)).toHaveLength(0);

    await expect(sendStripe(event({}, "acct_someone_else"))).resolves.toBe("ignored");
    await expect(sendStripe(event({ payment_status: "unpaid" }))).resolves.toBe("ignored");
    await expect(sendStripe(event({ currency: "usd" }))).resolves.toBe("needs_review");
    expect(await paymentsFor(invoice.id)).toHaveLength(0);
    expect((await requestsFor(invoice.id))[0]!.status).toBe("open");
    await expect(sendStripe(JSON.stringify({ id: "evt_x", type: "checkout.session.completed", account: ACCOUNT, data: { object: { id: "cs_unknown", payment_status: "paid", amount_total: 1, currency: "gbp" } } }))).resolves.toBe("unmatched");
  });

  it("marks failed, expired, refunded and disputed outcomes without moving any money", async () => {
    const make = async (label: string) => {
      const invoice = await newInvoice(label, 50000);
      await createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch });
      return { invoice, session: (await requestsFor(invoice.id))[0]!.providerRequestId };
    };
    const expired = await make("expired");
    await sendStripe(stripeEvent("checkout.session.expired", { id: expired.session }));
    expect((await requestsFor(expired.invoice.id))[0]).toMatchObject({ status: "expired" });

    const failed = await make("failed");
    await sendStripe(stripeEvent("checkout.session.async_payment_failed", { id: failed.session }));
    expect((await requestsFor(failed.invoice.id))[0]).toMatchObject({ status: "failed" });
    // A failed attempt frees the invoice for a fresh link.
    await expect(createPaymentLinkAsStaff(sutton, failed.invoice.id, "stripe", { fetch: fakeFetch })).resolves.toMatchObject({ reused: false });

    const disputed = await make("disputed");
    await sendStripe(stripeEvent("checkout.session.completed", { id: disputed.session, payment_status: "paid", amount_total: 60000, currency: "gbp", payment_intent: `pi_${tag}_dispute` }));
    await sendStripe(stripeEvent("charge.dispute.created", { payment_intent: `pi_${tag}_dispute`, amount: 60000, reason: "fraudulent" }));
    expect((await requestsFor(disputed.invoice.id))[0]).toMatchObject({ status: "disputed", failureReason: "fraudulent" });
    // The payment and the invoice are untouched: a person decides what to do.
    expect(await invoiceOf(disputed.invoice.id)).toMatchObject({ status: "paid", amountPaidMinor: 60000 });
    const overview = await readPaymentsOverview(sutton);
    expect(overview.attention.some((item) => item.status === "disputed")).toBe(true);

    const refunded = await make("refunded");
    await sendStripe(stripeEvent("checkout.session.completed", { id: refunded.session, payment_status: "paid", amount_total: 60000, currency: "gbp", payment_intent: `pi_${tag}_refund` }));
    await sendStripe(stripeEvent("charge.refunded", { payment_intent: `pi_${tag}_refund`, amount_refunded: 60000 }));
    expect((await requestsFor(refunded.invoice.id))[0]).toMatchObject({ status: "refunded" });
    expect(await invoiceOf(refunded.invoice.id)).toMatchObject({ status: "paid" });
  });

  it("handles a GoCardless payment end to end: matched via the fulfilled request, the amount taken from GoCardless, applied once", async () => {
    await connectProvider("gocardless", `OR_${tag}`, { accessToken: "gc_token" });
    const invoice = await newInvoice("gc", 50000);
    const link = await createPaymentLinkAsStaff(sutton, invoice.id, "gocardless", { fetch: fakeFetch });
    expect(link.url).toBe(`https://pay.gocardless.test/${tag}`);
    const send = (events: unknown[], secret = GC_SECRET) => {
      const rawBody = JSON.stringify({ events });
      return processGoCardlessWebhook({ rawBody, signatureHeader: signGoCardlessBody(secret, rawBody) }, { secrets: [GC_SECRET], fetch: fakeFetch });
    };
    const event = (resource_type: string, action: string, links: Record<string, string>, id = `EV_${randomUUID()}`) => ({ id, resource_type, action, links: { organisation: `OR_${tag}`, ...links } });

    gcAmount = 60000;
    // Money arriving before we know which payment is ours is retried, not dropped or guessed.
    await expect(send([event("payments", "confirmed", { payment: `PM_${tag}` })])).rejects.toBeInstanceOf(PaymentWebhookRetryError);
    await expect(send([event("payments", "confirmed", { payment: `PM_${tag}` })], "wrong")).rejects.toBeInstanceOf(PaymentWebhookAuthError);

    await send([event("billing_requests", "fulfilled", { billing_request: `BRQ_${tag}` })]);
    expect((await requestsFor(invoice.id))[0]!.providerPaymentId).toBe(`PM_${tag}`);

    const confirmed = event("payments", "confirmed", { payment: `PM_${tag}` }, `EV_confirm_${tag}`);
    await expect(send([confirmed])).resolves.toEqual(["applied"]);
    await expect(send([confirmed])).resolves.toEqual(["duplicate"]);
    expect(await invoiceOf(invoice.id)).toMatchObject({ status: "paid", amountPaidMinor: 60000 });
    expect((await paymentsFor(invoice.id)).filter((payment) => payment.providerKey === "gocardless")).toHaveLength(1);
    expect((await requestsFor(invoice.id))[0]).toMatchObject({ status: "paid" });
  });

  it("applies each provider outcome in one transaction, so a failure leaves no claim behind and the retry works", async () => {
    const invoice = await newInvoice("atomic", 50000);
    await createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch });
    const request = (await requestsFor(invoice.id))[0]!;
    // An advertiser that has vanished makes the payment step throw after the claim was taken.
    await db.update(advertisers).set({ deletedAt: new Date() }).where(eq(advertisers.id, invoice.advertiserId));
    const outcome = { providerEventId: `evt_atomic_${tag}`, kind: "succeeded" as const, ref: { providerRequestId: request.providerRequestId }, accountId: ACCOUNT, amountMinor: 60000, currency: "GBP", providerPaymentId: `pi_${tag}_atomic` };
    await expect(applyPaymentOutcome("stripe", outcome)).rejects.toThrow();
    expect(await db.select().from(webhookEventClaims).where(eq(webhookEventClaims.eventId, outcome.providerEventId))).toHaveLength(0);
    await db.update(advertisers).set({ deletedAt: null }).where(eq(advertisers.id, invoice.advertiserId));
    await expect(applyPaymentOutcome("stripe", outcome)).resolves.toBe("applied");
    expect(await invoiceOf(invoice.id)).toMatchObject({ status: "paid" });
  });

  it("limits how many payment links one person can create in ten minutes", async () => {
    await clearLimits();
    const invoice = await newInvoice("limit", 50000);
    for (let attempt = 0; attempt < 20; attempt += 1) await createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch });
    await expect(createPaymentLinkAsStaff(sutton, invoice.id, "stripe", { fetch: fakeFetch })).rejects.toBeInstanceOf(PaymentRateLimitedError);
    await clearLimits();
  });
});
