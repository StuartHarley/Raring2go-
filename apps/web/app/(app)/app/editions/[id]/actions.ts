"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { assistantErrorCode } from "../../../../../lib/assistants-runtime";
import { explainPreflightAsActor } from "../../../../../lib/publishing-runtime";

/** Fixed result codes only: banner text is looked up on the page, never reflected from the URL. */
export async function explainPreflightAction(request: RequestedShellContext, editionId: string, preflightResultId: string) {
  let result = "ai_done";
  try {
    const shell = await requireShellPermission(request, { module: "edition", action: "view" });
    await explainPreflightAsActor({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, editionId, preflightResultId);
  } catch (error) {
    const mapped = assistantErrorCode(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath(`/app/editions/${editionId}`);
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/editions/${editionId}?${query.toString()}#preflight` as Route);
}
