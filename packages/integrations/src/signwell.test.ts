import { describe, expect, it } from "vitest";
import {
  SignWellError, cancelSignWellDocument, createSignWellDocument, createSignWellWebhook, getSignWellCompletedPdfUrl, getSignWellDocument, parseSignWellEvent, remindSignWellDocument, signSignWellEvent, verifySignWellHash
} from "./signwell";

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
function fake(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const call: Call = { url: String(url), method: init?.method ?? "GET", headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("SignWell client", () => {
  const base = { apiKey: "key", testMode: true, name: "Franchise Agreement", subject: "Sign", message: "Please sign", pdf: { name: "agreement.pdf", base64: "JVBERi0=" }, recipients: [{ id: "1", name: "Fran Chisee", email: "fran@example.test" }, { id: "2", name: "Head Office", email: "ho@example.test" }], metadata: { agreement_id: "ag-1" }, expiresInDays: 30 };

  it("creates a document with an ordered signature page, the right recipients, test mode and our reference", async () => {
    const { calls, fetchImpl } = fake(() => json({ id: "doc-1", status: "Created", recipients: [{ id: "1", email: "fran@example.test", name: "Fran Chisee", status: "created" }] }, 201));
    const document = await createSignWellDocument({ ...base, fetch: fetchImpl });
    expect(document).toMatchObject({ id: "doc-1", status: "Created", recipients: [{ signingUrl: null }] });
    expect(calls[0]!.url).toBe("https://www.signwell.com/api/v1/documents");
    expect(calls[0]!.headers["x-api-key"]).toBe("key");
    expect(calls[0]!.body).toMatchObject({ test_mode: true, with_signature_page: true, apply_signing_order: true, allow_reassign: false, draft: false, expires_in: 30, metadata: { agreement_id: "ag-1" }, files: [{ name: "agreement.pdf", file_base64: "JVBERi0=" }] });
    expect(calls[0]!.body.recipients).toEqual([{ id: "1", name: "Fran Chisee", email: "fran@example.test" }, { id: "2", name: "Head Office", email: "ho@example.test" }]);
  });

  it("refuses a document with no signers, treats 429/5xx/network as transient and 422 as a refusal", async () => {
    await expect(createSignWellDocument({ ...base, recipients: [], fetch: fake(() => json({})).fetchImpl })).rejects.toMatchObject({ transient: false });
    await expect(createSignWellDocument({ ...base, fetch: fake(() => json({}, 429)).fetchImpl })).rejects.toMatchObject({ transient: true });
    await expect(createSignWellDocument({ ...base, fetch: fake(() => json({}, 503)).fetchImpl })).rejects.toMatchObject({ transient: true });
    await expect(createSignWellDocument({ ...base, fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch })).rejects.toMatchObject({ transient: true });
    await expect(createSignWellDocument({ ...base, fetch: fake(() => json({ errors: { recipients: ["invalid"] } }, 422)).fetchImpl })).rejects.toMatchObject({ transient: false, status: 422 });
  });

  it("reads a document, reminds, cancels (a missing document counts as cancelled), and fetches completed PDF addresses with and without the audit page", async () => {
    const { calls, fetchImpl } = fake((call) => {
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      if (call.url.includes("completed_pdf")) return json({ file_url: "https://www.signwell.com/signed/x.pdf" });
      if (call.url.endsWith("/remind")) return json({ id: "doc-1" }, 201);
      return json({ id: "doc-1", status: "Completed", metadata: { agreement_id: "ag-1" }, recipients: [{ id: "1", email: "a@b.test", name: "A", status: "completed" }] });
    });
    await expect(getSignWellDocument({ apiKey: "k", documentId: "doc-1", fetch: fetchImpl })).resolves.toMatchObject({ status: "Completed", metadata: { agreement_id: "ag-1" }, recipients: [{ email: "a@b.test" }] });
    await remindSignWellDocument({ apiKey: "k", documentId: "doc-1", fetch: fetchImpl });
    await cancelSignWellDocument({ apiKey: "k", documentId: "doc-1", fetch: fetchImpl });
    await expect(getSignWellCompletedPdfUrl({ apiKey: "k", documentId: "doc-1", auditPage: false, fetch: fetchImpl })).resolves.toBe("https://www.signwell.com/signed/x.pdf");
    expect(calls.some((call) => call.url.endsWith("completed_pdf?url_only=true&audit_page=false"))).toBe(true);
    await getSignWellCompletedPdfUrl({ apiKey: "k", documentId: "doc-1", auditPage: true, fetch: fetchImpl });
    expect(calls.at(-1)!.url).toContain("audit_page=true");
    await expect(cancelSignWellDocument({ apiKey: "k", documentId: "gone", fetch: fake(() => json({ error: "record_not_found" }, 404)).fetchImpl })).resolves.toBeUndefined();
    await expect(getSignWellCompletedPdfUrl({ apiKey: "k", documentId: "d", auditPage: false, fetch: fake(() => json({})).fetchImpl })).rejects.toBeInstanceOf(SignWellError);
    await expect(createSignWellWebhook({ apiKey: "k", callbackUrl: "https://app.example.test/api/integrations/signwell/webhook", fetch: fake(() => json({ id: "hook-1" }, 201)).fetchImpl })).resolves.toEqual({ id: "hook-1" });
  });
});

describe("SignWell webhook events", () => {
  const event = (type: string, extra: Record<string, unknown> = {}, time = "1800000000", id = "doc-1", hook = "hook-1") => ({ event: { type, time, hash: signSignWellEvent(hook, type, time), ...extra }, data: { object: { id } } });

  it("verifies the hash of type and time with the webhook id, and refuses a changed type or time, another id, and no secret", () => {
    const e = parseSignWellEvent(event("document_completed"));
    expect(verifySignWellHash({ type: e.type, time: e.time, hash: e.hash, webhookIds: ["hook-1"] })).toBe(true);
    expect(verifySignWellHash({ type: e.type, time: e.time, hash: e.hash, webhookIds: ["old", "hook-1"] })).toBe(true);
    expect(verifySignWellHash({ type: "document_signed", time: e.time, hash: e.hash, webhookIds: ["hook-1"] })).toBe(false);
    expect(verifySignWellHash({ type: e.type, time: "1800000001", hash: e.hash, webhookIds: ["hook-1"] })).toBe(false);
    expect(verifySignWellHash({ type: e.type, time: e.time, hash: e.hash, webhookIds: ["other"] })).toBe(false);
    expect(verifySignWellHash({ type: e.type, time: e.time, hash: e.hash, webhookIds: [] })).toBe(false);
    expect(verifySignWellHash({ type: e.type, time: e.time, hash: "", webhookIds: ["hook-1"] })).toBe(false);
  });

  it("classifies the events we act on and ignores the rest, and reads the signer and document", () => {
    const kinds = Object.fromEntries(["document_signed", "document_completed", "document_declined", "document_expired", "document_canceled", "document_viewed", "document_sent"].map((type) => [type, parseSignWellEvent(event(type)).kind]));
    expect(kinds).toEqual({ document_signed: "signer_completed", document_completed: "completed", document_declined: "declined", document_expired: "expired", document_canceled: "cancelled", document_viewed: "ignored", document_sent: "ignored" });
    expect(parseSignWellEvent(event("document_signed", { related_signer: { email: "fran@example.test" } }))).toMatchObject({ documentId: "doc-1", relatedSignerEmail: "fran@example.test" });
    expect(() => parseSignWellEvent({ nope: 1 })).toThrow(SignWellError);
    expect(() => parseSignWellEvent({ event: { type: "document_completed", time: "1", hash: "h" }, data: { object: {} } })).toThrow(SignWellError);
  });
});
