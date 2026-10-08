"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { AiRunAccessError, AiRunFailedError, AiRunStateError } from "@raring2go/ai";
import { PermissionDeniedError } from "@raring2go/permissions";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { acceptContentDraft, rejectContentDraft, requestContentDraft } from "../../../../lib/publishing-runtime";
import { appLogger } from "../../../../lib/logger";

export type DraftFormState = { error?: string } | undefined;

// Messages from our own guard rails are written for users; anything else is not shown.
const FRIENDLY = ["AI assist", "AI spend", "Write a little", "Keep the brief", "Choose a content", "Only draft content", "This draft was already", "This AI run"];

function friendly(error: unknown): string | undefined {
  if (error instanceof AiRunFailedError || error instanceof AiRunStateError) return error.message;
  if (error instanceof AiRunAccessError || error instanceof PermissionDeniedError) return "You do not have permission to do that.";
  if (error instanceof Error && FRIENDLY.some((prefix) => error.message.startsWith(prefix))) return error.message;
  return undefined;
}

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "content", action: "view" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function withSession(path: string, request: RequestedShellContext, extra: Record<string, string> = {}) {
  const query = new URLSearchParams(extra);
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  return (query.toString() ? `${path}?${query.toString()}` : path) as Route;
}

/** Create-or-revise: `contentItemId` set means "revise this draft". */
export async function generateContentDraftAction(request: RequestedShellContext, contentItemId: string | null, _previous: DraftFormState, formData: FormData): Promise<DraftFormState> {
  let runId: string;

  try {
    const run = await requestContentDraft(await actorFor(request), {
      brief: String(formData.get("brief") ?? ""),
      contentType: String(formData.get("contentType") ?? "article"),
      contentItemId
    });
    runId = run.id;
  } catch (error) {
    const message = friendly(error);
    if (message) return { error: message };
    appLogger.error("content draft generation failed", { error });
    throw error;
  }

  redirect(withSession(`/app/content/drafts/${runId}`, request));
}

export async function acceptContentDraftAction(request: RequestedShellContext, runId: string) {
  let contentItemId: string;

  try {
    ({ contentItemId } = await acceptContentDraft(await actorFor(request), runId));
  } catch (error) {
    if (!friendly(error)) throw error;
    // Fixed result codes only: the banner text is looked up on the review page.
    const code = error instanceof AiRunAccessError || error instanceof PermissionDeniedError ? "not_allowed" : "wrong_state";
    redirect(withSession(`/app/content/drafts/${runId}`, request, { result: code }));
  }

  revalidatePath("/app/content");
  revalidatePath(`/app/content/${contentItemId}`);
  revalidatePath("/app/system/ai");
  redirect(withSession(`/app/content/${contentItemId}`, request));
}

export async function rejectContentDraftAction(request: RequestedShellContext, runId: string) {
  try {
    await rejectContentDraft(await actorFor(request), runId);
  } catch (error) {
    if (!friendly(error)) throw error;
  }
  revalidatePath("/app/system/ai");
  redirect(withSession("/app/content", request));
}
