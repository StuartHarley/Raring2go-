import { randomUUID } from "node:crypto";
import {
  convertRenewalToOpportunity,
  createProofPack,
  dismissRenewalPrompt,
  loadEditionPageReadiness,
  loadPublishedPlacementEvidence,
  recordCampaignFulfilment,
  updateArtworkStatus
} from "@raring2go/advertising";
import type { AdvertisingActorContext } from "@raring2go/advertising";
import { mutate } from "./advertising-mutations";

/**
 * Staff artwork sign-off, campaign fulfilment, proof packs and renewals (ADV-007, ADV-008).
 * Same shape as the other advertiser writes. Edition Factory is read inside the same transaction,
 * so "ready" and "published" are checked against the real records, not asserted by the form.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

export type ArtworkStaffAction = "issue_proof" | "request_changes" | "approve_for_advertiser" | "production_ready";

export async function actOnArtwork(context: AdvertisingActorContext, requirementId: string, action: ArtworkStaffAction) {
  return mutate(async (tx, data, audit, permissions) => {
    const requirement = data.artworkRequirements.find((candidate) => candidate.id === requirementId && !candidate.deletedAt);
    if (!requirement) throw new Error("Artwork requirement was not found.");
    const latest = data.artworkVersions
      .filter((version) => version.artworkRequirementId === requirementId && !version.deletedAt)
      .sort((left, right) => right.versionNumber - left.versionNumber)[0];

    const base = { actorDate: todayIso(), domainEventId: randomUUID() };
    if (action === "issue_proof") {
      if (!latest) throw new Error("Artwork needs a submitted version before it can be approved.");
      return updateArtworkStatus(context, permissions, audit, data, requirementId, {
        ...base, status: "in_review", approvedVersionId: latest.id, proofReference: { issuedOn: todayIso(), versionId: latest.id, issuedByUserId: context.userId }
      });
    }
    if (action === "request_changes") {
      return updateArtworkStatus(context, permissions, audit, data, requirementId, { ...base, status: "changes_requested" });
    }
    if (action === "approve_for_advertiser") {
      return updateArtworkStatus(context, permissions, audit, data, requirementId, { ...base, status: "approved", approvedVersionId: requirement.approvedVersionId ?? latest?.id ?? null });
    }
    // Sign-off for production also needs the page to be ready in Edition Factory.
    const pageReadiness = requirement.editionPageId ? await loadEditionPageReadiness(tx, requirement.editionPageId) : null;
    return updateArtworkStatus(context, permissions, audit, data, requirementId, { ...base, status: "production_ready", pageReadiness });
  });
}

export async function recordFulfilmentRecord(
  context: AdvertisingActorContext,
  input: { bookingItemId: string; status: "scheduled" | "in_progress" | "fulfilled" | "cancelled"; scheduledOn?: string }
) {
  return mutate(async (tx, data, audit, permissions) => {
    const item = data.bookingItems.find((candidate) => candidate.id === input.bookingItemId && !candidate.deletedAt);
    if (!item) throw new Error("Booking item was not found.");
    const booking = data.bookings.find((candidate) => candidate.id === item.bookingId && !candidate.deletedAt);
    if (!booking) throw new Error("Booking was not found.");
    const requirement = data.artworkRequirements.find((candidate) => candidate.bookingItemId === item.id && !candidate.deletedAt);
    const product = data.products.find((candidate) => candidate.id === item.productId);
    const existing = data.campaignFulfilments.find((candidate) => candidate.bookingItemId === item.id && !candidate.deletedAt);

    const territoryEditionId = requirement?.territoryEditionId ?? existing?.territoryEditionId ?? null;
    const editionPageId = requirement?.editionPageId ?? existing?.editionPageId ?? null;
    const publishedEvidence = input.status === "fulfilled" && territoryEditionId
      ? await loadPublishedPlacementEvidence(tx, { territoryEditionId, editionPageId })
      : undefined;

    return recordCampaignFulfilment(
      context,
      permissions,
      audit,
      data,
      {
        id: existing?.id ?? randomUUID(),
        bookingId: booking.id,
        bookingItemId: item.id,
        advertiserId: booking.advertiserId,
        territoryId: booking.territoryId,
        artworkRequirementId: requirement?.id ?? existing?.artworkRequirementId ?? null,
        territoryEditionId,
        editionPageId,
        status: input.status,
        channel: product?.channel ?? existing?.channel ?? "print",
        scheduledOn: input.scheduledOn || existing?.scheduledOn || null,
        fulfilledOn: input.status === "fulfilled" ? todayIso() : null,
        placementReference: existing?.placementReference ?? {},
        performanceReference: existing?.performanceReference ?? {},
        metadata: existing?.metadata ?? {}
      },
      randomUUID(),
      { publishedEvidence }
    );
  });
}

export async function createProofPackRecord(context: AdvertisingActorContext, fulfilmentId: string, input: { deliver: boolean }) {
  return mutate((_tx, data, audit, permissions) => {
    const fulfilment = data.campaignFulfilments.find((candidate) => candidate.id === fulfilmentId && !candidate.deletedAt);
    if (!fulfilment) throw new Error("Fulfilment was not found.");
    if (fulfilment.status !== "fulfilled") throw new Error("A proof pack needs a fulfilled campaign.");
    return createProofPack(
      context,
      permissions,
      audit,
      data,
      {
        id: randomUUID(),
        fulfilmentId,
        advertiserId: fulfilment.advertiserId,
        territoryId: fulfilment.territoryId,
        status: input.deliver ? "delivered" : "issued",
        issuedAt: todayIso(),
        deliveredAt: input.deliver ? todayIso() : null,
        artefactReference: {},
        metricsSnapshot: {},
        renewalPromptId: null
      },
      randomUUID()
    );
  });
}

export async function convertRenewalRecord(context: AdvertisingActorContext, renewalId: string) {
  return mutate((_tx, data, audit, permissions) => {
    const renewal = data.renewalPrompts.find((candidate) => candidate.id === renewalId && !candidate.deletedAt);
    if (!renewal) throw new Error("Renewal prompt was not found.");
    const organisation = data.organisations.find((candidate) => candidate.id === data.advertisers.find((advertiser) => advertiser.id === renewal.advertiserId)?.advertiserOrganisationId);
    const stage = [...data.pipelineStages].filter((candidate) => !candidate.isClosed && !candidate.deletedAt).sort((left, right) => left.sortOrder - right.sortOrder)[0];
    if (!stage) throw new Error("No pipeline stage is configured.");
    return convertRenewalToOpportunity(context, permissions, audit, data, { renewalId, opportunityId: randomUUID(), stageId: stage.id, title: `Renewal - ${organisation?.name ?? "advertiser"}` });
  });
}

export async function dismissRenewalRecord(context: AdvertisingActorContext, renewalId: string, reason: string) {
  return mutate((_tx, data, audit, permissions) => dismissRenewalPrompt(context, permissions, audit, data, renewalId, reason));
}
