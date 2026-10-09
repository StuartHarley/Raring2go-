"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { assistantErrorCode } from "../../../../../lib/assistants-runtime";
import { queueEditionOutput } from "../../../../../lib/edition-output";
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

/** Queues a print or digital output for the worker; the page shows the job and the finished file. */
export async function generateOutputAction(request: RequestedShellContext, editionId: string, kind: "print" | "digital") {
  if (kind !== "print" && kind !== "digital") throw new Error("Unknown output type.");
  let result = "output_queued";
  const shell = await requireShellPermission(request, { module: "edition.output", action: kind === "print" ? "generate_print" : "generate_digital" });
  try {
    await queueEditionOutput({ territoryEditionId: editionId, kind, actor: { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId } });
  } catch {
    result = "output_not_ready";
  }
  revalidatePath(`/app/editions/${editionId}`);
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/editions/${editionId}?${query.toString()}#outputs` as Route);
}
