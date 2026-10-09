import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb, invoicePaymentRequests } from "@raring2go/db";
import {
  allocatePayment,
  authorisePaymentRequest,
  describePayableInvoice,
  listPayableInvoices,
  loadAdvertisingData,
  persistAdvertisingChanges,
  portalAuthorisePayment,
  recordPayment,
  resolvePortalIdentity,
  snapshotAdvertisingData
} from "@raring2go/advertising";
import type { AdvertisingActorContext, PayableInvoice } from "@raring2go/advertising";
import { createEmailProviderFromEnv, sendPaymentLinkEmail } from "@raring2go/email";
import {
  PaymentProviderError,
  completeProviderConnection,
  createDrizzleProviderConnectionRepository,
  createDrizzleSecretRepository,
  createEncryptedSecretStore,
  createGoCardlessConnectUrl,
  createGoCardlessPaymentLink,
  createOAuthConnectionTransaction,
  createStripeConnectUrl,
  createStripePaymentLink,
  exchangeGoCardlessCode,
  exchangeStripeConnectCode,
  expireStripePaymentLink,
  getConnectionCredential,
  getGoCardlessBillingRequestPayment,
  getGoCardlessPayment,
  hashOAuthValue,
  outcomeFromGoCardlessEvent,
  parseGoCardlessEvents,
  parseStripeEvent,
  requireIntegrationPermission,
  safeInternalReturnTo,
  verifyGoCardlessSignature,
  verifyStripeSignature
} from "@raring2go/integrations";
import type { GoCardlessEnvironment, PaymentLink, PaymentOutcome, ProviderConnection } from "@raring2go/integrations";
import { evaluatePermission } from "@raring2go/permissions";
import { claimWebhookEvent, rateLimitRules } from "@raring2go/security";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { systemAdvertisingIdentity } from "./advertising-system";
import type { RequestedShellContext } from "./app-shell";
import { requireShellPermission, resolveShell } from "./app-shell";
import { drizzleAuditRecorder, requiredEnv } from "./integrations-runtime";
import { appLogger } from "./logger";
import { getPermissionData } from "./permission-source";
import { firstRateLimitRefusal } from "./rate-limit-runtime";

/**
 * Online payment of advertiser invoices (decision brief 2): hosted pages only, so card and bank details never touch
 * this system; the money goes to the franchise that issued the invoice (its own Stripe account or GoCardless
 * organisation); the outcome is believed only when it arrives by signed webhook, once.
 */
export type PaymentProviderKey = "stripe" | "gocardless";
export const PAYMENT_PROVIDERS: PaymentProviderKey[] = ["stripe", "gocardless"];
export const PAYMENT_CONNECTION_TYPE = "payments";
const BANK_PROVIDER = "bank_transfer";
const BANK_CONNECTION_TYPE = "bank_details";
const SYSTEM_USER = "00000000-0000-4000-8000-000000000203";

type Db = ReturnType<typeof createDb>["db"];

export class PaymentRateLimitedError extends Error {
  constructor() {
    super("Too many payment link requests. Please wait a few minutes.");
    this.name = "PaymentRateLimitedError";
  }
}

export class PaymentNotAvailableError extends Error {
  constructor(message = "That way of paying is not set up for this franchise.") {
    super(message);
    this.name = "PaymentNotAvailableError";
  }
}

// ---- Configuration ----------------------------------------------------------------------------

export const stripeConfigured = (env: Record<string, string | undefined> = process.env) => Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_CONNECT_CLIENT_ID);
export const goCardlessConfigured = (env: Record<string, string | undefined> = process.env) => Boolean(env.GOCARDLESS_CLIENT_ID && env.GOCARDLESS_CLIENT_SECRET && env.GOCARDLESS_REDIRECT_URI);
const goCardlessEnvironment = (): GoCardlessEnvironment => (process.env.GOCARDLESS_ENVIRONMENT === "live" ? "live" : "sandbox");
const webhookSecrets = (current: string, previous: string) => [process.env[current], process.env[previous]].filter((value): value is string => Boolean(value));
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const secretStoreFor = (db: Db) => createEncryptedSecretStore({ repository: createDrizzleSecretRepository(db), encryptionKey: requiredEnv("INTEGRATION_SECRET_ENCRYPTION_KEY"), keyVersion: process.env.INTEGRATION_SECRET_KEY_VERSION ?? "v1" });
const today = () => new Date().toISOString().slice(0, 10);

// ---- Connecting a franchise's payment account -------------------------------------------------

async function startConnection(request: RequestedShellContext, provider: PaymentProviderKey, returnTo: string | null | undefined, buildUrl: (state: string) => URL) {
  const permissions = await getPermissionData();
  const shell = await requireShellPermission(request, { module: "integrations", action: "connect" });
  if (!shell.activeContext.territoryId) throw new Error("Choose your franchise territory before connecting a payment account.");
  const { db, sql } = createDb();
  try {
    const transaction = await createOAuthConnectionTransaction({
      context: { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId },
      permissions,
      repository: createDrizzleProviderConnectionRepository(db),
      provider,
      connectionType: PAYMENT_CONNECTION_TYPE,
      returnTo: safeInternalReturnTo(returnTo)
    });
    return buildUrl(transaction.state);
  } finally {
    await sql.end();
  }
}

export const startStripeConnection = (request: RequestedShellContext, returnTo?: string | null) =>
  startConnection(request, "stripe", returnTo, (state) => createStripeConnectUrl({ clientId: requiredEnv("STRIPE_CONNECT_CLIENT_ID"), state }));

export const startGoCardlessConnection = (request: RequestedShellContext, returnTo?: string | null) =>
  startConnection(request, "gocardless", returnTo, (state) => createGoCardlessConnectUrl({ clientId: requiredEnv("GOCARDLESS_CLIENT_ID"), redirectUri: requiredEnv("GOCARDLESS_REDIRECT_URI"), state, environment: goCardlessEnvironment() }));

async function completeConnection(
  input: { request: RequestedShellContext; state: string },
  provider: PaymentProviderKey,
  exchange: () => Promise<{ accountId: string; token: string; displayName: string }>
) {
  const permissions = await getPermissionData();
  const shell = await resolveShell(input.request);
  if (shell.kind !== "authenticated") throw new Error("The callback needs an active session.");
  const { db, sql } = createDb();
  try {
    const repository = createDrizzleProviderConnectionRepository(db);
    const transaction = await repository.consumeOAuthTransaction({ stateHash: hashOAuthValue(input.state), userId: shell.userId, now: new Date() });
    const account = await exchange();
    const connection = await completeProviderConnection({
      context: { userId: shell.userId, organisationId: transaction.organisationId, territoryId: transaction.territoryId },
      permissions,
      repository,
      secretStore: secretStoreFor(db),
      audit: drizzleAuditRecorder(db),
      provider,
      connectionType: PAYMENT_CONNECTION_TYPE,
      externalAccountId: account.accountId,
      externalAccountDisplayName: account.displayName,
      grantedScopes: ["read_write"],
      token: account.token
    });
    return { connection, returnTo: transaction.returnTo };
  } finally {
    await sql.end();
  }
}

export const completeStripeConnection = (input: { request: RequestedShellContext; state: string; code: string }) =>
  completeConnection(input, "stripe", async () => {
    const { accountId } = await exchangeStripeConnectCode({ secretKey: requiredEnv("STRIPE_SECRET_KEY"), code: input.code });
    // Calls use our key with `Stripe-Account`; nothing secret is held for the franchise, only which account it is.
    return { accountId, token: JSON.stringify({ accountId }), displayName: `Stripe account ${accountId}` };
  });

export const completeGoCardlessConnection = (input: { request: RequestedShellContext; state: string; code: string }) =>
  completeConnection(input, "gocardless", async () => {
    const result = await exchangeGoCardlessCode({ clientId: requiredEnv("GOCARDLESS_CLIENT_ID"), clientSecret: requiredEnv("GOCARDLESS_CLIENT_SECRET"), redirectUri: requiredEnv("GOCARDLESS_REDIRECT_URI"), code: input.code, environment: goCardlessEnvironment() });
    return { accountId: result.organisationId, token: JSON.stringify({ accessToken: result.accessToken }), displayName: `GoCardless ${result.organisationId}` };
  });

export type BankDetails = { accountName: string; sortCode: string; accountNumber: string };

/** What a person typed for their bank details. Digits only, so nothing free-form is ever shown to advertisers as an instruction. */
export function parseBankDetails(input: { accountName: string; sortCode: string; accountNumber: string }): BankDetails {
  const accountName = input.accountName.trim().replace(/\s+/g, " ");
  const sortCode = input.sortCode.replace(/[\s-]/g, "");
  const accountNumber = input.accountNumber.replace(/\s/g, "");
  if (accountName.length < 2 || accountName.length > 60 || /[<>]/.test(accountName)) throw new Error("Enter the account name.");
  if (!/^\d{6}$/.test(sortCode)) throw new Error("A sort code is six digits.");
  if (!/^\d{8}$/.test(accountNumber)) throw new Error("An account number is eight digits.");
  return { accountName, sortCode: `${sortCode.slice(0, 2)}-${sortCode.slice(2, 4)}-${sortCode.slice(4, 6)}`, accountNumber };
}

export async function saveBankDetails(request: RequestedShellContext, details: BankDetails) {
  const permissions = await getPermissionData();
  const shell = await requireShellPermission(request, { module: "integrations", action: "connect" });
  if (!shell.activeContext.territoryId) throw new Error("Choose your franchise territory first.");
  const context = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
  requireIntegrationPermission(context, permissions, "connect", context);
  const { db, sql } = createDb();
  try {
    const connection = await createDrizzleProviderConnectionRepository(db).upsertConnection({
      id: randomUUID(),
      provider: BANK_PROVIDER,
      connectionType: BANK_CONNECTION_TYPE,
      organisationId: context.organisationId,
      territoryId: context.territoryId,
      externalAccountId: "bank",
      externalAccountDisplayName: details.accountName,
      status: "connected",
      grantedScopes: [],
      lastHealthStatus: "healthy",
      connectedByUserId: context.userId,
      connectedAt: new Date(),
      secretRef: null,
      providerSafeMetadata: { ...details }
    });
    await drizzleAuditRecorder(db).record({ action: "integration.connection.configure", actorUserId: context.userId, entityType: "provider_connection", entityId: connection.id, organisationId: context.organisationId, territoryId: context.territoryId, payload: { provider: BANK_PROVIDER, accountName: details.accountName } });
  } finally {
    await sql.end();
  }
}

async function connectionFor(db: Db, provider: string, connectionType: string, target: { issuerOrganisationId: string; territoryId: string }): Promise<ProviderConnection | undefined> {
  const all = await createDrizzleProviderConnectionRepository(db).listConnections({ provider, connectionType, organisationId: target.issuerOrganisationId, territoryId: target.territoryId });
  return all.find((connection) => connection.status === "connected");
}

export type PaymentOptions = { stripe: boolean; gocardless: boolean; bank: BankDetails | null };

/** How an invoice issued by this franchise can be paid, from what the franchise has actually connected. */
export async function paymentOptionsFor(target: { issuerOrganisationId: string; territoryId: string }, db?: Db): Promise<PaymentOptions> {
  const own = db ? { db, sql: null } : createDb();
  try {
    const [stripe, gocardless, bank] = await Promise.all([
      stripeConfigured() ? connectionFor(own.db, "stripe", PAYMENT_CONNECTION_TYPE, target) : undefined,
      goCardlessConfigured() ? connectionFor(own.db, "gocardless", PAYMENT_CONNECTION_TYPE, target) : undefined,
      connectionFor(own.db, BANK_PROVIDER, BANK_CONNECTION_TYPE, target)
    ]);
    const meta = bank?.providerSafeMetadata as Partial<BankDetails> | undefined;
    return { stripe: Boolean(stripe), gocardless: Boolean(gocardless), bank: meta?.accountName && meta.sortCode && meta.accountNumber ? { accountName: meta.accountName, sortCode: meta.sortCode, accountNumber: meta.accountNumber } : null };
  } finally {
    await own.sql?.end();
  }
}

// ---- Creating a payment link ------------------------------------------------------------------

export type CreatedPaymentLink = { requestId: string; provider: PaymentProviderKey; url: string; reused: boolean; invoiceNumber: string; amountMinor: number; currency: string };

type LinkDeps = { fetch?: typeof fetch };

async function createLink(payable: PayableInvoice, provider: PaymentProviderKey, requestedByUserId: string | null, returnPath: string, deps: LinkDeps): Promise<CreatedPaymentLink> {
  // Creating a provider page costs a call out and a row, so it is limited per person.
  if (requestedByUserId && (await firstRateLimitRefusal([{ rule: rateLimitRules.paymentLinkUser, identifier: requestedByUserId }]))) throw new PaymentRateLimitedError();
  const { db, sql } = createDb();
  try {
    const connection = await connectionFor(db, provider, PAYMENT_CONNECTION_TYPE, payable);
    if (!connection || (provider === "stripe" && !stripeConfigured()) || (provider === "gocardless" && !goCardlessConfigured())) throw new PaymentNotAvailableError();

    // One live link per invoice and provider. The row is written first (the partial unique index is the lock), so
    // two simultaneous clicks cannot each create a provider page.
    const requestId = randomUUID();
    const existing = (await db.select().from(invoicePaymentRequests).where(and(eq(invoicePaymentRequests.invoiceId, payable.invoiceId), eq(invoicePaymentRequests.provider, provider), eq(invoicePaymentRequests.status, "open"))))[0];
    if (existing) {
      const stale = existing.amountMinor !== payable.balanceMinor || (existing.expiresAt && existing.expiresAt.getTime() < Date.now() + 3_600_000);
      if (existing.url && !stale) return { requestId: existing.id, provider, url: existing.url, reused: true, invoiceNumber: payable.invoiceNumber, amountMinor: existing.amountMinor, currency: existing.currency };
      await db.update(invoicePaymentRequests).set({ status: "cancelled", failureReason: "Replaced by a newer link." }).where(eq(invoicePaymentRequests.id, existing.id));
      if (provider === "stripe" && existing.url) {
        await expireStripePaymentLink({ config: { secretKey: requiredEnv("STRIPE_SECRET_KEY") }, accountId: connection.externalAccountId, providerRequestId: existing.providerRequestId, fetch: deps.fetch }).catch(() => undefined);
      }
    }
    try {
      await db.insert(invoicePaymentRequests).values({
        id: requestId, invoiceId: payable.invoiceId, issuerOrganisationId: payable.issuerOrganisationId, territoryId: payable.territoryId, provider, providerRequestId: `pending:${requestId}`,
        providerAccountId: connection.externalAccountId, amountMinor: payable.balanceMinor, currency: payable.currency, status: "open", idempotencyKey: `payreq:${requestId}`, requestedByUserId
      });
    } catch (error) {
      // Lost the race: someone else's link is the live one.
      const winner = (await db.select().from(invoicePaymentRequests).where(and(eq(invoicePaymentRequests.invoiceId, payable.invoiceId), eq(invoicePaymentRequests.provider, provider), eq(invoicePaymentRequests.status, "open"))))[0];
      if (winner?.url) return { requestId: winner.id, provider, url: winner.url, reused: true, invoiceNumber: payable.invoiceNumber, amountMinor: winner.amountMinor, currency: winner.currency };
      throw error;
    }

    let link: PaymentLink;
    try {
      const input = { requestId, invoiceNumber: payable.invoiceNumber, amountMinor: payable.balanceMinor, currency: payable.currency, customerEmail: payable.customerEmail, successUrl: `${appUrl()}${returnPath}${returnPath.includes("?") ? "&" : "?"}payment=returned`, cancelUrl: `${appUrl()}${returnPath}${returnPath.includes("?") ? "&" : "?"}payment=cancelled`, idempotencyKey: `payreq:${requestId}` };
      if (provider === "stripe") link = await createStripePaymentLink({ config: { secretKey: requiredEnv("STRIPE_SECRET_KEY") }, accountId: connection.externalAccountId, link: input, fetch: deps.fetch });
      else {
        const token = (JSON.parse(await getConnectionCredential({ connection, secretStore: secretStoreFor(db) })) as { accessToken: string }).accessToken;
        link = await createGoCardlessPaymentLink({ accessToken: token, environment: goCardlessEnvironment(), link: input, fetch: deps.fetch });
      }
    } catch (error) {
      await db.update(invoicePaymentRequests).set({ status: "failed", failureReason: error instanceof Error ? error.message.slice(0, 300) : "Could not create the payment page." }).where(eq(invoicePaymentRequests.id, requestId));
      throw error;
    }

    await db.update(invoicePaymentRequests).set({ providerRequestId: link.providerRequestId, url: link.url, expiresAt: link.expiresAt }).where(eq(invoicePaymentRequests.id, requestId));
    await recordAuditEvent(db, { action: "advertiser.payment.link", actor: requestedByUserId ? { type: "human", userId: requestedByUserId } : { type: "automation", automationId: "payments" }, entity: { type: "advertiser_invoice", id: payable.invoiceId }, scope: { organisationId: payable.issuerOrganisationId, territoryId: payable.territoryId }, after: { provider, amountMinor: payable.balanceMinor, paymentRequestId: requestId } });
    return { requestId, provider, url: link.url, reused: false, invoiceNumber: payable.invoiceNumber, amountMinor: payable.balanceMinor, currency: payable.currency };
  } finally {
    await sql.end();
  }
}

/** Head Office or the franchise creating a link for an invoice in their scope. */
export async function createPaymentLinkAsStaff(context: AdvertisingActorContext, invoiceId: string, provider: PaymentProviderKey, deps: LinkDeps = {}) {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();
  let payable: PayableInvoice;
  try {
    payable = authorisePaymentRequest(context, permissions, await loadAdvertisingData(db), invoiceId);
  } finally {
    await sql.end();
  }
  return createLink(payable, provider, context.userId, "/app/finance/payments", deps);
}

/** An advertiser paying their own invoice. Ownership comes from the session's organisation, never from the request. */
export async function createPaymentLinkAsAdvertiser(context: { userId: string; organisationId: string }, invoiceId: string, provider: PaymentProviderKey, deps: LinkDeps = {}) {
  const permissions = await getPermissionData();
  if (!evaluatePermission({ userId: context.userId, module: "portal.advertiser", action: "view", context: { organisationId: context.organisationId } }, permissions).allowed) throw new PaymentNotAvailableError("Not allowed.");
  const { db, sql } = createDb();
  let payable: PayableInvoice;
  try {
    const data = await loadAdvertisingData(db);
    payable = portalAuthorisePayment(resolvePortalIdentity(data, context), data, invoiceId);
  } finally {
    await sql.end();
  }
  return createLink(payable, provider, context.userId, "/app/portal", deps);
}

/** Emails the billing contact a payment link (and the franchise's bank details, if set). One transactional email, sent now. */
export async function emailPaymentLink(context: AdvertisingActorContext, invoiceId: string, provider: PaymentProviderKey, deps: LinkDeps = {}) {
  const link = await createPaymentLinkAsStaff(context, invoiceId, provider, deps);
  const { db, sql } = createDb();
  try {
    const payable = describePayableInvoice(await loadAdvertisingData(db), invoiceId);
    if (!payable.customerEmail) return { link, emailed: false as const, noContact: true as const };
    const options = await paymentOptionsFor(payable, db);
    const result = await sendPaymentLinkEmail(createEmailProviderFromEnv(), {
      to: payable.customerEmail,
      url: link.url,
      invoiceNumber: payable.invoiceNumber,
      amountText: `${(link.amountMinor / 100).toFixed(2)} ${link.currency}`,
      payeeName: "Your Raring2go! team",
      bank: options.bank,
      from: process.env.EMAIL_FROM,
      idempotencyKey: `paylink:${link.requestId}`
    });
    return { link, emailed: result.status !== "failed", noContact: false as const };
  } finally {
    await sql.end();
  }
}

// ---- Applying a provider's answer -------------------------------------------------------------

export type OutcomeResult = "applied" | "duplicate" | "ignored" | "unmatched" | "needs_review";

/**
 * Believes a provider outcome exactly once. The event claim, the payment, its allocation and the request's new state
 * are one transaction: a failure rolls all of it back and the provider's retry is processed again.
 */
export async function applyPaymentOutcome(provider: PaymentProviderKey, outcome: PaymentOutcome, db?: Db): Promise<OutcomeResult> {
  if (outcome.kind === "ignored") return "ignored";
  const own = db ? { db, sql: null } : createDb();
  try {
    return await own.db.transaction(async (tx) => {
      const scoped = tx as unknown as Db;
      if (!(await claimWebhookEvent(scoped, { providerKey: provider, eventId: outcome.providerEventId, eventType: outcome.kind }))) return "duplicate" as const;

      const match = [outcome.ref.providerRequestId ? eq(invoicePaymentRequests.providerRequestId, outcome.ref.providerRequestId) : undefined, outcome.ref.providerPaymentId ? eq(invoicePaymentRequests.providerPaymentId, outcome.ref.providerPaymentId) : undefined].filter((entry) => entry !== undefined);
      if (match.length === 0) return "unmatched" as const;
      const [request] = await scoped.select().from(invoicePaymentRequests).where(and(eq(invoicePaymentRequests.provider, provider), or(...match))).for("update");
      if (!request) return "unmatched" as const;
      // An event from a different provider account than the one the link was made on is not about this request.
      if (outcome.accountId && request.providerAccountId && outcome.accountId !== request.providerAccountId) {
        appLogger.warn("payment event from an unexpected account was ignored", { provider, requestId: request.id });
        return "ignored" as const;
      }

      const audit = (action: string, after: Record<string, unknown>) =>
        recordAuditEvent(scoped, { action, actor: { type: "automation", automationId: `payments.${provider}` }, entity: { type: "advertiser_invoice", id: request.invoiceId }, scope: { organisationId: request.issuerOrganisationId, territoryId: request.territoryId }, after: { paymentRequestId: request.id, provider, ...after } });

      if (outcome.kind === "expired" || outcome.kind === "failed") {
        if (request.status === "open") {
          await scoped.update(invoicePaymentRequests).set({ status: outcome.kind, failureReason: (outcome.reason ?? (outcome.kind === "expired" ? "The payment page expired." : "The payment did not go through.")).slice(0, 300) }).where(eq(invoicePaymentRequests.id, request.id));
          await audit("advertiser.payment.online_failed", { outcome: outcome.kind });
        }
        return "applied" as const;
      }

      if (outcome.kind === "refunded" || outcome.kind === "disputed") {
        await scoped.update(invoicePaymentRequests).set({ status: outcome.kind, failureReason: (outcome.reason ?? (outcome.kind === "refunded" ? "Refunded by the provider." : "Disputed by the payer.")).slice(0, 300), providerPaymentId: outcome.providerPaymentId ?? request.providerPaymentId }).where(eq(invoicePaymentRequests.id, request.id));
        // Money is never moved automatically: a person raises the credit note (or contests the dispute) from the payments page.
        await audit(`advertiser.payment.online_${outcome.kind}`, { amountMinor: outcome.amountMinor ?? null });
        return "applied" as const;
      }

      // succeeded
      if (request.status === "paid") return "duplicate" as const;
      const amountMinor = outcome.amountMinor ?? request.amountMinor;
      const currency = (outcome.currency ?? request.currency).toUpperCase();
      const paymentKey = outcome.providerPaymentId ?? request.providerPaymentId ?? request.providerRequestId;
      if (currency !== request.currency.toUpperCase() || !Number.isInteger(amountMinor) || amountMinor <= 0) {
        await scoped.update(invoicePaymentRequests).set({ failureReason: "The provider reported an unexpected amount or currency; it needs review." }).where(eq(invoicePaymentRequests.id, request.id));
        await audit("advertiser.payment.online_review", { amountMinor, currency });
        return "needs_review" as const;
      }

      const system = systemAdvertisingIdentity(SYSTEM_USER, `payments.${provider}`);
      const data = await loadAdvertisingData(scoped);
      const before = snapshotAdvertisingData(data);
      const invoice = data.invoices.find((candidate) => candidate.id === request.invoiceId);
      const advertiser = data.advertisers.find((candidate) => candidate.id === invoice?.advertiserId);
      if (!invoice || !advertiser) throw new Error("The invoice for this payment was not found.");
      const auditPort = system.audit(scoped);
      const payment = await recordPayment(system.context, system.permissions, auditPort, data, {
        id: randomUUID(), issuerOrganisationId: invoice.issuerOrganisationId, advertiserId: advertiser.id, payerOrganisationId: advertiser.advertiserOrganisationId,
        amountMinor, allocatedMinor: 0, unallocatedMinor: amountMinor, currency: request.currency, receivedDate: today(), method: "online",
        providerKey: provider, externalReference: paymentKey, providerEventId: paymentKey, status: "received", metadata: { source: provider, paymentRequestId: request.id }
      }, randomUUID());
      // Overpayment or an invoice settled another way meanwhile stays on the payment as unallocated credit for a person to place.
      const allocatable = invoice.status === "issued" || invoice.status === "part_paid" ? Math.min(payment.unallocatedMinor, invoice.balanceMinor) : 0;
      if (allocatable > 0) {
        await allocatePayment(system.context, system.permissions, auditPort, data, { id: randomUUID(), paymentId: payment.id, invoiceId: invoice.id, amountMinor: allocatable, allocatedAt: today(), status: "applied", metadata: { source: provider, paymentRequestId: request.id } }, randomUUID(), { newId: randomUUID });
      }
      await persistAdvertisingChanges(scoped, before, data);
      await scoped.update(invoicePaymentRequests).set({ status: "paid", paidAt: new Date(), providerPaymentId: outcome.providerPaymentId ?? request.providerPaymentId, failureReason: null }).where(eq(invoicePaymentRequests.id, request.id));
      return "applied" as const;
    });
  } finally {
    await own.sql?.end();
  }
}

// ---- Webhooks ---------------------------------------------------------------------------------

export class PaymentWebhookAuthError extends Error {}
export class PaymentWebhookMalformedError extends Error {}
export class PaymentWebhookRetryError extends Error {}

export type WebhookDeps = { secrets?: string[]; fetch?: typeof fetch };

export function stripeWebhookSecrets() {
  return webhookSecrets("STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_PREVIOUS");
}
export function goCardlessWebhookSecrets() {
  return webhookSecrets("GOCARDLESS_WEBHOOK_SECRET", "GOCARDLESS_WEBHOOK_SECRET_PREVIOUS");
}

export async function processStripeWebhook(input: { rawBody: string; signatureHeader: string | null; nowSeconds?: number }, deps: WebhookDeps = {}): Promise<OutcomeResult> {
  if (!verifyStripeSignature({ header: input.signatureHeader, body: input.rawBody, secrets: deps.secrets ?? stripeWebhookSecrets(), nowSeconds: input.nowSeconds })) throw new PaymentWebhookAuthError("Bad signature.");
  let outcome: PaymentOutcome;
  try {
    outcome = parseStripeEvent(JSON.parse(input.rawBody));
  } catch (error) {
    if (error instanceof PaymentProviderError || error instanceof SyntaxError) throw new PaymentWebhookMalformedError("Malformed event.");
    throw error;
  }
  return applyPaymentOutcome("stripe", outcome);
}

export async function processGoCardlessWebhook(input: { rawBody: string; signatureHeader: string | null }, deps: WebhookDeps = {}): Promise<OutcomeResult[]> {
  if (!verifyGoCardlessSignature({ header: input.signatureHeader, body: input.rawBody, secrets: deps.secrets ?? goCardlessWebhookSecrets() })) throw new PaymentWebhookAuthError("Bad signature.");
  let events;
  try {
    events = parseGoCardlessEvents(JSON.parse(input.rawBody));
  } catch (error) {
    if (error instanceof PaymentProviderError || error instanceof SyntaxError) throw new PaymentWebhookMalformedError("Malformed event.");
    throw error;
  }

  const results: OutcomeResult[] = [];
  const { db, sql } = createDb();
  try {
    for (const event of events) {
      // A fulfilled billing request tells us which payment is ours, so the payment events that follow can be matched.
      if (event.resourceType === "billing_requests" && event.action === "fulfilled" && event.links.billing_request) {
        const [request] = await db.select().from(invoicePaymentRequests).where(and(eq(invoicePaymentRequests.provider, "gocardless"), eq(invoicePaymentRequests.providerRequestId, event.links.billing_request)));
        if (request) {
          const connection = await connectionFor(db, "gocardless", PAYMENT_CONNECTION_TYPE, { issuerOrganisationId: request.issuerOrganisationId, territoryId: request.territoryId });
          if (connection) {
            const token = (JSON.parse(await getConnectionCredential({ connection, secretStore: secretStoreFor(db) })) as { accessToken: string }).accessToken;
            const paymentId = await getGoCardlessBillingRequestPayment({ accessToken: token, environment: goCardlessEnvironment(), billingRequestId: request.providerRequestId, fetch: deps.fetch });
            if (paymentId) await db.update(invoicePaymentRequests).set({ providerPaymentId: paymentId }).where(eq(invoicePaymentRequests.id, request.id));
          }
        }
        results.push("applied");
        continue;
      }

      const outcome = outcomeFromGoCardlessEvent(event);
      if (outcome.kind === "succeeded" && outcome.ref.providerPaymentId) {
        const [request] = await db.select().from(invoicePaymentRequests).where(and(eq(invoicePaymentRequests.provider, "gocardless"), eq(invoicePaymentRequests.providerPaymentId, outcome.ref.providerPaymentId)));
        if (!request) {
          // Possibly the payment event beat the "fulfilled" one: ask GoCardless to send it again rather than dropping money.
          const open = await db.select({ id: invoicePaymentRequests.id }).from(invoicePaymentRequests).where(and(eq(invoicePaymentRequests.provider, "gocardless"), inArray(invoicePaymentRequests.status, ["open"]))).limit(1);
          if (open.length > 0) throw new PaymentWebhookRetryError("The payment is not matched to a request yet.");
          results.push("unmatched");
          continue;
        }
        // The amount comes from GoCardless itself, not from anything we were sent.
        const connection = await connectionFor(db, "gocardless", PAYMENT_CONNECTION_TYPE, { issuerOrganisationId: request.issuerOrganisationId, territoryId: request.territoryId });
        if (!connection) throw new PaymentWebhookRetryError("No GoCardless connection for this franchise.");
        const token = (JSON.parse(await getConnectionCredential({ connection, secretStore: secretStoreFor(db) })) as { accessToken: string }).accessToken;
        const payment = await getGoCardlessPayment({ accessToken: token, environment: goCardlessEnvironment(), paymentId: outcome.ref.providerPaymentId, fetch: deps.fetch });
        results.push(await applyPaymentOutcome("gocardless", { ...outcome, amountMinor: payment.amountMinor, currency: payment.currency }, db));
        continue;
      }
      results.push(await applyPaymentOutcome("gocardless", outcome, db));
    }
    return results;
  } finally {
    await sql.end();
  }
}

// ---- Staff overview ---------------------------------------------------------------------------

export async function readPaymentsOverview(context: AdvertisingActorContext) {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();
  try {
    const data = await loadAdvertisingData(db);
    const payable = listPayableInvoices(context, permissions, data);
    const visible = new Set(payable.map((invoice) => invoice.invoiceId));
    const invoiceIds = data.invoices.filter((invoice) => !invoice.deletedAt && (context.territoryId ? invoice.territoryId === context.territoryId : true)).map((invoice) => invoice.id);
    const requests = invoiceIds.length ? await db.select().from(invoicePaymentRequests).where(inArray(invoicePaymentRequests.invoiceId, invoiceIds)).orderBy(desc(invoicePaymentRequests.createdAt)).limit(100) : [];
    const optionsByTarget = new Map<string, PaymentOptions>();
    for (const invoice of payable) {
      const key = `${invoice.issuerOrganisationId}:${invoice.territoryId}`;
      if (!optionsByTarget.has(key)) optionsByTarget.set(key, await paymentOptionsFor(invoice, db));
    }
    const numberOf = new Map(data.invoices.map((invoice) => [invoice.id, invoice.invoiceNumber]));
    const unallocated = data.payments
      .filter((payment) => !payment.deletedAt && payment.unallocatedMinor > 0 && (payment.providerKey === "stripe" || payment.providerKey === "gocardless") && invoiceIds.length >= 0 && data.advertisers.some((advertiser) => advertiser.id === payment.advertiserId && (!context.territoryId || advertiser.owningTerritoryId === context.territoryId)))
      .map((payment) => ({ id: payment.id, provider: payment.providerKey, unallocatedMinor: payment.unallocatedMinor, currency: payment.currency, receivedDate: payment.receivedDate }));
    return {
      invoices: payable.map((invoice) => ({ ...invoice, options: optionsByTarget.get(`${invoice.issuerOrganisationId}:${invoice.territoryId}`)!, open: requests.filter((request) => request.invoiceId === invoice.invoiceId && request.status === "open" && request.url).map((request) => ({ provider: request.provider, url: request.url! })) })),
      requests: requests.map((request) => ({ id: request.id, invoiceNumber: numberOf.get(request.invoiceId) ?? "", provider: request.provider, status: request.status, amountMinor: request.amountMinor, currency: request.currency, failureReason: request.failureReason, createdAt: request.createdAt, visible: visible.has(request.invoiceId) })),
      attention: requests.filter((request) => request.status === "disputed" || request.status === "refunded" || request.failureReason?.includes("needs review")).map((request) => ({ id: request.id, invoiceNumber: numberOf.get(request.invoiceId) ?? "", provider: request.provider, status: request.status, reason: request.failureReason })),
      unallocated
    };
  } finally {
    await sql.end();
  }
}

/** The ways an advertiser can pay each of their invoices, for the portal. Keyed by invoice id. */
export async function readPortalPaymentOptions(context: { userId: string; organisationId: string }) {
  const permissions = await getPermissionData();
  if (!evaluatePermission({ userId: context.userId, module: "portal.advertiser", action: "view", context: { organisationId: context.organisationId } }, permissions).allowed) return {};
  const { db, sql } = createDb();
  try {
    const data = await loadAdvertisingData(db);
    const identity = resolvePortalIdentity(data, context);
    const result: Record<string, PaymentOptions> = {};
    const cache = new Map<string, PaymentOptions>();
    for (const invoice of data.invoices.filter((candidate) => !candidate.deletedAt && identity.advertiserIds.includes(candidate.advertiserId) && (candidate.status === "issued" || candidate.status === "part_paid") && candidate.balanceMinor > 0)) {
      const key = `${invoice.issuerOrganisationId}:${invoice.territoryId}`;
      if (!cache.has(key)) cache.set(key, await paymentOptionsFor({ issuerOrganisationId: invoice.issuerOrganisationId, territoryId: invoice.territoryId }, db));
      result[invoice.id] = cache.get(key)!;
    }
    return result;
  } finally {
    await sql.end();
  }
}

