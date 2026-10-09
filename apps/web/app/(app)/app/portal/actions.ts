"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { PortalAccessError, PortalStateError } from "@raring2go/advertising";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { respondToProofAsAdvertiser, respondToProposalAsAdvertiser } from "../../../../lib/portal-runtime";
import { PAYMENT_PROVIDERS, PaymentNotAvailableError, PaymentRateLimitedError, createPaymentLinkAsAdvertiser } from "../../../../lib/payments-runtime";
import type { PaymentProviderKey } from "../../../../lib/payments-runtime";

/** Fixed result codes only: the banner text is looked up on the page, never reflected from the URL. */
export type PortalResult = "payment_unavailable" | "accepted" | "rejected" | "change_requested" | "proof_approved" | "proof_changes" | "not_found" | "not_possible";

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "portal.advertiser", action: "view" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId };
}

async function perform(request: RequestedShellContext, work: (actor: Awaited<ReturnType<typeof actorFor>>) => Promise<unknown>, success: PortalResult) {
  let result: PortalResult = success;

  try {
    await work(await actorFor(request));
  } catch (error) {
    if (error instanceof PortalAccessError) result = "not_found";
    else if (error instanceof PortalStateError) result = "not_possible";
    // The domain throws plain errors for rule violations (expired, already answered); show a generic "not possible".
    else if (error instanceof Error && !/^(Failed query|connect|read ECONN)/.test(error.message)) result = "not_possible";
    else throw error;
  }

  revalidatePath("/app/portal");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  redirect(`/app/portal?${query.toString()}` as Route);
}

export async function respondToProposalAction(request: RequestedShellContext, proposalId: string, response: "accepted" | "rejected" | "change_requested") {
  if (!["accepted", "rejected", "change_requested"].includes(response)) throw new Error("Unknown response.");
  await perform(request, (actor) => respondToProposalAsAdvertiser(actor, { proposalId, response }), response);
}

export async function respondToProofAction(request: RequestedShellContext, requirementId: string, decision: "approved" | "changes_requested") {
  if (decision !== "approved" && decision !== "changes_requested") throw new Error("Unknown decision.");
  await perform(request, (actor) => respondToProofAsAdvertiser(actor, { requirementId, decision }), decision === "approved" ? "proof_approved" : "proof_changes");
}

/**
 * Sends the advertiser to the provider's own secure payment page for one of their invoices. Ownership of the invoice is
 * checked from the session's organisation on the server; nothing about the amount comes from the request.
 */
export async function payInvoiceAction(request: RequestedShellContext, invoiceId: string, provider: string) {
  let destination: string | null = null;
  let result: PortalResult = "not_possible";
  try {
    if (!PAYMENT_PROVIDERS.includes(provider as PaymentProviderKey)) throw new PaymentNotAvailableError();
    const link = await createPaymentLinkAsAdvertiser(await actorFor(request), invoiceId, provider as PaymentProviderKey);
    destination = link.url;
  } catch (error) {
    if (error instanceof PaymentNotAvailableError || error instanceof PaymentRateLimitedError) result = "payment_unavailable";
    else if (error instanceof PortalAccessError) result = "not_found";
    else if (error instanceof PortalStateError) result = "not_possible";
    else if (error instanceof Error && !/^(Failed query|connect|read ECONN)/.test(error.message)) result = "not_possible";
    else throw error;
  }
  // Only the provider's own https page is ever followed; anything else goes back to the portal with a fixed message.
  if (destination && /^https:\/\//.test(destination)) redirect(destination as Route);
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  redirect(`/app/portal?${query.toString()}` as Route);
}
