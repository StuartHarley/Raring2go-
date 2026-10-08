"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { assistantErrorCode } from "../../../../lib/assistants-runtime";
import { generateRoyaltyNotes } from "../../../../lib/assistants-finance";

/** Fixed result codes only: banner text is looked up on the page, never reflected from the URL. */
export async function royaltyNotesAction(request: RequestedShellContext) {
  let result = "ai_done";
  try {
    const shell = await requireShellPermission(request, { module: "finance.royalty_statement", action: "view" });
    await generateRoyaltyNotes({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
  } catch (error) {
    const mapped = assistantErrorCode(error);
    if (mapped) result = mapped;
    else if (error instanceof Error && /needs the network royalty view/.test(error.message)) result = "not_allowed";
    else throw error;
  }
  revalidatePath("/app/finance");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/finance?${query.toString()}#royalty-review` as Route);
}
