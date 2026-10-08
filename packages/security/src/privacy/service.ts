import { createHash } from "node:crypto";
import { auditActions } from "@raring2go/audit";
import type { RecordAuditEventInput } from "@raring2go/audit";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import type { DataCounts, PrivacyRequestKind, PrivacyRequestRecord, PrivacyStore, SubjectDataBundle } from "./types";

export const privacyCapabilities = {
  view: { module: "privacy.request", action: "view" },
  create: { module: "privacy.request", action: "create" },
  decide: { module: "privacy.request", action: "decide" },
  export: { module: "privacy.request", action: "export" }
} as const;

export type PrivacyActorContext = { userId: string; organisationId?: string | null; territoryId?: string | null };
export type PrivacyAuditRecorder = { record: (input: RecordAuditEventInput) => Promise<unknown> };

export class PrivacyAccessError extends Error {
  constructor(message = "You do not have permission to handle privacy requests.") {
    super(message);
    this.name = "PrivacyAccessError";
  }
}

export class PrivacyStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacyStateError";
  }
}

export class PrivacyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacyInputError";
  }
}

const DAY = 86_400_000;
const ONE_MONTH_DAYS = 30;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normaliseEmail = (email: string) => email.trim().toLowerCase();
export const emailHash = (email: string) => createHash("sha256").update(normaliseEmail(email)).digest("hex");

/** Contacts span every territory, so these are network-level powers: no territory grant is enough. */
function require(context: PrivacyActorContext, permissions: PermissionData, capability: keyof typeof privacyCapabilities) {
  const { module, action } = privacyCapabilities[capability];
  if (!evaluatePermission({ userId: context.userId, module, action }, permissions).allowed) {
    throw new PrivacyAccessError(`Missing permission ${module}.${action}.`);
  }
}

export function canHandlePrivacy(context: PrivacyActorContext, permissions: PermissionData, capability: keyof typeof privacyCapabilities) {
  const { module, action } = privacyCapabilities[capability];
  return evaluatePermission({ userId: context.userId, module, action }, permissions).allowed;
}

export async function listPrivacyRequests(context: PrivacyActorContext, permissions: PermissionData, store: PrivacyStore): Promise<PrivacyRequestRecord[]> {
  require(context, permissions, "view");
  return store.listRequests();
}

/**
 * Open a request. Asking again for the same subject and kind while one is still open returns
 * the existing request, so a double submit or an impatient follow-up never creates two. If we
 * hold nothing for that email the request is answered immediately and truthfully ("no data
 * held"), because making a person wait for an answer of "nothing" helps nobody.
 */
export async function createPrivacyRequest(
  context: PrivacyActorContext,
  permissions: PermissionData,
  audit: PrivacyAuditRecorder,
  store: PrivacyStore,
  input: { kind: PrivacyRequestKind; email: string; note?: string | null },
  now: Date = new Date()
): Promise<{ request: PrivacyRequestRecord; created: boolean }> {
  require(context, permissions, "create");
  if (input.kind !== "export" && input.kind !== "erasure") throw new PrivacyInputError("Unknown request type.");
  const email = normaliseEmail(input.email);
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new PrivacyInputError("Enter a valid email address.");

  const hash = emailHash(email);
  const existing = await store.findOpenRequest(input.kind, hash);
  if (existing) return { request: existing, created: false };

  const contact = await store.findContactByEmail(email);
  let request = await store.insertRequest({
    kind: input.kind,
    subjectContactId: contact?.id ?? null,
    subjectEmailHash: hash,
    requestedByUserId: context.userId,
    requestNote: input.note?.trim().slice(0, 500) || null,
    dueAt: new Date(now.getTime() + ONE_MONTH_DAYS * DAY)
  });

  await audit.record({
    action: auditActions.privacyRequestCreate,
    actor: { type: "human", userId: context.userId },
    entity: { type: "privacy_request", id: request.id },
    // The hash identifies the subject for support without putting the address in the audit trail.
    metadata: { kind: input.kind, subjectEmailHash: hash.slice(0, 16), dataHeld: Boolean(contact) }
  });

  if (!contact) {
    const settled = await store.settleRequest(request.id, { status: "completed", decidedByUserId: null, decisionNote: "No data held for this email address.", resultSummary: { dataHeld: false } }, now);
    if (settled) request = settled;
  }

  return { request, created: true };
}

/** Build the subject's data export. Re-generating is allowed (it is read-only); the audit trail records each time. */
export async function generateSubjectExport(
  context: PrivacyActorContext,
  permissions: PermissionData,
  audit: PrivacyAuditRecorder,
  store: PrivacyStore,
  requestId: string,
  now: Date = new Date()
): Promise<{ request: PrivacyRequestRecord; bundle: SubjectDataBundle }> {
  require(context, permissions, "export");
  const request = await store.getRequest(requestId);
  if (!request) throw new PrivacyStateError("That request was not found.");
  if (request.kind !== "export") throw new PrivacyStateError("Only a data-access request can be exported.");
  if (request.status === "rejected") throw new PrivacyStateError("This request was rejected.");
  if (!request.subjectContactId) throw new PrivacyStateError("No data is held for this subject, so there is nothing to export.");

  const bundle = await store.gatherSubjectData(request.subjectContactId, now);
  const counts = summarise(bundle);

  const settled = request.status === "requested" ? await store.settleRequest(request.id, { status: "completed", decidedByUserId: context.userId, decisionNote: null, resultSummary: { exported: counts } }, now) : request;

  await audit.record({
    action: auditActions.privacyExportGenerate,
    actor: { type: "human", userId: context.userId },
    entity: { type: "privacy_request", id: request.id },
    metadata: { counts }
  });

  return { request: settled ?? request, bundle };
}

/**
 * Approve or reject an erasure. Two people are required: whoever raised the request cannot
 * decide it, so one account can never both ask for and carry out a destructive change.
 * Approval erases in the same transaction as the decision is recorded, so the outcome is
 * either "approved and done" or "nothing happened".
 */
export async function decideErasure(
  context: PrivacyActorContext,
  permissions: PermissionData,
  audit: PrivacyAuditRecorder,
  store: PrivacyStore,
  requestId: string,
  decision: "approve" | "reject",
  note: string | null,
  now: Date = new Date()
): Promise<PrivacyRequestRecord> {
  require(context, permissions, "decide");
  const request = await store.getRequest(requestId, { forUpdate: true });
  if (!request) throw new PrivacyStateError("That request was not found.");
  if (request.kind !== "erasure") throw new PrivacyStateError("Only an erasure request needs a decision.");
  if (request.status !== "requested") throw new PrivacyStateError(`This request is already ${request.status}.`);
  if (request.requestedByUserId === context.userId) throw new PrivacyStateError("A different person must approve or reject this erasure request.");

  const cleanNote = note?.trim().slice(0, 500) || null;

  if (decision === "reject") {
    const rejected = await store.settleRequest(request.id, { status: "rejected", decidedByUserId: context.userId, decisionNote: cleanNote, resultSummary: {} }, now);
    if (!rejected) throw new PrivacyStateError("This request was decided by someone else a moment ago.");
    await audit.record({ action: auditActions.privacyErasureReject, actor: { type: "human", userId: context.userId }, entity: { type: "privacy_request", id: request.id }, metadata: { decisionNote: cleanNote } });
    return rejected;
  }

  if (!request.subjectContactId) throw new PrivacyStateError("No data is held for this subject.");

  // The row is locked (above) for this transaction, so a double click or a race waits here and then
  // sees the request already completed. Erase, then settle once with what was erased.
  const counts = await store.eraseContact(request.subjectContactId, now);
  const withSummary = await store.settleRequest(request.id, { status: "completed", decidedByUserId: context.userId, decisionNote: cleanNote, resultSummary: { erased: counts } }, now);
  if (!withSummary) throw new PrivacyStateError("This request was decided by someone else a moment ago.");

  await audit.record({
    action: auditActions.privacyErasureApprove,
    actor: { type: "human", userId: context.userId },
    entity: { type: "privacy_request", id: request.id },
    metadata: { counts, decisionNote: cleanNote }
  });
  return withSummary;
}

function summarise(bundle: SubjectDataBundle): DataCounts {
  return {
    subscriptions: bundle.subscriptions.length,
    consentEvents: bundle.consentEvents.length,
    suppressions: bundle.suppressions.length,
    savedContent: bundle.savedContent.length,
    activity: bundle.activity.length,
    segmentMemberships: bundle.segmentMemberships.length,
    emailDeliveries: bundle.emailDeliveries.length,
    hasPreferences: bundle.preferences ? 1 : 0
  };
}
