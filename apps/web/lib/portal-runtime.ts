import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb, fixtureIds } from "@raring2go/db";
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
import { appLogger } from "./logger";

export type PortalActorContext = { userId: string; organisationId: string };

const permission = (module: string, action: string) => ({ id: `${module}.${action}`, module, action });
const grant = (module: string, action: string) => ({ roleId: fixtureIds.roles.advertiser, permission: permission(module, action), scope: "own_organisation", constraints: {} });

/**
 * What an advertiser's own login may do. The domain's gates are coarse (the same capability
 * covers "production ready"), which is why the portal service adds its own state and ownership
 * rules on top: see packages/advertising/src/portal.ts.
 */
export const portalPermissionData: PermissionData = {
  roleAssignments: [
    { id: "fixture_assignment_advertiser", userId: fixtureIds.users.advertiserUser, roleId: fixtureIds.roles.advertiser, organisationId: fixtureIds.organisations.advertiser }
  ],
  rolePermissions: [
    grant("portal.advertiser", "view"),
    grant("advertiser.artwork", "submit"),
    grant("advertiser.artwork", "approve"),
    grant("advertiser.artwork", "manage"),
    grant("advertiser.proposal", "accept"),
    grant("advertiser.proposal", "respond"),
    grant("advertiser.booking", "accept")
  ]
};

function advertisingAuditFor(db: Parameters<typeof recordAuditEvent>[0]) {
  return {
    record: (event: { action: string; actorUserId?: string | null; entityType: string; entityId?: string | null; organisationId?: string | null; territoryId?: string | null; payload?: Record<string, unknown> }) =>
      recordAuditEvent(db, {
        action: event.action,
        actor: { type: "human", userId: event.actorUserId ?? "" },
        entity: { type: event.entityType, id: event.entityId ?? undefined },
        scope: { organisationId: event.organisationId ?? undefined, territoryId: event.territoryId ?? undefined },
        after: event.payload
      }).then(() => undefined)
  };
}

/**
 * The portal runtime checks the grant itself rather than trusting its caller: being a member of an
 * advertiser organisation (as a staff test fixture can be) is not the same as having portal access.
 */
function requirePortalAccess(context: PortalActorContext) {
  requirePermission({ userId: context.userId, module: "portal.advertiser", action: "view", context: { organisationId: context.organisationId } }, portalPermissionData);
}

export async function readPortal(context: PortalActorContext) {
  requirePortalAccess(context);
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
async function mutate<T>(context: PortalActorContext, work: (identity: PortalIdentity, data: Awaited<ReturnType<typeof loadAdvertisingData>>, audit: ReturnType<typeof advertisingAuditFor>) => Promise<T>) {
  requirePortalAccess(context);
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadAdvertisingData(tx);
      const identity = resolvePortalIdentity(data, context);
      const before = snapshotAdvertisingData(data);
      const result = await work(identity, data, advertisingAuditFor(tx));
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
  requirePortalAccess(context);
  const { db, sql } = createDb();
  try {
    const data = await loadAdvertisingData(db);
    assertArtworkSubmittable(resolvePortalIdentity(data, context), data, input.requirementId);
  } finally {
    await sql.end();
  }

  const file = await uploadAdvertiserArtwork({ userId: context.userId, organisationId: context.organisationId }, { fileName: input.fileName, contentType: input.contentType, bytes: input.bytes });

  const version = await mutate(context, (identity, data, audit) =>
    portalSubmitArtwork(identity, portalPermissionData, audit, data, {
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
  mutate(context, (identity, data, audit) =>
    portalRespondToProof(identity, portalPermissionData, audit, data, { ...input, actorDate: new Date().toISOString().slice(0, 10), domainEventId: randomUUID() })
  );

export const respondToProposalAsAdvertiser = (
  context: PortalActorContext,
  input: { proposalId: string; response: "accepted" | "rejected" | "change_requested"; requestMetadata?: Record<string, unknown> }
) =>
  mutate(context, (identity, data, audit) =>
    portalRespondToProposal(identity, portalPermissionData, audit, data, {
      proposalId: input.proposalId,
      response: input.response,
      respondedAt: new Date().toISOString().slice(0, 10),
      requestMetadata: input.requestMetadata ?? {},
      ids: { acceptanceId: randomUUID(), bookingId: randomUUID(), domainEventId: randomUUID() }
    })
  );
