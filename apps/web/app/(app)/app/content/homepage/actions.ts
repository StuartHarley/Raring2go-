"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { HomepageTemplateError } from "@raring2go/public";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { slotsFromForm } from "./form";
import { HomepageStateError, discardHomepageDraft, publishHomepageDraft, saveHomepageDraft, startHomepageDraftFrom } from "../../../../../lib/homepage-template-runtime";

async function actor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "public.homepage", action: "manage" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function back(request: RequestedShellContext, result: string): never {
  revalidatePath("/app/content/homepage");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/content/homepage?${query.toString()}` as Route);
}

export async function saveDraftAction(request: RequestedShellContext, kinds: string[], formData: FormData) {
  const who = await actor(request);
  try {
    await saveHomepageDraft(who, slotsFromForm(formData, kinds), String(formData.get("notes") ?? ""));
  } catch (error) {
    if (error instanceof HomepageTemplateError) back(request, error.code);
    throw error;
  }
  back(request, "draft_saved");
}

export async function publishDraftAction(request: RequestedShellContext, versionId: string) {
  const who = await actor(request);
  try {
    await publishHomepageDraft(who, versionId);
  } catch (error) {
    if (error instanceof HomepageStateError) back(request, error.code);
    if (error instanceof HomepageTemplateError) back(request, error.code);
    throw error;
  }
  revalidatePath("/areas", "layout");
  back(request, "published");
}

export async function discardDraftAction(request: RequestedShellContext, versionId: string) {
  const who = await actor(request);
  try {
    await discardHomepageDraft(who, versionId);
  } catch (error) {
    if (error instanceof HomepageStateError) back(request, error.code);
    throw error;
  }
  back(request, "discarded");
}

export async function startFromVersionAction(request: RequestedShellContext, versionId: string) {
  const who = await actor(request);
  try {
    await startHomepageDraftFrom(who, versionId);
  } catch (error) {
    if (error instanceof HomepageStateError) back(request, error.code);
    throw error;
  }
  back(request, "draft_saved");
}
