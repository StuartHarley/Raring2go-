import { recordAuditEvent } from "@raring2go/audit";
import { createDb, fixtureIds } from "@raring2go/db";
import type { PermissionData } from "@raring2go/permissions";
import {
  canHandlePrivacy,
  createDrizzlePrivacyStore,
  createPrivacyRequest,
  decideErasure,
  generateSubjectExport,
  listPrivacyRequests,
  privacyCapabilities
} from "@raring2go/security";
import type { PrivacyActorContext, PrivacyRequestKind } from "@raring2go/security";
import { appLogger } from "./logger";

export type { PrivacyActorContext };

const permissionRows = [
  { id: fixtureIds.permissions.privacyRequestView, ...privacyCapabilities.view },
  { id: fixtureIds.permissions.privacyRequestCreate, ...privacyCapabilities.create },
  { id: fixtureIds.permissions.privacyRequestDecide, ...privacyCapabilities.decide },
  { id: fixtureIds.permissions.privacyRequestExport, ...privacyCapabilities.export }
];

/** Fixture grants for the dev auth runtime: Head Office only. Franchisees hold none of these. */
export const privacyPermissionData: PermissionData = {
  roleAssignments: [{ id: "fixture_assignment_hq", userId: fixtureIds.users.superAdmin, roleId: fixtureIds.roles.hqAdmin, organisationId: fixtureIds.organisations.hq }],
  rolePermissions: permissionRows.map((permission) => ({ roleId: fixtureIds.roles.hqAdmin, permission, scope: "network", constraints: {} }))
};

export const can = (context: PrivacyActorContext, capability: keyof typeof privacyCapabilities) => canHandlePrivacy(context, privacyPermissionData, capability);

const auditFor = (db: Parameters<typeof recordAuditEvent>[0]) => ({ record: (input: Parameters<typeof recordAuditEvent>[1]) => recordAuditEvent(db, input) });

type Db = ReturnType<typeof createDb>["db"];

/** One transaction per call: a failed erasure rolls back completely, and a decision cannot half-apply. */
async function inTransaction<T>(work: (store: ReturnType<typeof createDrizzlePrivacyStore>, audit: ReturnType<typeof auditFor>) => Promise<T>): Promise<T> {
  const { db, sql } = createDb();
  try {
    return await db.transaction(async (tx) => work(createDrizzlePrivacyStore(tx as unknown as Db), auditFor(tx as unknown as Parameters<typeof recordAuditEvent>[0])));
  } finally {
    await sql.end();
  }
}

export async function readPrivacyRequests(context: PrivacyActorContext) {
  const requests = await inTransaction((store) => listPrivacyRequests(context, privacyPermissionData, store));
  // The clock is read here, not in the page, so rendering stays pure.
  return { requests, checkedAt: new Date() };
}

export async function createRequestAsActor(context: PrivacyActorContext, input: { kind: PrivacyRequestKind; email: string; note: string | null }) {
  const result = await inTransaction((store, audit) => createPrivacyRequest(context, privacyPermissionData, audit, store, input));
  appLogger.info("privacy request opened", { requestId: result.request.id, kind: input.kind, created: result.created, actorUserId: context.userId });
  return result;
}

export async function decideErasureAsActor(context: PrivacyActorContext, requestId: string, decision: "approve" | "reject", note: string | null) {
  const request = await inTransaction((store, audit) => decideErasure(context, privacyPermissionData, audit, store, requestId, decision, note));
  appLogger.info("erasure request decided", { requestId, decision, actorUserId: context.userId });
  return request;
}

export async function exportSubjectAsActor(context: PrivacyActorContext, requestId: string) {
  const result = await inTransaction((store, audit) => generateSubjectExport(context, privacyPermissionData, audit, store, requestId));
  appLogger.info("subject export generated", { requestId, actorUserId: context.userId });
  return result;
}
