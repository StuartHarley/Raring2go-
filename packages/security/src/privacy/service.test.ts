import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it } from "vitest";
import { createPrivacyRequest, decideErasure, emailHash, generateSubjectExport, listPrivacyRequests, PrivacyAccessError, PrivacyInputError, PrivacyStateError } from "./service";
import type { DataCounts, NewPrivacyRequest, PrivacyRequestRecord, PrivacyStore, SubjectDataBundle } from "./types";

const grant = (action: string) => ({ roleId: "hq", permission: { id: `p-${action}`, module: "privacy.request", action }, scope: "network", constraints: {} });
const permissions: PermissionData = {
  roleAssignments: [
    { id: "a1", userId: "alice", roleId: "hq", organisationId: "org" },
    { id: "a2", userId: "bob", roleId: "hq", organisationId: "org" },
    { id: "a3", userId: "terri", roleId: "franchise", organisationId: "org2", territoryId: "t1" }
  ],
  rolePermissions: [grant("view"), grant("create"), grant("decide"), grant("export"), { roleId: "franchise", permission: { id: "px", module: "privacy.request", action: "view" }, scope: "own_territory", constraints: {} }]
};

const alice = { userId: "alice" };
const bob = { userId: "bob" };
const now = new Date("2026-10-08T10:00:00Z");

function fakeStore(contacts: Record<string, string> = { "sam@example.com": "contact-1" }) {
  const requests: PrivacyRequestRecord[] = [];
  const erased: string[] = [];
  const bundle = (contactId: string): SubjectDataBundle => ({
    generatedAt: now.toISOString(), subject: { contactId }, contact: { id: contactId }, subscriptions: [{}, {}], preferences: null, consentEvents: [{}], suppressions: [], savedContent: [], activity: [{}, {}, {}], segmentMemberships: [], emailDeliveries: []
  });
  const store: PrivacyStore = {
    findContactByEmail: async (email) => (contacts[email] ? { id: contacts[email]! } : undefined),
    findOpenRequest: async (kind, hash) => requests.find((r) => r.kind === kind && r.subjectEmailHash === hash && r.status === "requested"),
    insertRequest: async (input: NewPrivacyRequest) => {
      const record: PrivacyRequestRecord = { id: `req-${requests.length + 1}`, status: "requested", decidedByUserId: null, decidedAt: null, decisionNote: null, completedAt: null, resultSummary: {}, createdAt: now, ...input };
      requests.push(record);
      return record;
    },
    getRequest: async (id) => requests.find((r) => r.id === id),
    listRequests: async () => requests,
    gatherSubjectData: async (contactId) => bundle(contactId),
    settleRequest: async (id, input, at) => {
      const record = requests.find((r) => r.id === id);
      if (!record || record.status !== "requested") return undefined;
      Object.assign(record, { status: input.status, decidedByUserId: input.decidedByUserId, decisionNote: input.decisionNote, decidedAt: at, completedAt: input.status === "completed" ? at : null, resultSummary: input.resultSummary });
      return record;
    },
    eraseContact: async (contactId): Promise<DataCounts> => {
      erased.push(contactId);
      return { contact: 1 };
    }
  };
  const events: Array<{ action: string; metadata?: unknown }> = [];
  const audit = { record: async (input: { action: string; metadata?: unknown }) => void events.push(input) };
  return { store, requests, erased, events, audit };
}

describe("privacy requests", () => {
  it("is restricted to network-level privacy grants, not territory ones", async () => {
    const { store, audit } = fakeStore();
    await expect(createPrivacyRequest({ userId: "terri", territoryId: "t1" }, permissions, audit, store, { kind: "export", email: "sam@example.com" })).rejects.toBeInstanceOf(PrivacyAccessError);
    await expect(listPrivacyRequests({ userId: "terri", territoryId: "t1" }, permissions, store)).rejects.toBeInstanceOf(PrivacyAccessError);
    await expect(createPrivacyRequest({ userId: "nobody" }, permissions, audit, store, { kind: "export", email: "sam@example.com" })).rejects.toBeInstanceOf(PrivacyAccessError);
  });

  it("validates the email and the request type", async () => {
    const { store, audit } = fakeStore();
    await expect(createPrivacyRequest(alice, permissions, audit, store, { kind: "export", email: "not-an-email" })).rejects.toBeInstanceOf(PrivacyInputError);
    await expect(createPrivacyRequest(alice, permissions, audit, store, { kind: "delete" as never, email: "sam@example.com" })).rejects.toBeInstanceOf(PrivacyInputError);
  });

  it("sets the one-month deadline, normalises the email, and keeps the address out of the audit trail", async () => {
    const { store, events, audit } = fakeStore();
    const { request, created } = await createPrivacyRequest(alice, permissions, audit, store, { kind: "erasure", email: "  Sam@Example.COM " }, now);
    expect(created).toBe(true);
    expect(request.dueAt.toISOString()).toBe("2026-11-07T10:00:00.000Z");
    expect(request.subjectContactId).toBe("contact-1");
    expect(request.subjectEmailHash).toBe(emailHash("sam@example.com"));
    expect(JSON.stringify(events)).not.toContain("example.com");
    expect(events[0]!.action).toBe("privacy.request.create");
  });

  it("returns the existing open request instead of creating a duplicate", async () => {
    const { store, requests, audit } = fakeStore();
    const first = await createPrivacyRequest(alice, permissions, audit, store, { kind: "erasure", email: "sam@example.com" }, now);
    const second = await createPrivacyRequest(bob, permissions, audit, store, { kind: "erasure", email: "SAM@example.com" }, now);
    expect(second.created).toBe(false);
    expect(second.request.id).toBe(first.request.id);
    expect(requests).toHaveLength(1);
    // A different kind is a different request.
    expect((await createPrivacyRequest(alice, permissions, audit, store, { kind: "export", email: "sam@example.com" }, now)).created).toBe(true);
  });

  it("answers immediately and truthfully when no data is held", async () => {
    const { store, audit } = fakeStore({});
    const { request } = await createPrivacyRequest(alice, permissions, audit, store, { kind: "erasure", email: "ghost@example.com" }, now);
    expect(request).toMatchObject({ status: "completed", subjectContactId: null, resultSummary: { dataHeld: false } });
  });
});

describe("erasure approval (four eyes)", () => {
  async function pending() {
    const ctx = fakeStore();
    const { request } = await createPrivacyRequest(alice, permissions, ctx.audit, ctx.store, { kind: "erasure", email: "sam@example.com" }, now);
    return { ...ctx, request };
  }

  it("refuses to let the requester approve or reject their own request", async () => {
    const { store, audit, request, erased } = await pending();
    await expect(decideErasure(alice, permissions, audit, store, request.id, "approve", null, now)).rejects.toThrow(/different person/);
    await expect(decideErasure(alice, permissions, audit, store, request.id, "reject", null, now)).rejects.toThrow(/different person/);
    expect(erased).toEqual([]);
  });

  it("erases only when a different, authorised person approves, and records what was erased", async () => {
    const { store, audit, request, erased, events } = await pending();
    await expect(decideErasure({ userId: "terri", territoryId: "t1" }, permissions, audit, store, request.id, "approve", null, now)).rejects.toBeInstanceOf(PrivacyAccessError);
    const done = await decideErasure(bob, permissions, audit, store, request.id, "approve", "Verified identity by email", now);
    expect(erased).toEqual(["contact-1"]);
    expect(done).toMatchObject({ status: "completed", decidedByUserId: "bob", resultSummary: { erased: { contact: 1 } } });
    expect(events.at(-1)!.action).toBe("privacy.erasure.approve");
  });

  it("does nothing on rejection, and cannot be decided twice", async () => {
    const { store, audit, request, erased } = await pending();
    expect(await decideErasure(bob, permissions, audit, store, request.id, "reject", "Could not verify", now)).toMatchObject({ status: "rejected" });
    expect(erased).toEqual([]);
    await expect(decideErasure(bob, permissions, audit, store, request.id, "approve", null, now)).rejects.toBeInstanceOf(PrivacyStateError);
  });

  it("only applies decisions to erasure requests", async () => {
    const ctx = fakeStore();
    const { request } = await createPrivacyRequest(alice, permissions, ctx.audit, ctx.store, { kind: "export", email: "sam@example.com" }, now);
    await expect(decideErasure(bob, permissions, ctx.audit, ctx.store, request.id, "approve", null, now)).rejects.toThrow(/Only an erasure/);
  });
});

describe("subject export", () => {
  it("returns the subject's data, completes the request and audits counts only", async () => {
    const { store, audit, events } = fakeStore();
    const { request } = await createPrivacyRequest(alice, permissions, audit, store, { kind: "export", email: "sam@example.com" }, now);
    const result = await generateSubjectExport(alice, permissions, audit, store, request.id, now);
    expect(result.bundle.subject.contactId).toBe("contact-1");
    expect(result.request.status).toBe("completed");
    expect(events.at(-1)).toMatchObject({ action: "privacy.export.generate", metadata: { counts: { subscriptions: 2, activity: 3, consentEvents: 1 } } });
    expect(JSON.stringify(events)).not.toContain("example.com");
    // Read-only, so it can be generated again.
    await expect(generateSubjectExport(alice, permissions, audit, store, request.id, now)).resolves.toBeDefined();
  });

  it("requires the export grant, an export request, and a subject we hold data for", async () => {
    const ctx = fakeStore({});
    await expect(generateSubjectExport({ userId: "terri" }, permissions, ctx.audit, ctx.store, "x", now)).rejects.toBeInstanceOf(PrivacyAccessError);
    const { request } = await createPrivacyRequest(alice, permissions, ctx.audit, ctx.store, { kind: "export", email: "ghost@example.com" }, now);
    await expect(generateSubjectExport(alice, permissions, ctx.audit, ctx.store, request.id, now)).rejects.toThrow(/nothing to export/);
    const withData = fakeStore();
    const erasure = (await createPrivacyRequest(alice, permissions, withData.audit, withData.store, { kind: "erasure", email: "sam@example.com" }, now)).request;
    await expect(generateSubjectExport(alice, permissions, withData.audit, withData.store, erasure.id, now)).rejects.toThrow(/data-access request/);
  });
});
