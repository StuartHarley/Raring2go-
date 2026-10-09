"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { AccessDeniedError, AccessInputError, AccessStateError } from "@raring2go/access";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { inviteFranchiseStaffAsActor, removeFranchiseStaffAsActor, revokeFranchiseStaffInvitationAsActor } from "../../../../lib/access-runtime";

/** Fixed result codes only; banner text is looked up on the page. The acting franchise comes from the session, never the request. */
export type TeamResult = "invited" | "invited_email_failed" | "removed" | "invitation_revoked" | "not_allowed" | "seat_limit" | "invalid_input" | "wrong_state";

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "franchise.team", action: "manage" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function resultFor(error: unknown): TeamResult | undefined {
  if (error instanceof AccessDeniedError) return "not_allowed";
  if (error instanceof AccessInputError) return "invalid_input";
  if (error instanceof AccessStateError) return /seat limit/i.test(error.message) ? "seat_limit" : "wrong_state";
  return undefined;
}

async function perform(request: RequestedShellContext, success: TeamResult, work: () => Promise<TeamResult | void>) {
  let result: TeamResult = success;
  try {
    result = (await work()) ?? success;
  } catch (error) {
    const mapped = resultFor(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath("/app/team");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/team?${query.toString()}` as Route);
}

export async function inviteStaffAction(request: RequestedShellContext, formData: FormData) {
  await perform(request, "invited", async () => {
    const outcome = await inviteFranchiseStaffAsActor(await actorFor(request), { email: String(formData.get("email") ?? "") });
    return outcome.emailSent ? undefined : "invited_email_failed";
  });
}

export async function removeStaffAction(request: RequestedShellContext, assignmentId: string) {
  await perform(request, "removed", async () => {
    await removeFranchiseStaffAsActor(await actorFor(request), assignmentId);
  });
}

export async function revokeStaffInvitationAction(request: RequestedShellContext, invitationId: string) {
  await perform(request, "invitation_revoked", async () => {
    await revokeFranchiseStaffInvitationAsActor(await actorFor(request), invitationId);
  });
}
