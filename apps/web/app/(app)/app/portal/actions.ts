"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { PortalAccessError, PortalStateError } from "@raring2go/advertising";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { respondToProofAsAdvertiser, respondToProposalAsAdvertiser } from "../../../../lib/portal-runtime";

/** Fixed result codes only: the banner text is looked up on the page, never reflected from the URL. */
export type PortalResult = "accepted" | "rejected" | "change_requested" | "proof_approved" | "proof_changes" | "not_found" | "not_possible";

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
