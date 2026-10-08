"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { PrivacyAccessError, PrivacyInputError, PrivacyStateError } from "@raring2go/security";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { createRequestAsActor, decideErasureAsActor } from "../../../../lib/privacy-runtime";

/** Fixed result codes only: banner text is looked up, never reflected from the URL. */
async function actorFor(request: RequestedShellContext, module: string, action: string) {
  const shell = await requireShellPermission(request, { module, action });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function back(request: RequestedShellContext, result: string): Route {
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  return `/app/privacy?${query.toString()}` as Route;
}

function resultFor(error: unknown): string | undefined {
  if (error instanceof PrivacyAccessError) return "not_allowed";
  if (error instanceof PrivacyInputError) return "invalid_input";
  if (error instanceof PrivacyStateError) return /different person/.test(error.message) ? "needs_second_person" : "wrong_state";
  return undefined;
}

export async function openRequestAction(request: RequestedShellContext, formData: FormData) {
  let result = "opened";
  try {
    const actor = await actorFor(request, "privacy.request", "create");
    const kind = String(formData.get("kind") ?? "");
    const created = await createRequestAsActor(actor, { kind: kind as "export" | "erasure", email: String(formData.get("email") ?? ""), note: String(formData.get("note") ?? "") || null });
    result = created.created ? "opened" : "already_open";
  } catch (error) {
    const mapped = resultFor(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath("/app/privacy");
  redirect(back(request, result));
}

export async function decideAction(request: RequestedShellContext, requestId: string, decision: "approve" | "reject", formData: FormData) {
  let result = decision === "approve" ? "erased" : "rejected";
  try {
    if (decision !== "approve" && decision !== "reject") throw new PrivacyInputError("Unknown decision.");
    const actor = await actorFor(request, "privacy.request", "decide");
    await decideErasureAsActor(actor, requestId, decision, String(formData.get("note") ?? "") || null);
  } catch (error) {
    const mapped = resultFor(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath("/app/privacy");
  redirect(back(request, result));
}
