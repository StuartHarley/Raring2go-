"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { AiNotConfiguredError, AiRunFailedError, ExternalWorkflowError } from "@raring2go/ai";
import { EventAccessError, EventStateError } from "@raring2go/publishing";
import { PermissionDeniedError } from "@raring2go/permissions";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { approveEventSuggestionAsActor, discoverEvents, rejectEventSuggestionAsActor } from "../../../../../lib/publishing-runtime";
import { appLogger } from "../../../../../lib/logger";

export type DiscoverFormState = { error?: string; summary?: string } | undefined;

const FRIENDLY_PREFIXES = ["AI assist", "AI spend", "Choose a", "The end date", "Territory not found"];

function friendly(error: unknown): string | undefined {
  if (error instanceof AiNotConfiguredError || error instanceof AiRunFailedError || error instanceof ExternalWorkflowError || error instanceof EventStateError) return error.message;
  if (error instanceof EventAccessError || error instanceof PermissionDeniedError) return "You do not have permission to do that.";
  if (error instanceof Error && FRIENDLY_PREFIXES.some((prefix) => error.message.startsWith(prefix))) return error.message;
  return undefined;
}

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "content.event_suggestion", action: "view" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function back(request: RequestedShellContext, extra: Record<string, string> = {}) {
  const query = new URLSearchParams(extra);
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  return `/app/content/events${query.toString() ? `?${query.toString()}` : ""}` as Route;
}

export async function discoverEventsAction(request: RequestedShellContext, _previous: DiscoverFormState, formData: FormData): Promise<DiscoverFormState> {
  try {
    const result = await discoverEvents(await actorFor(request), {
      territoryId: String(formData.get("territoryId") ?? ""),
      from: String(formData.get("from") ?? ""),
      to: String(formData.get("to") ?? ""),
      interests: String(formData.get("interests") ?? "").split(",").filter(Boolean),
      maxResults: Number(formData.get("maxResults") ?? 10)
    });
    revalidatePath("/app/content/events");
    return {
      summary: `Found ${result.created} new suggestion${result.created === 1 ? "" : "s"} for ${result.territoryName}` +
        `${result.duplicates ? `, skipped ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"}` : ""}` +
        `${result.invalid ? `, dropped ${result.invalid} that did not meet the checks (past date, no source, etc.)` : ""}.`
    };
  } catch (error) {
    const message = friendly(error);
    if (message) return { error: message };
    appLogger.error("event discovery failed", { error });
    throw error;
  }
}

export async function approveSuggestionAction(request: RequestedShellContext, suggestionId: string, formData: FormData) {
  let result = "approved";
  try {
    await approveEventSuggestionAsActor(await actorFor(request), suggestionId, String(formData.get("note") ?? "").slice(0, 500) || null);
  } catch (error) {
    if (error instanceof EventAccessError || error instanceof PermissionDeniedError) result = "not_allowed";
    else if (error instanceof EventStateError) result = "wrong_state";
    else throw error;
  }
  revalidatePath("/app/content/events");
  revalidatePath("/app/content");
  redirect(back(request, { result }));
}

export async function rejectSuggestionAction(request: RequestedShellContext, suggestionId: string, formData: FormData) {
  let result = "rejected";
  try {
    await rejectEventSuggestionAsActor(await actorFor(request), suggestionId, String(formData.get("note") ?? "").slice(0, 500) || null);
  } catch (error) {
    if (error instanceof EventAccessError) result = "not_allowed";
    else if (error instanceof EventStateError) result = "wrong_state";
    else throw error;
  }
  revalidatePath("/app/content/events");
  redirect(back(request, { result }));
}
