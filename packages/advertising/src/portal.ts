import { randomUUID } from "node:crypto";
import type { PermissionData } from "@raring2go/permissions";
import { acceptProposalCommercially, describePayableInvoice, respondToProposal, submitArtworkVersion, updateArtworkStatus } from "./service";
import type { AdvertisingData, ArtworkRequirement, ArtworkVersion } from "./types";

type AuditRecorder = Parameters<typeof respondToProposal>[2];

/**
 * Who a portal user is, derived on the SERVER from their session and the organisation they
 * belong to. It is never accepted from the browser: `advertiserIds` is the closed set of
 * advertiser records this person may see or act on.
 */
export type PortalIdentity = { userId: string; organisationId: string; advertiserIds: string[] };

export class PortalAccessError extends Error {
  constructor(message = "You do not have access to this record.") {
    super(message);
    this.name = "PortalAccessError";
  }
}

export class PortalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalStateError";
  }
}

export function resolvePortalIdentity(data: AdvertisingData, input: { userId: string; organisationId: string }): PortalIdentity {
  const organisation = data.organisations.find((candidate) => candidate.id === input.organisationId);
  if (!organisation || organisation.kind !== "advertiser") {
    throw new PortalAccessError("This account is not linked to an advertiser.");
  }
  const advertiserIds = data.advertisers
    .filter((advertiser) => advertiser.advertiserOrganisationId === organisation.id && !advertiser.deletedAt)
    .map((advertiser) => advertiser.id);
  if (advertiserIds.length === 0) throw new PortalAccessError("This account is not linked to an advertiser.");
  return { userId: input.userId, organisationId: organisation.id, advertiserIds };
}

// ---- Read model ---------------------------------------------------------------------

export type PortalProposal = {
  id: string;
  title: string;
  status: string;
  version: number;
  totalValueMinor: number;
  currency: string;
  validUntil: string | null;
  sentOn: string | null;
  items: Array<{ description: string; quantity: number; totalPriceMinor: number }>;
  /** True only while the advertiser can still accept, decline or ask for changes. */
  canRespond: boolean;
  response: string | null;
};

export type PortalArtworkVersion = { id: string; versionNumber: number; status: string; submittedAt: string | null; fileName: string | null; notes: string | null };

export type PortalArtwork = {
  requirementId: string;
  status: string;
  deadline: string | null;
  dimensions: Record<string, unknown>;
  versions: PortalArtworkVersion[];
  canSubmit: boolean;
  /** A proof has been issued and is waiting for the advertiser's approval. */
  awaitingProofApproval: boolean;
};

export type PortalCampaign = {
  bookingId: string;
  status: string;
  bookedOn: string;
  totalValueMinor: number;
  currency: string;
  items: Array<{ id: string; description: string; channel: string; quantity: number }>;
  artwork: PortalArtwork[];
  fulfilments: Array<{ id: string; channel: string; status: string; scheduledOn: string | null; fulfilledOn: string | null }>;
  proofPacks: Array<{ id: string; status: string; issuedAt: string | null; deliveredAt: string | null; metrics: Record<string, number> }>;
};

export type PortalInvoice = {
  id: string;
  invoiceNumber: string;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  totalMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  overdue: boolean;
  lines: Array<{ description: string; quantity: number; grossMinor: number }>;
  payments: Array<{ receivedDate: string; amountMinor: number; method: string }>;
  creditNotes: Array<{ creditNoteNumber: string; issuedDate: string; totalMinor: number }>;
};

export type PortalRenewal = { id: string; status: string; dueOn: string | null; summary: string | null };

export type PortalNeedsAction = { kind: "proposal" | "artwork" | "proof" | "invoice"; title: string; detail: string; recordId: string };

export type PortalView = {
  advertisers: Array<{ id: string; name: string }>;
  proposals: PortalProposal[];
  campaigns: PortalCampaign[];
  invoices: PortalInvoice[];
  renewals: PortalRenewal[];
  needsAction: PortalNeedsAction[];
  summary: { activeCampaigns: number; outstandingMinor: number; overdueMinor: number; metrics: Record<string, number> };
};

const SUBMITTABLE: ArtworkRequirement["status"][] = ["requested", "changes_requested", "rejected"];
const todayOf = (now: Date) => now.toISOString().slice(0, 10);
const text = (value: unknown) => (typeof value === "string" && value ? value : null);

function numericMetrics(value: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
}

/**
 * Builds the advertiser-facing picture of their own account. An explicit allow-list DTO:
 * internal pricing, margin, opportunity, scoring, notes, account-owner and other
 * advertisers' data are never copied in. Drafts (invoices, proof packs) are not shown.
 */
export function buildPortalView(identity: PortalIdentity, data: AdvertisingData, now: Date = new Date()): PortalView {
  const mine = new Set(identity.advertiserIds);
  const today = todayOf(now);
  const live = <T extends { deletedAt?: Date | null }>(row: T) => !row.deletedAt;
  const productName = (id: string) => data.products.find((product) => product.id === id);

  const proposals = data.proposals.filter(live).filter((proposal) => mine.has(proposal.advertiserId)).filter((proposal) => proposal.status !== "draft");
  const proposalViews: PortalProposal[] = proposals.map((proposal) => {
    const acceptance = data.acceptances.find((candidate) => candidate.proposalId === proposal.id && !candidate.deletedAt);
    return {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      version: proposal.version,
      totalValueMinor: proposal.totalValueMinor,
      currency: proposal.currency,
      validUntil: proposal.validUntil ?? null,
      sentOn: proposal.sentOn ?? null,
      items: data.proposalItems.filter(live).filter((item) => item.proposalId === proposal.id).map((item) => ({ description: item.description, quantity: item.quantity, totalPriceMinor: item.totalPriceMinor })),
      canRespond: proposal.status === "sent" && !acceptance && !(proposal.validUntil && proposal.validUntil < today) && proposal.metadata.current !== false && !proposal.metadata.supersededBy,
      response: acceptance ? acceptance.status : null
    };
  });

  const campaigns: PortalCampaign[] = data.bookings.filter(live).filter((booking) => mine.has(booking.advertiserId)).map((booking) => {
    const items = data.bookingItems.filter(live).filter((item) => item.bookingId === booking.id);
    const itemIds = new Set(items.map((item) => item.id));
    const fulfilments = data.campaignFulfilments.filter(live).filter((fulfilment) => fulfilment.bookingId === booking.id && mine.has(fulfilment.advertiserId));
    const fulfilmentIds = new Set(fulfilments.map((fulfilment) => fulfilment.id));
    const requirements = data.artworkRequirements.filter(live).filter((requirement) => itemIds.has(requirement.bookingItemId) && mine.has(requirement.advertiserId));

    return {
      bookingId: booking.id,
      status: booking.status,
      bookedOn: booking.bookedOn,
      totalValueMinor: booking.totalValueMinor,
      currency: booking.currency,
      items: items.map((item) => ({ id: item.id, description: item.description, channel: productName(item.productId)?.channel ?? "", quantity: item.quantity })),
      artwork: requirements.map((requirement) => ({
        requirementId: requirement.id,
        status: requirement.status,
        deadline: requirement.deadline ?? null,
        dimensions: requirement.dimensions,
        versions: data.artworkVersions.filter(live).filter((version) => version.artworkRequirementId === requirement.id).sort((a, b) => b.versionNumber - a.versionNumber).map((version) => ({
          id: version.id,
          versionNumber: version.versionNumber,
          status: version.status,
          submittedAt: version.submittedAt ?? null,
          fileName: text(version.assetReference.fileName),
          notes: version.notes ?? null
        })),
        canSubmit: SUBMITTABLE.includes(requirement.status),
        awaitingProofApproval: requirement.status === "in_review" && Object.keys(requirement.proofReference ?? {}).length > 0
      })),
      fulfilments: fulfilments.map((fulfilment) => ({ id: fulfilment.id, channel: fulfilment.channel, status: fulfilment.status, scheduledOn: fulfilment.scheduledOn ?? null, fulfilledOn: fulfilment.fulfilledOn ?? null })),
      proofPacks: data.proofPacks.filter(live).filter((pack) => fulfilmentIds.has(pack.fulfilmentId) && pack.status !== "draft").map((pack) => ({ id: pack.id, status: pack.status, issuedAt: pack.issuedAt ?? null, deliveredAt: pack.deliveredAt ?? null, metrics: numericMetrics(pack.metricsSnapshot) }))
    };
  });

  const invoices: PortalInvoice[] = data.invoices.filter(live).filter((invoice) => mine.has(invoice.advertiserId) && invoice.status !== "draft" && invoice.status !== "void").map((invoice) => {
    const allocations = data.paymentAllocations.filter(live).filter((allocation) => allocation.invoiceId === invoice.id);
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issueDate: invoice.issueDate ?? null,
      dueDate: invoice.dueDate ?? null,
      currency: invoice.currency,
      totalMinor: invoice.totalMinor,
      amountPaidMinor: invoice.amountPaidMinor,
      balanceMinor: invoice.balanceMinor,
      overdue: Boolean(invoice.dueDate && invoice.dueDate < today && invoice.balanceMinor > 0),
      lines: data.invoiceLines.filter(live).filter((line) => line.invoiceId === invoice.id).map((line) => ({ description: line.description, quantity: line.quantity, grossMinor: line.grossMinor })),
      payments: allocations.flatMap((allocation) => {
        const payment = data.payments.find((candidate) => candidate.id === allocation.paymentId && !candidate.deletedAt);
        return payment ? [{ receivedDate: payment.receivedDate, amountMinor: allocation.amountMinor, method: payment.method }] : [];
      }),
      creditNotes: data.creditNotes.filter(live).filter((note) => note.invoiceId === invoice.id).map((note) => ({ creditNoteNumber: note.creditNoteNumber, issuedDate: note.issuedDate, totalMinor: note.totalMinor }))
    };
  });

  const renewals: PortalRenewal[] = data.renewalPrompts.filter(live).filter((prompt) => mine.has(prompt.advertiserId) && prompt.status === "open").map((prompt) => ({
    id: prompt.id,
    status: prompt.status,
    dueOn: prompt.dueOn ?? null,
    summary: text(prompt.renewalSnapshot.summary) ?? text(prompt.renewalSnapshot.title)
  }));

  const needsAction: PortalNeedsAction[] = [
    ...proposalViews.filter((proposal) => proposal.canRespond).map((proposal): PortalNeedsAction => ({ kind: "proposal", title: `Respond to proposal: ${proposal.title}`, detail: proposal.validUntil ? `Valid until ${proposal.validUntil}` : "Awaiting your response", recordId: proposal.id })),
    ...campaigns.flatMap((campaign) => campaign.artwork.flatMap((artwork): PortalNeedsAction[] => [
      ...(artwork.awaitingProofApproval ? [{ kind: "proof" as const, title: "Approve your proof", detail: artwork.deadline ? `Needed by ${artwork.deadline}` : "A proof is ready for your approval", recordId: artwork.requirementId }] : []),
      ...(artwork.canSubmit ? [{ kind: "artwork" as const, title: artwork.status === "requested" ? "Send your artwork" : "Send revised artwork", detail: artwork.deadline ? `Needed by ${artwork.deadline}` : "Artwork is needed for this booking", recordId: artwork.requirementId }] : [])
    ])),
    ...invoices.filter((invoice) => invoice.overdue).map((invoice): PortalNeedsAction => ({ kind: "invoice", title: `Invoice ${invoice.invoiceNumber} is overdue`, detail: `Balance due: ${(invoice.balanceMinor / 100).toFixed(2)} ${invoice.currency}`, recordId: invoice.id }))
  ];

  const metrics: Record<string, number> = {};
  for (const campaign of campaigns) for (const pack of campaign.proofPacks) for (const [key, value] of Object.entries(pack.metrics)) metrics[key] = (metrics[key] ?? 0) + value;

  return {
    advertisers: data.advertisers.filter((advertiser) => mine.has(advertiser.id)).map((advertiser) => ({ id: advertiser.id, name: data.organisations.find((organisation) => organisation.id === advertiser.advertiserOrganisationId)?.name ?? "Your business" })),
    proposals: proposalViews,
    campaigns,
    invoices,
    renewals,
    needsAction,
    summary: {
      activeCampaigns: campaigns.filter((campaign) => campaign.status === "booked" && campaign.fulfilments.some((fulfilment) => fulfilment.status !== "fulfilled" && fulfilment.status !== "cancelled")).length || campaigns.filter((campaign) => campaign.status === "booked").length,
      outstandingMinor: invoices.reduce((total, invoice) => total + invoice.balanceMinor, 0),
      overdueMinor: invoices.filter((invoice) => invoice.overdue).reduce((total, invoice) => total + invoice.balanceMinor, 0),
      metrics
    }
  };
}

/** An advertiser paying their own invoice online: ownership comes from the server-derived identity, never the request. */
export function portalAuthorisePayment(identity: PortalIdentity, data: AdvertisingData, invoiceId: string) {
  const invoice = data.invoices.find((candidate) => candidate.id === invoiceId && !candidate.deletedAt);
  // The same error for missing and for someone else's invoice.
  if (!invoice || !identity.advertiserIds.includes(invoice.advertiserId)) throw new PortalAccessError("Invoice not found.");
  if (invoice.status !== "issued" && invoice.status !== "part_paid") throw new PortalStateError("That invoice cannot be paid online.");
  if (invoice.balanceMinor <= 0) throw new PortalStateError("That invoice has nothing left to pay.");
  return describePayableInvoice(data, invoice.id);
}

// ---- Actions ------------------------------------------------------------------------
// Each wraps a domain function. The domain's permission gate is coarse (for example the same
// capability marks "production ready"), so the portal adds its own: ownership by server-derived
// identity, an allow-list of states and decisions, and a linked contact for the signer.

function ownRequirement(identity: PortalIdentity, data: AdvertisingData, requirementId: string) {
  const requirement = data.artworkRequirements.find((candidate) => candidate.id === requirementId && !candidate.deletedAt);
  // Same error for missing and for someone else's: ids must not be probe-able across accounts.
  if (!requirement || !identity.advertiserIds.includes(requirement.advertiserId)) throw new PortalAccessError("Artwork requirement not found.");
  return requirement;
}

/**
 * Checks, without changing anything, that this account may send artwork for the requirement
 * right now. Callers run it BEFORE storing an uploaded file so a refused request never leaves
 * an orphaned file behind. Returns the owning advertiser's territory (for file access scope).
 */
export function assertArtworkSubmittable(identity: PortalIdentity, data: AdvertisingData, requirementId: string) {
  const requirement = ownRequirement(identity, data, requirementId);
  if (!SUBMITTABLE.includes(requirement.status)) {
    throw new PortalStateError(`Artwork cannot be sent while it is ${requirement.status.replace("_", " ")}.`);
  }
  const advertiser = data.advertisers.find((candidate) => candidate.id === requirement.advertiserId)!;
  return { requirement, territoryId: advertiser.owningTerritoryId };
}

export async function portalSubmitArtwork(
  identity: PortalIdentity,
  permissions: PermissionData,
  audit: AuditRecorder,
  data: AdvertisingData,
  input: { requirementId: string; versionId: string; domainEventId: string; file: { fileId: string; fileName: string; contentType: string; virusScanStatus: string }; notes?: string | null; submittedAt: string }
): Promise<ArtworkVersion> {
  const { requirement } = assertArtworkSubmittable(identity, data, input.requirementId);
  if (input.file.virusScanStatus !== "clean" && input.file.virusScanStatus !== "not_required") {
    throw new PortalStateError("That file has not passed the security scan.");
  }
  const versionNumber = Math.max(0, ...data.artworkVersions.filter((version) => version.artworkRequirementId === requirement.id).map((version) => version.versionNumber)) + 1;
  const version: ArtworkVersion = {
    id: input.versionId,
    artworkRequirementId: requirement.id,
    versionNumber,
    submittedByUserId: identity.userId,
    assetReference: { fileId: input.file.fileId, fileName: input.file.fileName, contentType: input.file.contentType },
    status: "received",
    preflightResultId: null,
    notes: input.notes?.trim().slice(0, 500) || null,
    submittedAt: input.submittedAt
  };
  return submitArtworkVersion({ userId: identity.userId, organisationId: identity.organisationId }, permissions, audit, data, requirement.id, version, input.domainEventId);
}

export async function portalRespondToProof(
  identity: PortalIdentity,
  permissions: PermissionData,
  audit: AuditRecorder,
  data: AdvertisingData,
  input: { requirementId: string; decision: "approved" | "changes_requested"; actorDate: string; domainEventId: string }
) {
  // Only these two outcomes are the advertiser's to give. "production_ready" is Raring2go's.
  if (input.decision !== "approved" && input.decision !== "changes_requested") {
    throw new PortalStateError("Unknown decision.");
  }
  const requirement = ownRequirement(identity, data, input.requirementId);
  if (requirement.status !== "in_review" || Object.keys(requirement.proofReference ?? {}).length === 0) {
    throw new PortalStateError("There is no proof waiting for your approval.");
  }
  return updateArtworkStatus({ userId: identity.userId, organisationId: identity.organisationId }, permissions, audit, data, requirement.id, {
    status: input.decision,
    approvedVersionId: input.decision === "approved" ? requirement.approvedVersionId ?? null : null,
    actorDate: input.actorDate,
    domainEventId: input.domainEventId
  });
}

export async function portalRespondToProposal(
  identity: PortalIdentity,
  permissions: PermissionData,
  audit: AuditRecorder,
  data: AdvertisingData,
  input: { proposalId: string; response: "accepted" | "rejected" | "change_requested"; respondedAt: string; requestMetadata: Record<string, unknown>; ids: { acceptanceId: string; bookingId: string; domainEventId: string } }
) {
  const proposal = data.proposals.find((candidate) => candidate.id === input.proposalId && !candidate.deletedAt);
  if (!proposal || !identity.advertiserIds.includes(proposal.advertiserId)) throw new PortalAccessError("Proposal not found.");

  const contact = data.contacts.find((candidate) => candidate.advertiserId === proposal.advertiserId && candidate.userId === identity.userId && !candidate.deletedAt);
  if (!contact) throw new PortalStateError("Your login is not linked to a contact on this account, so you cannot respond. Ask your account manager.");

  const terms = [...data.terms].filter((candidate) => candidate.status === "approved" && !candidate.deletedAt).sort((a, b) => String(b.approvedAt ?? "").localeCompare(String(a.approvedAt ?? "")))[0];
  if (!terms) throw new PortalStateError("There are no approved terms to respond against yet.");

  const context = { userId: identity.userId, organisationId: identity.organisationId };
  const idempotencyKey = `portal:proposal:${proposal.id}:${input.response}`;
  const common = { acceptanceId: input.ids.acceptanceId, proposalId: proposal.id, termsId: terms.id, acceptedByContactId: contact.id, idempotencyKey, requestMetadata: { ...input.requestMetadata, via: "advertiser_portal" }, domainEventId: input.ids.domainEventId };

  if (input.response === "accepted") {
    return acceptProposalCommercially(context, permissions, audit, data, {
      ...common,
      acceptedAt: input.respondedAt,
      bookingId: input.ids.bookingId,
      bookingItemIdPrefix: `${input.ids.bookingId}:item`,
      reservationIdPrefix: `${input.ids.bookingId}:reservation`,
      productionRequestIdPrefix: `${input.ids.bookingId}:production`,
      newId: randomUUID
    });
  }

  return respondToProposal(context, permissions, audit, data, { ...common, response: input.response === "rejected" ? "rejected" : "change_requested", respondedAt: input.respondedAt });
}
