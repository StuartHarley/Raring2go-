"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { CompetitionDrawError, CompetitionNotAllowedError, drawCompetitionWinners } from "../../../../../lib/competition-runtime";

/** Draws the winners. Refusals come back as fixed codes; the panel explains each. */
export async function drawWinnersAction(request: RequestedShellContext, contentId: string, formData: FormData) {
  const shell = await requireShellPermission(request, { module: "content", action: "view" });
  const actor = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
  let result = "drawn";
  try {
    await drawCompetitionWinners(actor, contentId, Number(formData.get("winnerCount")));
  } catch (error) {
    if (error instanceof CompetitionDrawError) result = `draw_${error.code}`;
    else if (error instanceof CompetitionNotAllowedError) result = "draw_not_allowed";
    else throw error;
  }
  revalidatePath(`/app/content/${contentId}`);
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/content/${contentId}?${query.toString()}#competition` as Route);
}
