import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import {
  assertArtworkSubmittable,
  buildPortalView,
  loadAdvertisingData,
  persistAdvertisingChanges,
  portalRespondToProof,
  portalRespondToProposal,
  portalSubmitArtwork,
  resolvePortalIdentity,
  snapshotAdvertisingData
} from "@raring2go/advertising";
import type { PortalIdentity } from "@raring2go/advertising";
import { requirePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import { uploadAdvertiserArtwork } from "./files-runtime";
import { advertisingAuditFor } from "./advertising-audit";
import { appLogger } from "./logger";
import { getPermissionData } from "./permission-source";

export type PortalActorContext = { userId: string; organisationId: string };

/**
 * The portal runtime checks the grant itself rather than trusting its caller: being a member of an
 * advertiser organisation (as a staff test fixture can be) is not the same as having portal access.
 */
function requirePortalAccess(permissions: PermissionData, context: PortalActorContext) {
  requirePermission({ userId: context.userId, module: "portal.advertiser", action: "view", context: { organisationId: context.organisationId } }, permissions);
}

export async function readPortal(context: PortalActorContext) {
  requirePortalAccess(await getPermissionData(), context);
  const { db, sql } = createDb();

  try {
    const data = await loadAdvertisingData(db);
    const identity = resolvePortalIdentity(data, context);
    return { identity, view: buildPortalView(identity, data) };
  } finally {
    await sql.end();
  }
}

/**
 * Runs `work` against freshly loaded data inside one transaction, then writes exactly what the
 * domain function changed. Identity is re-derived from the session's organisation here, never
 * taken from the caller.
 */
async function mutate<T>(
  context: PortalActorContext,
  work: (identity: PortalIdentity, data: Awaited<ReturnType<typeof loadAdvertisingData>>, audit: ReturnType<typeof advertisingAuditFor>, permissions: PermissionData) => Promise<T>
) {
  const permissions = await getPermissionData();
  requirePortalAccess(permissions, context);
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadAdvertisingData(tx);
      const identity = resolvePortalIdentity(data, context);
      const before = snapshotAdvertisingData(data);
      const result = await work(identity, data, advertisingAuditFor(tx), permissions);
      await persistAdvertisingChanges(tx, before, data);
      return result;
    });
  } finally {
    await sql.end();
  }
}

export async function submitArtworkAsAdvertiser(
  context: PortalActorContext,
  input: { requirementId: string; fileName: string; contentType: string; bytes: Uint8Array; notes?: string | null }
) {
  // Refuse before storing anything: a request that will be rejected must not leave a file behind.
  requirePortalAccess(await getPermissionData(), context);
  const { db, sql } = createDb();
  try {
    const data = await loadAdvertisingData(db);
    assertArtworkSubmittable(resolvePortalIdentity(data, context), data, input.requirementId);
  } finally {
    await sql.end();
  }

  const file = await uploadAdvertiserArtwork({ userId: context.userId, organisationId: context.organisationId }, { fileName: input.fileName, contentType: input.contentType, bytes: input.bytes });

  const version = await mutate(context, (identity, data, audit, permissions) =>
    portalSubmitArtwork(identity, permissions, audit, data, {
      requirementId: input.requirementId,
      versionId: randomUUID(),
      domainEventId: randomUUID(),
      file,
      notes: input.notes,
      submittedAt: new Date().toISOString().slice(0, 10)
    })
  );
  appLogger.info("advertiser artwork submitted", { requirementId: input.requirementId, versionId: version.id, scan: file.virusScanStatus });
  return version;
}

export const respondToProofAsAdvertiser = (context: PortalActorContext, input: { requirementId: string; decision: "approved" | "changes_requested" }) =>
  mutate(context, (identity, data, audit, permissions) =>
    portalRespondToProof(identity, permissions, audit, data, { ...input, actorDate: new Date().toISOString().slice(0, 10), domainEventId: randomUUID() })
  );

export const respondToProposalAsAdvertiser = (
  context: PortalActorContext,
  input: { proposalId: string; response: "accepted" | "rejected" | "change_requested"; requestMetadata?: Record<string, unknown> }
) =>
  mutate(context, (identity, data, audit, permissions) =>
    portalRespondToProposal(identity, permissions, audit, data, {
      proposalId: input.proposalId,
      response: input.response,
      respondedAt: new Date().toISOString().slice(0, 10),
      requestMetadata: input.requestMetadata ?? {},
      ids: { acceptanceId: randomUUID(), bookingId: randomUUID(), domainEventId: randomUUID() }
    })
  );
