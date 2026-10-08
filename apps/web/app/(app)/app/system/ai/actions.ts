"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { AiRunAccessError, AiRunStateError } from "@raring2go/ai";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { decideAiRunAsActor } from "../../../../../lib/ai-runtime";

/** Fixed result codes only: banner text is looked up, never reflected from the URL. */
export type AiDecisionResult = "approved" | "rejected" | "not_allowed" | "wrong_state";

export async function decideAiRunAction(request: RequestedShellContext, runId: string, decision: "approved" | "rejected", formData: FormData) {
  if (decision !== "approved" && decision !== "rejected") throw new Error("Unknown decision.");
  const note = String(formData.get("note") ?? "").slice(0, 500);
  let result: AiDecisionResult = decision;

  try {
    const shell = await requireShellPermission(request, { module: "ai.run", action: "view" });
    await decideAiRunAsActor(
      { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId },
      runId,
      { state: decision, note }
    );
  } catch (error) {
    if (error instanceof AiRunAccessError) result = "not_allowed";
    else if (error instanceof AiRunStateError) result = "wrong_state";
    else throw error;
  }

  revalidatePath("/app/system/ai");
  revalidatePath(`/app/system/ai/${runId}`);
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/system/ai/${runId}?${query.toString()}` as Route);
}
