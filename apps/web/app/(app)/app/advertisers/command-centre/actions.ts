"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { assistantErrorCode } from "../../../../../lib/assistants-runtime";
import { acceptSuggestedMatch, generateChaseNotes } from "../../../../../lib/assistants-finance";

/** Fixed result codes only: banner text is looked up on the page, never reflected from the URL. */
async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "advertiser.analytics", action: "view" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

async function perform(request: RequestedShellContext, success: string, work: () => Promise<unknown>) {
  let result = success;
  try {
    await work();
  } catch (error) {
    const mapped = assistantErrorCode(error);
    if (mapped) result = mapped;
    else if (error instanceof Error && /no longer a suggested match/.test(error.message)) result = "match_stale";
    else if (error instanceof Error && /Missing permission|outside/.test(error.message)) result = "not_allowed";
    else throw error;
  }
  revalidatePath("/app/advertisers/command-centre");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/advertisers/command-centre?${query.toString()}#debt-assistant` as Route);
}

export async function chaseNotesAction(request: RequestedShellContext) {
  await perform(request, "ai_done", async () => generateChaseNotes(await actorFor(request)));
}

/** Accepting a suggested match is the normal, permissioned, audited allocation: it needs advertiser.payment.allocate. */
export async function acceptMatchAction(request: RequestedShellContext, paymentId: string) {
  await perform(request, "match_applied", async () => acceptSuggestedMatch(await actorFor(request), { paymentId }));
}
