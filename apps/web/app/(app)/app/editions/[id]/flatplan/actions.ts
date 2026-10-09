"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../../lib/app-shell";
import { assignPageAsActor, createLocalContentAsActor, movePageAsActor } from "../../../../../../lib/edition-runtime";

function back(request: RequestedShellContext, editionId: string, result: string, anchor = ""): never {
  revalidatePath(`/app/editions/${editionId}/flatplan`);
  revalidatePath(`/app/editions/${editionId}`);
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/editions/${editionId}/flatplan?${query.toString()}${anchor}` as Route);
}

async function actor(request: RequestedShellContext, module: string, action: string) {
  const shell = await requireShellPermission(request, { module, action });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

/** Fixed codes only. A refusal (locked page, other territory, unpublished template) is reported, never explained with user text. */
export async function assignPageAction(request: RequestedShellContext, editionId: string, pageId: string, formData: FormData) {
  const who = await actor(request, "edition.page", "edit");
  const templateVersionId = String(formData.get("templateVersionId") ?? "") || null;
  const assignedContentId = String(formData.get("assignedContentId") ?? "") || null;
  try {
    await assignPageAsActor(who, pageId, { templateVersionId, assignedContentId });
  } catch {
    back(request, editionId, "page_refused", `#page-${pageId}`);
  }
  back(request, editionId, "page_saved", `#page-${pageId}`);
}

export async function movePageAction(request: RequestedShellContext, editionId: string, pageId: string, direction: "up" | "down") {
  if (direction !== "up" && direction !== "down") throw new Error("Unknown direction.");
  const who = await actor(request, "edition.page", "edit");
  try {
    await movePageAsActor(who, editionId, pageId, direction);
  } catch {
    back(request, editionId, "move_refused", `#page-${pageId}`);
  }
  back(request, editionId, "page_moved", `#page-${pageId}`);
}

export async function createContentAction(request: RequestedShellContext, editionId: string, formData: FormData) {
  const who = await actor(request, "edition.content", "edit_local");
  const text = (name: string) => String(formData.get(name) ?? "");
  try {
    await createLocalContentAsActor(who, editionId, { title: text("title"), contentType: text("contentType"), headline: text("headline"), body: text("body") });
  } catch {
    back(request, editionId, "content_refused", "#content");
  }
  back(request, editionId, "content_created", "#content");
}
