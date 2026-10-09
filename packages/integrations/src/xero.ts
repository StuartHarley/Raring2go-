import type { AccountingLine, AccountingProvider, AccountingProviderCreditNote, AccountingProviderInvoice, AccountingSyncResult } from "@raring2go/finance";

/**
 * Xero (accounting) integration: OAuth 2.0 and a push-only `AccountingProvider`. Nothing here reads configuration
 * or the database; the caller supplies tokens, the Xero organisation (tenant), the account and tax mapping, and a
 * contact store, so everything is testable with a fake `fetch`.
 */

export type XeroOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string; scopes: string[] };
export type XeroTokenResult = { accessToken: string; refreshToken: string | null; expiresAt: Date | null; safeMetadata: Record<string, unknown> };
export type XeroTenant = { tenantId: string; tenantName: string; tenantType: string };

/** Accounts and tax codes to translate to. Defaults are Xero's standard UK chart; an organisation may differ. */
export type XeroMapping = { salesAccountCode: string; taxTypes: Record<string, string> };
export const defaultXeroMapping: XeroMapping = {
  salesAccountCode: "200",
  taxTypes: { standard_vat: "OUTPUT2", zero_rated: "ZERORATEDOUTPUT", exempt: "EXEMPTOUTPUT" }
};

export const XERO_DEFAULT_SCOPES = ["offline_access", "accounting.transactions", "accounting.contacts", "accounting.settings"];

const IDENTITY = "https://identity.xero.com/connect/token";
const API = "https://api.xero.com/api.xro/2.0";

export function createXeroAuthorizationUrl(input: { config: XeroOAuthConfig; state: string }) {
  const url = new URL("https://login.xero.com/identity/connect/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("scope", input.config.scopes.join(" "));
  url.searchParams.set("state", input.state);
  return url;
}

async function requestXeroToken(config: XeroOAuthConfig, params: Record<string, string>, fetcher: typeof fetch): Promise<XeroTokenResult> {
  const response = await fetcher(IDENTITY, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`
    },
    body: new URLSearchParams(params).toString()
  });
  const payload = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string; error?: string };
  if (!response.ok || !payload.access_token) throw new XeroAuthError(payload.error ? `Xero refused the sign-in (${payload.error}).` : "Xero refused the sign-in.", payload.error === "invalid_grant");
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null,
    safeMetadata: { tokenType: payload.token_type ?? null, scope: payload.scope ?? null }
  };
}

export const exchangeXeroOAuthCode = (input: { config: XeroOAuthConfig; code: string; fetch?: typeof fetch }) =>
  requestXeroToken(input.config, { grant_type: "authorization_code", code: input.code, redirect_uri: input.config.redirectUri }, input.fetch ?? fetch);

/** Xero refresh tokens are single-use: the response carries the next one, which must replace the stored one. */
export async function refreshXeroAccessToken(input: { config: XeroOAuthConfig; refreshToken: string; fetch?: typeof fetch }) {
  const result = await requestXeroToken(input.config, { grant_type: "refresh_token", refresh_token: input.refreshToken }, input.fetch ?? fetch);
  if (!result.refreshToken) throw new XeroAuthError("Xero did not return a new refresh token.", false);
  return result;
}

export async function listXeroTenants(input: { accessToken: string; fetch?: typeof fetch }): Promise<XeroTenant[]> {
  const response = await (input.fetch ?? fetch)("https://api.xero.com/connections", { headers: { authorization: `Bearer ${input.accessToken}`, accept: "application/json" } });
  const payload = (await response.json().catch(() => null)) as Array<{ tenantId?: string; tenantName?: string; tenantType?: string }> | null;
  if (!response.ok || !Array.isArray(payload)) throw new XeroAuthError("Could not list the Xero organisations that were authorised.", false);
  return payload.filter((entry) => entry.tenantId && entry.tenantType === "ORGANISATION").map((entry) => ({ tenantId: entry.tenantId!, tenantName: entry.tenantName ?? "Xero organisation", tenantType: entry.tenantType! }));
}

/** The connection needs a person: the refresh token is no longer accepted, so Xero must be reconnected. */
export class XeroAuthError extends Error {
  constructor(message: string, readonly reconnectRequired: boolean) {
    super(message);
    this.name = "XeroAuthError";
  }
}

/** Worth retrying later: Xero was unavailable or rate limiting us. */
export class XeroTransientError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "XeroTransientError";
  }
}

/** Xero understood and refused the document (validation); retrying the same data will not help. */
export class XeroRejectedError extends Error {
  constructor(message: string, readonly messages: string[] = []) {
    super(message);
    this.name = "XeroRejectedError";
  }
}

export type XeroContactStore = {
  get(customerOrganisationId: string): Promise<string | null>;
  set(customerOrganisationId: string, xeroContactId: string): Promise<void>;
};

export type XeroProviderDeps = {
  tenantId: string;
  mapping: XeroMapping;
  contacts: XeroContactStore;
  getAccessToken: () => Promise<string>;
  /** Called once after a 401 to get a fresh token (and persist the rotated refresh token). */
  refreshAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
};

const major = (minor: number) => Number((minor / 100).toFixed(2));
const day = (value?: string | null) => (value ? value.slice(0, 10) : undefined);
const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

type XeroBody = Record<string, unknown>;

export function createXeroAccountingProvider(deps: XeroProviderDeps): AccountingProvider {
  const fetcher = deps.fetch ?? fetch;

  async function call(method: "GET" | "POST" | "PUT", path: string, options: { body?: XeroBody; idempotencyKey?: string } = {}): Promise<XeroBody> {
    const send = async (token: string) =>
      fetcher(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "xero-tenant-id": deps.tenantId,
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(options.idempotencyKey ? { "idempotency-key": clip(options.idempotencyKey, 128) } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(20_000)
      });

    let response: Response;
    try {
      response = await send(await deps.getAccessToken());
      if (response.status === 401) response = await send(await deps.refreshAccessToken());
    } catch (error) {
      if (error instanceof XeroAuthError || error instanceof XeroTransientError) throw error;
      throw new XeroTransientError(`Could not reach Xero: ${error instanceof Error ? error.message : "network error"}`);
    }

    const payload = (await response.json().catch(() => ({}))) as XeroBody;
    if (response.status === 401 || response.status === 403) throw new XeroAuthError("Xero no longer accepts this connection. Reconnect Xero.", true);
    if (response.status === 429) throw new XeroTransientError("Xero is rate limiting requests.", Number(response.headers.get("retry-after")) || undefined);
    if (response.status >= 500) throw new XeroTransientError(`Xero answered ${response.status}.`);
    if (!response.ok) {
      const messages = validationMessages(payload);
      throw new XeroRejectedError(messages[0] ?? (typeof payload.Message === "string" ? clip(payload.Message, 200) : `Xero refused the request (${response.status}).`), messages);
    }
    return payload;
  }

  /** The Xero contact for an advertiser: remembered, else found by exact name, else created. */
  async function contactFor(customerOrganisationId: string | undefined, customer: { name: string; email?: string | null }): Promise<string> {
    if (customerOrganisationId) {
      const known = await deps.contacts.get(customerOrganisationId);
      if (known) return known;
    }
    const find = async () => {
      const found = (await call("GET", `/Contacts?searchTerm=${encodeURIComponent(customer.name)}`)).Contacts as Array<{ ContactID?: string; Name?: string; ContactStatus?: string }> | undefined;
      return found?.find((contact) => contact.ContactID && contact.Name?.trim().toLowerCase() === customer.name.trim().toLowerCase() && contact.ContactStatus !== "ARCHIVED")?.ContactID;
    };
    let id = await find();
    if (!id) {
      try {
        const created = await call("POST", "/Contacts", { body: { Contacts: [{ Name: customer.name, ...(customer.email ? { EmailAddress: customer.email } : {}) }] } });
        id = (created.Contacts as Array<{ ContactID?: string }> | undefined)?.[0]?.ContactID;
      } catch (error) {
        // Someone created it between our search and our create: use theirs.
        if (error instanceof XeroRejectedError) id = await find();
        if (!id) throw error;
      }
    }
    if (!id) throw new XeroRejectedError("Xero did not return a contact.");
    if (customerOrganisationId) await deps.contacts.set(customerOrganisationId, id);
    return id;
  }

  function lineItems(lines: AccountingLine[]) {
    return lines.map((line) => {
      const taxType = deps.mapping.taxTypes[line.taxCode];
      if (!taxType) throw new XeroRejectedError(`No Xero tax type is mapped for "${line.taxCode}". Set it in the Xero mapping.`);
      // Quantity and unit price only when the line divides evenly: the net amount is what must match exactly.
      const even = line.quantity > 0 && Number.isInteger(line.quantity) && line.netMinor % line.quantity === 0;
      return {
        Description: clip(even || line.quantity === 1 ? line.description : `${line.description} (x${line.quantity})`, 4000),
        Quantity: even ? line.quantity : 1,
        UnitAmount: major(even ? line.netMinor / line.quantity : line.netMinor),
        AccountCode: deps.mapping.salesAccountCode,
        TaxType: taxType,
        TaxAmount: major(line.taxMinor)
      };
    });
  }

  const invoiceIdFrom = (payload: XeroBody, key: "Invoices" | "CreditNotes") => (payload[key] as Array<{ InvoiceID?: string; CreditNoteID?: string; Total?: number }> | undefined)?.[0];

  function assertTotal(actual: number | undefined, expectedMinor: number) {
    if (actual === undefined || Math.round(actual * 100) !== expectedMinor) {
      throw new XeroRejectedError(`Xero calculated a different total (${actual ?? "none"}) from ours (${major(expectedMinor)}). Check the tax mapping.`);
    }
  }

  return {
    async pushInvoice(invoice: AccountingProviderInvoice): Promise<AccountingSyncResult> {
      if (!invoice.customer || !invoice.lines?.length) throw new XeroRejectedError("The invoice has no customer or lines to send.");
      const contactId = await contactFor(invoice.customerOrganisationId, invoice.customer);
      const body = {
        Invoices: [
          {
            Type: "ACCREC",
            Contact: { ContactID: contactId },
            Date: day(invoice.issueDate),
            DueDate: day(invoice.dueDate),
            InvoiceNumber: invoice.invoiceNumber,
            Reference: invoice.invoiceNumber,
            CurrencyCode: invoice.currency,
            LineAmountTypes: "Exclusive",
            Status: "AUTHORISED",
            LineItems: lineItems(invoice.lines)
          }
        ]
      };

      let created: { InvoiceID?: string; Total?: number } | undefined;
      try {
        created = invoiceIdFrom(await call("POST", "/Invoices", { body, idempotencyKey: invoice.idempotencyKey }), "Invoices");
      } catch (error) {
        // Sent before but we never heard back: the number is unique in Xero, so find and confirm that one.
        if (!(error instanceof XeroRejectedError) || !error.messages.some((message) => /unique/i.test(message))) throw error;
        created = invoiceIdFrom(await call("GET", `/Invoices?InvoiceNumbers=${encodeURIComponent(invoice.invoiceNumber)}`), "Invoices");
      }
      if (!created?.InvoiceID) throw new XeroRejectedError("Xero did not return an invoice.");
      assertTotal(created.Total, invoice.totalMinor);
      return { providerKey: "xero", providerEntityId: created.InvoiceID, status: "synced", metadata: { number: invoice.invoiceNumber } };
    },

    async pushCreditNote(credit: AccountingProviderCreditNote): Promise<AccountingSyncResult> {
      if (!credit.customer || !credit.lines?.length) throw new XeroRejectedError("The credit note has no customer or lines to send.");
      // A credit note is applied to its invoice, so the invoice must be in Xero first. Not a failure: just not yet.
      if (!credit.sourceInvoiceProviderId) throw new XeroTransientError("The invoice this credit note applies to has not reached Xero yet.");
      const contactId = await contactFor(credit.customerOrganisationId, credit.customer);
      const body = {
        CreditNotes: [
          {
            Type: "ACCRECCREDIT",
            Contact: { ContactID: contactId },
            Date: day(credit.issuedDate),
            CreditNoteNumber: credit.creditNoteNumber,
            Reference: credit.sourceInvoiceNumber ? `Credit for ${credit.sourceInvoiceNumber}` : credit.creditNoteNumber,
            CurrencyCode: credit.currency,
            LineAmountTypes: "Exclusive",
            Status: "AUTHORISED",
            LineItems: lineItems(credit.lines)
          }
        ]
      };

      let created: { CreditNoteID?: string; Total?: number } | undefined;
      let alreadyThere = false;
      try {
        created = invoiceIdFrom(await call("POST", "/CreditNotes", { body, idempotencyKey: credit.idempotencyKey }), "CreditNotes");
      } catch (error) {
        if (!(error instanceof XeroRejectedError) || !error.messages.some((message) => /unique/i.test(message))) throw error;
        created = invoiceIdFrom(await call("GET", `/CreditNotes?where=${encodeURIComponent(`CreditNoteNumber=="${credit.creditNoteNumber.replace(/"/g, "")}"`)}`), "CreditNotes");
        alreadyThere = true;
      }
      const creditId = created?.CreditNoteID;
      if (!creditId) throw new XeroRejectedError("Xero did not return a credit note.");
      assertTotal(created?.Total, credit.totalMinor);
      if (!alreadyThere) {
        await call("PUT", `/CreditNotes/${creditId}/Allocations`, {
          body: { Allocations: [{ Amount: major(credit.totalMinor), Date: day(credit.issuedDate), Invoice: { InvoiceID: credit.sourceInvoiceProviderId } }] },
          idempotencyKey: credit.idempotencyKey ? `${credit.idempotencyKey}:allocate` : undefined
        });
      }
      return { providerKey: "xero", providerEntityId: creditId, status: "synced", metadata: { number: credit.creditNoteNumber } };
    }
  };
}

function validationMessages(payload: XeroBody): string[] {
  const out: string[] = [];
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const entry of value as Array<{ ValidationErrors?: Array<{ Message?: string }>; Elements?: unknown }>) {
      for (const error of entry.ValidationErrors ?? []) if (error.Message) out.push(clip(error.Message, 200));
      collect(entry.Elements);
    }
  };
  collect(payload.Elements);
  for (const key of ["Invoices", "CreditNotes", "Contacts"]) collect(payload[key]);
  if (typeof payload.Message === "string") out.push(clip(payload.Message, 200));
  return out;
}
