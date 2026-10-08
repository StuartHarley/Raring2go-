"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { JobAccessError, JobStateError, WorkflowValidationError } from "@raring2go/workflows";
import { requireShellPermission } from "../../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../../lib/app-shell";
import {
  activateWorkflowDraft,
  createWorkflowDraft,
  saveWorkflowDraft,
  setWorkflowDefinitionEnabled,
  testWorkflowDraft
} from "../../../../../../lib/automation-runtime";

export type EditorState = { errors: string[]; message?: string; testRunId?: string } | undefined;

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "automation.workflow", action: "view" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function back(request: RequestedShellContext, definitionId: string, result?: string) {
  const query = new URLSearchParams();
  if (result) query.set("result", result);
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const suffix = query.toString();
  return `/app/system/workflows/${definitionId}${suffix ? `?${suffix}` : ""}` as Route;
}

/** Expected domain failures become user-facing messages; anything else is a real error. */
function describe(error: unknown): string[] | undefined {
  if (error instanceof WorkflowValidationError) return error.errors;
  if (error instanceof JobAccessError) return ["You do not have permission to do that."];
  if (error instanceof JobStateError) return [error.message];
  return undefined;
}

function parseDefinition(formData: FormData): { definition?: unknown; errors: string[] } {
  try {
    return { definition: JSON.parse(String(formData.get("definition") ?? "")), errors: [] };
  } catch {
    return { errors: ["The workflow could not be read. Reload the page and try again."] };
  }
}

function parseSample(formData: FormData): { payload?: Record<string, unknown>; errors: string[] } {
  const raw = String(formData.get("samplePayload") ?? "").trim();
  if (!raw) return { payload: {}, errors: [] };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { errors: ["The sample event must be a JSON object."] };
    return { payload: value as Record<string, unknown>, errors: [] };
  } catch {
    return { errors: ["The sample event is not valid JSON."] };
  }
}

/** One form, three intents: save, test (saves first), activate (saves first). */
export async function saveDraftAction(request: RequestedShellContext, definitionId: string, versionId: string, _previous: EditorState, formData: FormData): Promise<EditorState> {
  const intent = String(formData.get("intent") ?? "save");
  const parsed = parseDefinition(formData);
  if (parsed.errors.length > 0) return { errors: parsed.errors };

  try {
    const actor = await actorFor(request);
    await saveWorkflowDraft(actor, versionId, parsed.definition, String(formData.get("changeNote") ?? "") || null);

    if (intent === "test") {
      const sample = parseSample(formData);
      if (sample.errors.length > 0) return { errors: sample.errors };
      const subjectId = String(formData.get("sampleSubjectId") ?? "").trim();
      const result = await testWorkflowDraft(actor, versionId, { payload: sample.payload ?? {}, subjectId: /^[0-9a-f-]{36}$/i.test(subjectId) ? subjectId : null });
      revalidatePath(`/app/system/workflows/${definitionId}`);
      return { errors: [], message: "Draft saved and test run completed. Nothing was sent or changed.", testRunId: result.run.id };
    }

    if (intent === "activate") {
      await activateWorkflowDraft(actor, versionId);
    } else {
      revalidatePath(`/app/system/workflows/${definitionId}`);
      return { errors: [], message: "Draft saved." };
    }
  } catch (error) {
    const messages = describe(error);
    if (messages) return { errors: messages };
    throw error;
  }

  revalidatePath("/app/system/workflows");
  revalidatePath(`/app/system/workflows/${definitionId}`);
  redirect(back(request, definitionId, "activated"));
}

async function simple(request: RequestedShellContext, definitionId: string, work: (actor: Awaited<ReturnType<typeof actorFor>>) => Promise<unknown>, success: string) {
  let result = success;
  try {
    await work(await actorFor(request));
  } catch (error) {
    if (error instanceof JobAccessError) result = "not_allowed";
    else if (error instanceof JobStateError) result = "wrong_state";
    else throw error;
  }
  revalidatePath("/app/system/workflows");
  revalidatePath(`/app/system/workflows/${definitionId}`);
  redirect(back(request, definitionId, result));
}

export async function createDraftAction(request: RequestedShellContext, definitionId: string) {
  await simple(request, definitionId, (actor) => createWorkflowDraft(actor, definitionId), "draft_created");
}

export async function toggleWorkflowAction(request: RequestedShellContext, definitionId: string, enabled: boolean) {
  await simple(request, definitionId, (actor) => setWorkflowDefinitionEnabled(actor, definitionId, Boolean(enabled)), enabled ? "enabled" : "disabled");
}
