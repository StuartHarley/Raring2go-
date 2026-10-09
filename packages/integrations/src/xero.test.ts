import { describe, expect, it } from "vitest";
import {
  XeroAuthError, XeroRejectedError, XeroTransientError, createXeroAccountingProvider, createXeroAuthorizationUrl, defaultXeroMapping, exchangeXeroOAuthCode, listXeroTenants, refreshXeroAccessToken
} from "./xero";
import type { XeroContactStore } from "./xero";

const config = { clientId: "cid", clientSecret: "secret", redirectUri: "https://app.example.test/api/integrations/xero/callback", scopes: ["offline_access", "accounting.transactions"] };
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

type Call = { method: string; url: string; headers: Record<string, string>; body: any };
function fakeXero(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? "GET", url: String(url), headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), body: init?.body ? (String(init.body).startsWith("{") ? JSON.parse(String(init.body)) : String(init.body)) : undefined };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("Xero OAuth", () => {
  it("builds the authorisation URL with state and scopes", () => {
    const url = createXeroAuthorizationUrl({ config, state: "st" });
    expect(url.origin + url.pathname).toBe("https://login.xero.com/identity/connect/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: "code", client_id: "cid", state: "st", scope: "offline_access accounting.transactions", redirect_uri: config.redirectUri });
  });

  it("exchanges a code with basic client authentication and refuses a failed exchange", async () => {
    const { calls, fetchImpl } = fakeXero(() => json({ access_token: "a", refresh_token: "r", expires_in: 1800, scope: "x" }));
    const token = await exchangeXeroOAuthCode({ config, code: "code", fetch: fetchImpl });
    expect(token).toMatchObject({ accessToken: "a", refreshToken: "r" });
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from("cid:secret").toString("base64")}`);
    await expect(exchangeXeroOAuthCode({ config, code: "bad", fetch: fakeXero(() => json({ error: "invalid_grant" }, { status: 400 })).fetchImpl })).rejects.toMatchObject({ reconnectRequired: true });
  });

  it("requires the rotated refresh token on refresh, and lists only organisations", async () => {
    await expect(refreshXeroAccessToken({ config, refreshToken: "old", fetch: fakeXero(() => json({ access_token: "a2", expires_in: 1800 })).fetchImpl })).rejects.toBeInstanceOf(XeroAuthError);
    const refreshed = await refreshXeroAccessToken({ config, refreshToken: "old", fetch: fakeXero(() => json({ access_token: "a2", refresh_token: "r2", expires_in: 1800 })).fetchImpl });
    expect(refreshed.refreshToken).toBe("r2");
    const tenants = await listXeroTenants({ accessToken: "a", fetch: fakeXero(() => json([{ tenantId: "t1", tenantName: "Sutton Ltd", tenantType: "ORGANISATION" }, { tenantId: "t2", tenantType: "PRACTICE" }])).fetchImpl });
    expect(tenants).toEqual([{ tenantId: "t1", tenantName: "Sutton Ltd", tenantType: "ORGANISATION" }]);
  });
});

describe("Xero accounting provider", () => {
  const memory = (): XeroContactStore & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, get: async (id) => map.get(id) ?? null, set: async (id, value) => void map.set(id, value) };
  };
  const invoice = {
    id: "inv-1", invoiceNumber: "R2G-0001", issuerOrganisationId: "iss", customerOrganisationId: "cust-1", totalMinor: 63000, subtotalMinor: 52500, taxMinor: 10500, currency: "GBP", issueDate: "2026-10-09", dueDate: "2026-11-08",
    idempotencyKey: "invoice:inv-1", customer: { name: "Example Advertiser", email: "ads@example.test" },
    lines: [{ description: "Full page advert", quantity: 1, netMinor: 52500, taxMinor: 10500, taxCode: "standard_vat" }]
  };
  const make = (handler: Parameters<typeof fakeXero>[0], overrides: Partial<Parameters<typeof createXeroAccountingProvider>[0]> = {}) => {
    const xero = fakeXero(handler);
    const contacts = memory();
    let tokens = 0;
    const provider = createXeroAccountingProvider({
      tenantId: "tenant-1", mapping: defaultXeroMapping, contacts, fetch: xero.fetchImpl,
      getAccessToken: async () => "token-1", refreshAccessToken: async () => `token-refreshed-${++tokens}`, ...overrides
    });
    return { provider, contacts, ...xero };
  };
  const route = (call: Call) => `${call.method} ${new URL(call.url).pathname.replace("/api.xro/2.0", "")}`;

  it("finds or creates the contact, then sends the invoice with matching amounts, tax and idempotency", async () => {
    const { provider, calls, contacts } = make((call) => {
      if (call.method === "GET") return json({ Contacts: [{ ContactID: "other", Name: "Example Advertiser Ltd" }] });
      if (route(call) === "POST /Contacts") return json({ Contacts: [{ ContactID: "c-1" }] });
      return json({ Invoices: [{ InvoiceID: "x-inv-1", Total: 630 }] });
    });
    const result = await provider.pushInvoice(invoice);
    expect(result).toMatchObject({ providerKey: "xero", providerEntityId: "x-inv-1", status: "synced" });
    expect(contacts.map.get("cust-1")).toBe("c-1");
    expect(calls.map(route)).toEqual(["GET /Contacts", "POST /Contacts", "POST /Invoices"]);

    const send = calls.at(-1)!;
    expect(send.headers).toMatchObject({ authorization: "Bearer token-1", "xero-tenant-id": "tenant-1", "idempotency-key": "invoice:inv-1" });
    expect(send.body.Invoices[0]).toMatchObject({ Type: "ACCREC", Contact: { ContactID: "c-1" }, InvoiceNumber: "R2G-0001", Date: "2026-10-09", DueDate: "2026-11-08", CurrencyCode: "GBP", LineAmountTypes: "Exclusive", Status: "AUTHORISED" });
    expect(send.body.Invoices[0].LineItems).toEqual([{ Description: "Full page advert", Quantity: 1, UnitAmount: 525, AccountCode: "200", TaxType: "OUTPUT2", TaxAmount: 105 }]);
  });

  it("reuses a remembered contact without searching", async () => {
    const { provider, calls, contacts } = make(() => json({ Invoices: [{ InvoiceID: "x", Total: 630 }] }));
    contacts.map.set("cust-1", "known");
    await provider.pushInvoice(invoice);
    expect(calls.map(route)).toEqual(["POST /Invoices"]);
    expect(calls[0]!.body.Invoices[0].Contact.ContactID).toBe("known");
  });

  it("uses an exact-name match (not a similar name), and recovers when the contact was created in between", async () => {
    let searches = 0;
    const { provider } = make((call) => {
      if (call.method === "GET") return json({ Contacts: searches++ === 0 ? [] : [{ ContactID: "theirs", Name: "example advertiser", ContactStatus: "ACTIVE" }] });
      if (route(call) === "POST /Contacts") return json({ Elements: [{ ValidationErrors: [{ Message: "The contact name Example Advertiser is already assigned to another contact." }] }] }, { status: 400 });
      return json({ Invoices: [{ InvoiceID: "x", Total: 630 }] });
    });
    await expect(provider.pushInvoice(invoice)).resolves.toMatchObject({ status: "synced" });
  });

  it("never reports success when Xero's total differs from ours", async () => {
    const { provider } = make((call) => (call.method === "GET" ? json({ Contacts: [{ ContactID: "c", Name: "Example Advertiser" }] }) : json({ Invoices: [{ InvoiceID: "x", Total: 629.99 }] })));
    await expect(provider.pushInvoice(invoice)).rejects.toThrow(/different total/);
  });

  it("refuses an unmapped tax code before calling Xero for the invoice", async () => {
    const { provider, calls } = make(() => json({ Contacts: [{ ContactID: "c", Name: "Example Advertiser" }] }));
    await expect(provider.pushInvoice({ ...invoice, lines: [{ ...invoice.lines[0]!, taxCode: "reduced_5" }] })).rejects.toThrow(/No Xero tax type is mapped for "reduced_5"/);
    expect(calls.some((call) => route(call) === "POST /Invoices")).toBe(false);
  });

  it("keeps the net exact when a quantity does not divide evenly", async () => {
    const { provider, calls } = make((call) => (call.method === "GET" ? json({ Contacts: [{ ContactID: "c", Name: "Example Advertiser" }] }) : json({ Invoices: [{ InvoiceID: "x", Total: 1.2 }] })));
    await provider.pushInvoice({ ...invoice, totalMinor: 120, lines: [{ description: "Leaflets", quantity: 3, netMinor: 100, taxMinor: 20, taxCode: "standard_vat" }] });
    expect(calls.at(-1)!.body.Invoices[0].LineItems[0]).toMatchObject({ Description: "Leaflets (x3)", Quantity: 1, UnitAmount: 1, TaxAmount: 0.2 });
  });

  it("confirms an invoice it already sent instead of failing on the duplicate number", async () => {
    const { provider, calls } = make((call) => {
      if (route(call) === "GET /Contacts") return json({ Contacts: [{ ContactID: "c", Name: "Example Advertiser" }] });
      if (route(call) === "POST /Invoices") return json({ Elements: [{ ValidationErrors: [{ Message: "Invoice # must be unique." }] }] }, { status: 400 });
      return json({ Invoices: [{ InvoiceID: "x-existing", Total: 630 }] });
    });
    await expect(provider.pushInvoice(invoice)).resolves.toMatchObject({ providerEntityId: "x-existing", status: "synced" });
    expect(calls.at(-1)!.url).toContain("InvoiceNumbers=R2G-0001");
  });

  it("refreshes the token once on a 401, and asks for a reconnect if Xero still refuses", async () => {
    let attempts = 0;
    const ok = make((call) => {
      if (call.method === "GET") return json({ Contacts: [{ ContactID: "c", Name: "Example Advertiser" }] });
      return call.headers.authorization === "Bearer token-1" && attempts++ === 0 ? json({}, { status: 401 }) : json({ Invoices: [{ InvoiceID: "x", Total: 630 }] });
    });
    await expect(ok.provider.pushInvoice(invoice)).resolves.toMatchObject({ status: "synced" });
    expect(ok.calls.at(-1)!.headers.authorization).toBe("Bearer token-refreshed-1");

    const refused = make(() => json({}, { status: 401 }));
    await expect(refused.provider.pushInvoice(invoice)).rejects.toMatchObject({ name: "XeroAuthError", reconnectRequired: true });
  });

  it("treats rate limits, outages and network failures as transient, and validation errors as rejection", async () => {
    await expect(make(() => json({}, { status: 429, headers: { "retry-after": "30" } })).provider.pushInvoice(invoice)).rejects.toMatchObject({ name: "XeroTransientError", retryAfterSeconds: 30 });
    await expect(make(() => json({}, { status: 503 })).provider.pushInvoice(invoice)).rejects.toBeInstanceOf(XeroTransientError);
    await expect(make(() => { throw new TypeError("fetch failed"); }).provider.pushInvoice(invoice)).rejects.toBeInstanceOf(XeroTransientError);
    const rejected = make((call) => (call.method === "GET" ? json({ Contacts: [{ ContactID: "c", Name: "Example Advertiser" }] }) : json({ Elements: [{ ValidationErrors: [{ Message: "Account code '200' is not a valid code." }] }] }, { status: 400 })));
    await expect(rejected.provider.pushInvoice(invoice)).rejects.toThrow(XeroRejectedError);
  });

  const credit = {
    id: "cr-1", creditNoteNumber: "R2G-CR-0001", sourceInvoiceId: "inv-1", sourceInvoiceNumber: "R2G-0001", sourceInvoiceProviderId: "x-inv-1", totalMinor: 12600, currency: "GBP", issuedDate: "2026-10-10",
    idempotencyKey: "credit:cr-1", customerOrganisationId: "cust-1", customer: { name: "Example Advertiser" },
    lines: [{ description: "Goodwill credit", quantity: 1, netMinor: 10500, taxMinor: 2100, taxCode: "standard_vat" }]
  };

  it("sends a credit note and applies it to the invoice, once", async () => {
    const { provider, calls } = make((call) => {
      if (route(call) === "POST /CreditNotes") return json({ CreditNotes: [{ CreditNoteID: "x-cr-1", Total: 126 }] });
      if (call.method === "PUT") return json({});
      return json({ Contacts: [{ ContactID: "c", Name: "Example Advertiser" }] });
    });
    await expect(provider.pushCreditNote(credit)).resolves.toMatchObject({ providerEntityId: "x-cr-1", status: "synced" });
    const allocation = calls.find((call) => call.method === "PUT")!;
    expect(new URL(allocation.url).pathname).toContain("/CreditNotes/x-cr-1/Allocations");
    expect(allocation.body.Allocations[0]).toMatchObject({ Amount: 126, Invoice: { InvoiceID: "x-inv-1" } });
    expect(allocation.headers["idempotency-key"]).toBe("credit:cr-1:allocate");
  });

  it("waits (transient) until the invoice it credits has reached Xero, and does not re-apply an existing credit note", async () => {
    await expect(make(() => json({})).provider.pushCreditNote({ ...credit, sourceInvoiceProviderId: null })).rejects.toBeInstanceOf(XeroTransientError);

    const { provider, calls } = make((call) => {
      if (route(call) === "POST /CreditNotes") return json({ Elements: [{ ValidationErrors: [{ Message: "Credit note number must be unique." }] }] }, { status: 400 });
      if (route(call) === "GET /CreditNotes") return json({ CreditNotes: [{ CreditNoteID: "x-cr-existing", Total: 126 }] });
      return json({ Contacts: [{ ContactID: "c", Name: "Example Advertiser" }] });
    });
    await expect(provider.pushCreditNote(credit)).resolves.toMatchObject({ providerEntityId: "x-cr-existing" });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });
});
