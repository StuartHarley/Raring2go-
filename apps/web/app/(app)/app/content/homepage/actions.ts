"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { HomepageTemplateError } from "@raring2go/public";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
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

/** Reads the editor's rows. Anything the form says about ids, sponsored labels or seasonal treatment is ignored: `validateHomepageSlots` owns those. */
export function slotsFromForm(formData: FormData, kinds: string[]) {
  const text = (name: string) => String(formData.get(name) ?? "");
  return kinds
    .map((kind, index) => ({ kind, order: Number(text(`pos-${kind}`)) || index + 1, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ kind }) => ({ kind, heading: text(`heading-${kind}`), visible: formData.get(`show-${kind}`) === "on", itemCount: Number(text(`count-${kind}`)), source: text(`source-${kind}`) }));
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
