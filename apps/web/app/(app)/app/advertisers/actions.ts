"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import {
  DuplicateAdvertiserError,
  changeTaskRecord,
  createTaskRecord,
  addContactRecord,
  createAdvertiserRecord,
  createOpportunityRecord,
  logActivityRecord,
  moveOpportunityStage,
  refreshMetricsRecord,
  updateAdvertiserRecord,
  updateOpportunityRecord
} from "../../../../lib/advertising-mutations";
import {
  allocatePaymentRecord,
  bookProposalRecord,
  createInvoiceRecord,
  createProposalRecord,
  issueInvoiceRecord,
  recordPaymentRecord,
  sendProposalRecord
} from "../../../../lib/advertising-sales";
import {
  actOnArtwork,
  convertRenewalRecord,
  createProofPackRecord,
  dismissRenewalRecord,
  recordFulfilmentRecord
} from "../../../../lib/advertising-fulfilment";
import type { ArtworkStaffAction } from "../../../../lib/advertising-fulfilment";

/**
 * Staff advertiser CRM actions. The signed-in actor is resolved here on the server; the domain then
 * checks the exact permission and territory scope. Result codes are fixed, so banner text is looked
 * up on the page and never reflected from the URL.
 */
export type CrmResult = "created" | "saved" | "duplicate" | "not_allowed" | "invalid" | "below_minimum" | "needs_approval" | "slot_taken" | "no_price" | "already_done" | "exception_open" | "page_not_ready" | "not_published" | "step_not_allowed" | "artwork_not_ready";

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "advertiser", action: "view" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

type Actor = Awaited<ReturnType<typeof actorFor>>;

function resultFor(error: unknown): CrmResult | undefined {
  if (error instanceof DuplicateAdvertiserError) return "duplicate";
  if (!(error instanceof Error)) return undefined;
  // Pricing and stock rules get their own codes so staff are told why, without echoing anything from the request.
  if (/below the minimum/i.test(error.message)) return "below_minimum";
  if (/needs approval/i.test(error.message)) return "needs_approval";
  if (/already reserved/i.test(error.message)) return "slot_taken";
  if (/no price for/i.test(error.message)) return "no_price";
  if (/already has an invoice|Only a draft|Only draft|Only an open renewal/i.test(error.message)) return "already_done";
  if (/open production exception/i.test(error.message)) return "exception_open";
  if (/page is not ready/i.test(error.message)) return "page_not_ready";
  if (/production-ready artwork/i.test(error.message)) return "artwork_not_ready";
  if (/published edition output/i.test(error.message)) return "not_published";
  if (/cannot move from|submitted version|failed preflight/i.test(error.message)) return "step_not_allowed";
  if (/Missing permission|outside|not permitted|cannot access|scope/i.test(error.message)) return "not_allowed";
  // Rule violations thrown by the domain read as plain messages; infrastructure failures must still surface.
  if (/^(Failed query|connect|read ECONN|Connection)/.test(error.message)) return undefined;
  return "invalid";
}

function backTo(request: RequestedShellContext, path: string, result: CrmResult): never {
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`${path}?${query.toString()}` as Route);
}

async function perform(request: RequestedShellContext, path: string, success: CrmResult, work: (actor: Actor) => Promise<unknown>) {
  let result: CrmResult = success;
  try {
    await work(await actorFor(request));
  } catch (error) {
    const mapped = resultFor(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath("/app/advertisers");
  revalidatePath(path);
  backTo(request, path, result);
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const pounds = (formData: FormData, name: string) => Math.round(Number(text(formData, name) || 0) * 100);

export async function createAdvertiserAction(request: RequestedShellContext, formData: FormData) {
  let createdId: string | undefined;
  let result: CrmResult = "created";
  try {
    const actor = await actorFor(request);
    const created = await createAdvertiserRecord(actor, {
      newOrganisationName: text(formData, "name"),
      owningTerritoryId: text(formData, "territoryId") || actor.territoryId || "",
      source: text(formData, "source")
    });
    createdId = created.id;
  } catch (error) {
    const mapped = resultFor(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath("/app/advertisers");
  backTo(request, createdId ? `/app/advertisers/${createdId}` : "/app/advertisers", result);
}

export async function updateAdvertiserAction(request: RequestedShellContext, advertiserId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) =>
    updateAdvertiserRecord(actor, advertiserId, { status: text(formData, "status") || undefined, notes: text(formData, "notes") })
  );
}

export async function addContactAction(request: RequestedShellContext, advertiserId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) =>
    addContactRecord(actor, advertiserId, {
      label: text(formData, "label") || "Contact",
      name: text(formData, "name"),
      email: text(formData, "email"),
      phone: text(formData, "phone"),
      role: text(formData, "role") || "contact",
      isPrimary: formData.get("isPrimary") === "on"
    })
  );
}

export async function logActivityAction(request: RequestedShellContext, advertiserId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) =>
    logActivityRecord(actor, advertiserId, { activityType: text(formData, "activityType") || "note", title: text(formData, "title"), body: text(formData, "body") })
  );
}

export async function createTaskAction(request: RequestedShellContext, advertiserId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "created", (actor) =>
    createTaskRecord(actor, { advertiserId, opportunityId: text(formData, "opportunityId"), title: text(formData, "title"), notes: text(formData, "notes"), dueOn: text(formData, "dueOn") })
  );
}

export async function changeTaskAction(request: RequestedShellContext, advertiserId: string, taskId: string, step: "complete" | "cancel" | "reopen") {
  if (step !== "complete" && step !== "cancel" && step !== "reopen") throw new Error("Unknown step.");
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) => changeTaskRecord(actor, taskId, step));
}

export async function refreshMetricsAction(request: RequestedShellContext, advertiserId: string) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) => refreshMetricsRecord(actor, advertiserId));
}

export async function createOpportunityAction(request: RequestedShellContext, formData: FormData) {
  await perform(request, "/app/advertisers/pipeline", "created", (actor) =>
    createOpportunityRecord(actor, {
      advertiserId: text(formData, "advertiserId"),
      stageId: text(formData, "stageId"),
      title: text(formData, "title"),
      estimatedValueMinor: pounds(formData, "value"),
      expectedCloseDate: text(formData, "expectedCloseDate"),
      nextAction: text(formData, "nextAction"),
      nextActionDate: text(formData, "nextActionDate")
    })
  );
}

export async function updateOpportunityAction(request: RequestedShellContext, opportunityId: string, formData: FormData) {
  await perform(request, "/app/advertisers/pipeline", "saved", (actor) =>
    updateOpportunityRecord(actor, opportunityId, {
      nextAction: text(formData, "nextAction") || null,
      nextActionDate: text(formData, "nextActionDate") || null,
      expectedCloseDate: text(formData, "expectedCloseDate") || null
    })
  );
}

export async function moveOpportunityStageAction(request: RequestedShellContext, opportunityId: string, formData: FormData) {
  await perform(request, "/app/advertisers/pipeline", "saved", (actor) =>
    moveOpportunityStage(actor, opportunityId, { stageId: text(formData, "stageId"), lostReason: text(formData, "lostReason"), competitor: text(formData, "competitor") })
  );
}

// ----- Selling and billing -----

export async function createProposalAction(request: RequestedShellContext, advertiserId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "created", (actor) => {
    const unit = text(formData, "unitPrice");
    return createProposalRecord(actor, {
      advertiserId,
      opportunityId: text(formData, "opportunityId") || null,
      title: text(formData, "title"),
      validUntil: text(formData, "validUntil"),
      lines: [{
        productId: text(formData, "productId"),
        quantity: Number(text(formData, "quantity") || 1),
        ...(unit ? { unitPriceMinor: Math.round(Number(unit) * 100) } : {}),
        inventorySlotId: text(formData, "inventorySlotId") || null
      }]
    });
  });
}

export async function sendProposalAction(request: RequestedShellContext, advertiserId: string, proposalId: string) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) => sendProposalRecord(actor, proposalId));
}

export async function bookProposalAction(request: RequestedShellContext, advertiserId: string, proposalId: string) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) => bookProposalRecord(actor, proposalId));
}

export async function createInvoiceAction(request: RequestedShellContext, advertiserId: string, bookingId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "created", (actor) =>
    createInvoiceRecord(actor, bookingId, { dueInDays: Number(text(formData, "dueInDays") || 30) })
  );
}

export async function issueInvoiceAction(request: RequestedShellContext, advertiserId: string, invoiceId: string) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) => issueInvoiceRecord(actor, invoiceId));
}

export async function recordPaymentAction(request: RequestedShellContext, advertiserId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "created", (actor) =>
    recordPaymentRecord(actor, {
      advertiserId,
      amountMinor: pounds(formData, "amount"),
      receivedDate: text(formData, "receivedDate"),
      method: text(formData, "method") || "bank_transfer",
      reference: text(formData, "reference"),
      idempotencyKey: text(formData, "token")
    })
  );
}

export async function allocatePaymentAction(request: RequestedShellContext, advertiserId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) =>
    allocatePaymentRecord(actor, { paymentId: text(formData, "paymentId"), invoiceId: text(formData, "invoiceId"), amountMinor: pounds(formData, "amount") })
  );
}

// ----- Artwork, fulfilment, proof packs, renewals -----

const artworkActions: ArtworkStaffAction[] = ["issue_proof", "request_changes", "approve_for_advertiser", "production_ready"];

export async function artworkAction(request: RequestedShellContext, advertiserId: string, requirementId: string, action: ArtworkStaffAction) {
  if (!artworkActions.includes(action)) throw new Error("Unknown artwork action.");
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) => actOnArtwork(actor, requirementId, action));
}

export async function recordFulfilmentAction(request: RequestedShellContext, advertiserId: string, bookingItemId: string, formData: FormData) {
  const status = text(formData, "status");
  if (!["scheduled", "in_progress", "fulfilled", "cancelled"].includes(status)) throw new Error("Unknown status.");
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) =>
    recordFulfilmentRecord(actor, { bookingItemId, status: status as "scheduled" | "in_progress" | "fulfilled" | "cancelled", scheduledOn: text(formData, "scheduledOn") })
  );
}

export async function createProofPackAction(request: RequestedShellContext, advertiserId: string, fulfilmentId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "created", (actor) => createProofPackRecord(actor, fulfilmentId, { deliver: formData.get("deliver") === "on" }));
}

export async function convertRenewalAction(request: RequestedShellContext, advertiserId: string, renewalId: string) {
  await perform(request, `/app/advertisers/${advertiserId}`, "created", (actor) => convertRenewalRecord(actor, renewalId));
}

export async function dismissRenewalAction(request: RequestedShellContext, advertiserId: string, renewalId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) => dismissRenewalRecord(actor, renewalId, text(formData, "reason")));
}
