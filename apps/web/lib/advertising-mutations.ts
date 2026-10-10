import { randomUUID } from "node:crypto";
import { createDb, organisations } from "@raring2go/db";
import {
  addAdvertiserContact,
  cancelAdvertiserTask,
  completeAdvertiserTask,
  createAdvertiserTask,
  reopenAdvertiserTask,
  changeOpportunityStage,
  createAdvertiser,
  createOpportunity,
  loadAdvertisingData,
  persistAdvertisingChanges,
  recordAdvertiserActivity,
  refreshAdvertiserMetrics,
  snapshotAdvertisingData,
  updateAdvertiser,
  updateOpportunity
} from "@raring2go/advertising";
import type { AdvertisingActorContext, AdvertisingData } from "@raring2go/advertising";
import type { PermissionData } from "@raring2go/permissions";
import { advertisingAuditFor } from "./advertising-audit";
import { getPermissionData } from "./permission-source";

/**
 * Staff advertiser CRM writes (ADV-001, ADV-002).
 *
 * Each call loads fresh data inside one transaction, lets the domain function do the permission,
 * territory and rule checks, then writes exactly what it changed together with its audit rows.
 * The actor's context comes from the server-resolved session, never from the request.
 */

export class DuplicateAdvertiserError extends Error {
  constructor() {
    super("An advertiser with that name already exists.");
  }
}

export type Tx = Parameters<Parameters<ReturnType<typeof createDb>["db"]["transaction"]>[0]>[0];

export async function mutate<T>(
  work: (tx: Tx, data: AdvertisingData, audit: ReturnType<typeof advertisingAuditFor>, permissions: PermissionData) => Promise<T>,
  /** Runs inside the transaction before the data is read, e.g. to lock a row the work will increment. */
  beforeLoad?: (tx: Tx) => Promise<void>
) {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      if (beforeLoad) await beforeLoad(tx);
      const data = await loadAdvertisingData(tx);
      const before = snapshotAdvertisingData(data);
      const result = await work(tx, data, advertisingAuditFor(tx), permissions);
      await persistAdvertisingChanges(tx, before, data);
      return result;
    });
  } finally {
    await sql.end();
  }
}

const normaliseName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export async function createAdvertiserRecord(
  context: AdvertisingActorContext,
  input: { organisationId?: string; newOrganisationName?: string; owningTerritoryId: string; source?: string; accountOwnerUserId?: string | null }
) {
  return mutate(async (tx, data, audit, permissions) => {
    let organisationId = input.organisationId;

    if (!organisationId) {
      const name = (input.newOrganisationName ?? "").trim();
      if (!name) throw new Error("Choose an existing advertiser organisation or give the new advertiser a name.");
      if (data.organisations.some((organisation) => organisation.kind === "advertiser" && normaliseName(organisation.name) === normaliseName(name))) {
        throw new DuplicateAdvertiserError();
      }
      organisationId = randomUUID();
      await tx.insert(organisations).values({ id: organisationId, kind: "advertiser", name });
      data.organisations.push({ id: organisationId, kind: "advertiser", name } as AdvertisingData["organisations"][number]);
    }

    return createAdvertiser(context, permissions, audit, data, {
      id: randomUUID(),
      advertiserOrganisationId: organisationId,
      owningTerritoryId: input.owningTerritoryId,
      accountOwnerUserId: input.accountOwnerUserId ?? context.userId,
      status: "prospect",
      relationshipState: "new",
      source: input.source?.trim() || "staff_created",
      firstBookedOn: null,
      lastBookedOn: null,
      lapsedOn: null,
      averageSaleValueMinor: 0,
      annualAdvertiserValueMinor: 0,
      currency: "GBP",
      tags: [],
      commercialMetadata: {}
    });
  });
}

export async function updateAdvertiserRecord(
  context: AdvertisingActorContext,
  advertiserId: string,
  patch: { status?: string; accountOwnerUserId?: string | null; tags?: string[]; notes?: string }
) {
  return mutate(async (_tx, data, audit, permissions) => {
    const existing = data.advertisers.find((advertiser) => advertiser.id === advertiserId);
    const { notes, ...rest } = patch;
    return updateAdvertiser(context, permissions, audit, data, advertiserId, {
      ...rest,
      ...(notes !== undefined ? { commercialMetadata: { ...(existing?.commercialMetadata ?? {}), internalNotes: notes } } : {})
    });
  });
}

export async function addContactRecord(
  context: AdvertisingActorContext,
  advertiserId: string,
  input: { label: string; name: string; email: string; phone?: string; role: string; isPrimary: boolean }
) {
  return mutate((_tx, data, audit, permissions) =>
    addAdvertiserContact(context, permissions, audit, data, {
      id: randomUUID(),
      advertiserId,
      userId: null,
      label: input.label,
      name: input.name,
      email: input.email,
      phone: input.phone || null,
      role: input.role,
      isPrimary: input.isPrimary
    })
  );
}

export async function logActivityRecord(
  context: AdvertisingActorContext,
  advertiserId: string,
  input: { activityType: string; title: string; body?: string }
) {
  return mutate((_tx, data, audit, permissions) => {
    const advertiser = data.advertisers.find((candidate) => candidate.id === advertiserId);
    if (!advertiser) throw new Error("Advertiser was not found.");
    return recordAdvertiserActivity(context, permissions, audit, data, {
      id: randomUUID(),
      advertiserId,
      territoryId: advertiser.owningTerritoryId,
      actorUserId: context.userId,
      activityType: input.activityType,
      title: input.title,
      body: input.body || null,
      relatedEntityType: null,
      relatedEntityId: null,
      metadata: { source: "staff" }
    });
  });
}

export async function createOpportunityRecord(
  context: AdvertisingActorContext,
  input: { advertiserId: string; stageId: string; title: string; estimatedValueMinor: number; expectedCloseDate?: string; nextAction?: string; nextActionDate?: string; notes?: string }
) {
  return mutate((_tx, data, audit, permissions) => {
    const advertiser = data.advertisers.find((candidate) => candidate.id === input.advertiserId);
    if (!advertiser) throw new Error("Advertiser was not found.");
    return createOpportunity(context, permissions, audit, data, {
      id: randomUUID(),
      advertiserId: advertiser.id,
      territoryId: advertiser.owningTerritoryId,
      ownerUserId: context.userId,
      stageId: input.stageId,
      source: "staff_created",
      title: input.title,
      estimatedValueMinor: input.estimatedValueMinor,
      currency: advertiser.currency,
      probability: 0,
      expectedCloseDate: input.expectedCloseDate || null,
      nextAction: input.nextAction || null,
      nextActionDate: input.nextActionDate || null,
      notes: input.notes || null
    });
  });
}

export async function updateOpportunityRecord(
  context: AdvertisingActorContext,
  opportunityId: string,
  patch: { nextAction?: string | null; nextActionDate?: string | null; expectedCloseDate?: string | null; notes?: string | null; estimatedValueMinor?: number }
) {
  return mutate((_tx, data, audit, permissions) => updateOpportunity(context, permissions, audit, data, opportunityId, patch));
}

export async function moveOpportunityStage(
  context: AdvertisingActorContext,
  opportunityId: string,
  input: { stageId: string; lostReason?: string; competitor?: string }
) {
  return mutate(async (_tx, data, audit, permissions) => {
    const stage = data.pipelineStages.find((candidate) => candidate.id === input.stageId);
    // A lost deal must say why; that is what later churn and win/loss reporting reads.
    if (stage?.outcome === "lost" && !input.lostReason?.trim()) throw new Error("A lost opportunity needs a reason.");
    return changeOpportunityStage(context, permissions, audit, data, opportunityId, { ...input, lostReason: input.lostReason?.trim() || null });
  });
}

export async function refreshMetricsRecord(context: AdvertisingActorContext, advertiserId: string) {
  return mutate((_tx, data, audit, permissions) => refreshAdvertiserMetrics(context, permissions, audit, data, advertiserId));
}

export async function createTaskRecord(context: AdvertisingActorContext, input: { advertiserId: string; opportunityId?: string | null; title: string; notes?: string; dueOn?: string }) {
  return mutate((_tx, data, audit, permissions) => createAdvertiserTask(context, permissions, audit, data, { ...input, opportunityId: input.opportunityId || null, dueOn: input.dueOn || null }));
}

export type TaskStep = "complete" | "cancel" | "reopen";

export async function changeTaskRecord(context: AdvertisingActorContext, taskId: string, step: TaskStep) {
  return mutate((_tx, data, audit, permissions) =>
    step === "complete" ? completeAdvertiserTask(context, permissions, audit, data, taskId) : step === "cancel" ? cancelAdvertiserTask(context, permissions, audit, data, taskId) : reopenAdvertiserTask(context, permissions, audit, data, taskId)
  );
}
