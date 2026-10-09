"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { commitAudienceImport, rollbackAudienceImport } from "../../../../../lib/audience-import-runtime";

/** Fixed result codes only; the banner text is looked up on the page. */
export type ImportResult = "committed" | "rolled_back" | "already_done" | "not_found" | "not_possible";

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "marketing.import", action: "manage" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

async function perform(request: RequestedShellContext, importId: string, success: ImportResult, work: (actor: Awaited<ReturnType<typeof actorFor>>) => Promise<{ alreadyDone: boolean }>) {
  let result: ImportResult = success;
  try {
    const outcome = await work(await actorFor(request));
    if (outcome.alreadyDone) result = "already_done";
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) result = "not_found";
    else if (error instanceof Error && /^Only a/.test(error.message)) result = "not_possible";
    else throw error;
  }
  revalidatePath("/app/audience/import");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/audience/import/${encodeURIComponent(importId)}?${query.toString()}` as Route);
}

export async function commitImportAction(request: RequestedShellContext, importId: string) {
  await perform(request, importId, "committed", (actor) => commitAudienceImport(actor, importId));
}

export async function rollbackImportAction(request: RequestedShellContext, importId: string) {
  await perform(request, importId, "rolled_back", (actor) => rollbackAudienceImport(actor, importId));
}
