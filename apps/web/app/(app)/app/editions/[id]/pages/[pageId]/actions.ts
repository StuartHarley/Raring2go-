"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../../../lib/app-shell";
import {
  applyPreflightFixesAsActor,
  approvePageAsActor,
  readStudioPage,
  returnPageAsActor,
  runPreflightAsActor,
  savePageAsActor,
  snapshotFromForm,
  submitPageAsActor
} from "../../../../../../../lib/edition-runtime";
import { resolveSnapshotImages } from "../../../../../../../lib/studio-images";

async function actor(request: RequestedShellContext, module: string, action: string) {
  const shell = await requireShellPermission(request, { module, action });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

async function save(request: RequestedShellContext, editionId: string, pageId: string, formData: FormData) {
  const who = await actor(request, "edition.content", "edit_local");
  const studio = await readStudioPage(who, editionId, pageId);
  if (!studio.layout) throw new Error("Assign a template to this page first.");
  const snapshot = await resolveSnapshotImages(who, editionId, snapshotFromForm(formData, studio.layout.zones.map((zone) => ({ id: zone.id, kind: zone.kind }))));
  const { revision } = await savePageAsActor(who, pageId, snapshot);
  return revision.warnings.length;
}

/** Called by the autosave script as the editor types. Returns a fixed status; the page shows the warnings after a reload. */
export async function autosavePageAction(request: RequestedShellContext, editionId: string, pageId: string, formData: FormData): Promise<{ status: "saved" | "refused"; warnings: number }> {
  try {
    return { status: "saved", warnings: await save(request, editionId, pageId, formData) };
  } catch {
    return { status: "refused", warnings: 0 };
  }
}

function back(request: RequestedShellContext, editionId: string, pageId: string, result: string): never {
  revalidatePath(`/app/editions/${editionId}/pages/${pageId}`);
  revalidatePath(`/app/editions/${editionId}`);
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/editions/${editionId}/pages/${pageId}?${query.toString()}` as Route);
}

/** Save, then submit for HQ review. Page warnings stop the submission with a fixed code. */
export async function saveAndSubmitAction(request: RequestedShellContext, editionId: string, pageId: string, formData: FormData) {
  try {
    await save(request, editionId, pageId, formData);
    await submitPageAsActor(await actor(request, "edition.content", "edit_local"), pageId);
  } catch {
    back(request, editionId, pageId, "submit_refused");
  }
  back(request, editionId, pageId, "submitted");
}

export async function saveOnlyAction(request: RequestedShellContext, editionId: string, pageId: string, formData: FormData) {
  try {
    await save(request, editionId, pageId, formData);
  } catch {
    back(request, editionId, pageId, "save_refused");
  }
  back(request, editionId, pageId, "saved");
}

export async function approvePageAction(request: RequestedShellContext, editionId: string, pageId: string) {
  try {
    await approvePageAsActor(await actor(request, "edition", "approve"), pageId);
  } catch {
    back(request, editionId, pageId, "approve_refused");
  }
  back(request, editionId, pageId, "approved");
}

export async function returnPageAction(request: RequestedShellContext, editionId: string, pageId: string, formData: FormData) {
  try {
    await returnPageAsActor(await actor(request, "edition", "approve"), pageId, String(formData.get("comment") ?? ""));
  } catch {
    back(request, editionId, pageId, "return_refused");
  }
  back(request, editionId, pageId, "returned");
}

export async function runPreflightAction(request: RequestedShellContext, editionId: string, pageId: string) {
  try {
    await runPreflightAsActor(await actor(request, "edition.preflight", "override"), pageId);
  } catch {
    back(request, editionId, pageId, "preflight_refused");
  }
  back(request, editionId, pageId, "preflight_run");
}

export async function applyFixesAction(request: RequestedShellContext, editionId: string, pageId: string, resultId: string) {
  try {
    await applyPreflightFixesAsActor(await actor(request, "edition.preflight", "override"), resultId);
  } catch {
    back(request, editionId, pageId, "fix_refused");
  }
  back(request, editionId, pageId, "fixes_applied");
}
