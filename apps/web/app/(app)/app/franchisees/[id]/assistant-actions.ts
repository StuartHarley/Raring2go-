"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { assistantErrorCode } from "../../../../../lib/assistants-runtime";
import { generateAgreementComparison, generateFranchiseBriefing } from "../../../../../lib/assistants-franchise";
import { decideAiRunAsActor } from "../../../../../lib/ai-runtime";

/** Fixed result codes only: banner text is looked up on the page, never reflected from the URL. */
async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "franchise", action: "view" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

async function perform(request: RequestedShellContext, franchiseId: string, success: string, work: () => Promise<unknown>) {
  let result = success;
  try {
    await work();
  } catch (error) {
    const mapped = assistantErrorCode(error);
    if (mapped) result = mapped;
    else if (error instanceof Error && /Head Office task|two different versions|not found/.test(error.message)) result = "invalid_input";
    else throw error;
  }
  revalidatePath(`/app/franchisees/${franchiseId}`);
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/franchisees/${franchiseId}?${query.toString()}#franchise-assistant` as Route);
}

export async function briefingAction(request: RequestedShellContext, franchiseId: string) {
  await perform(request, franchiseId, "ai_done", async () => generateFranchiseBriefing(await actorFor(request), franchiseId));
}

export async function compareAgreementsAction(request: RequestedShellContext, franchiseId: string, formData: FormData) {
  await perform(request, franchiseId, "ai_done", async () =>
    generateAgreementComparison(await actorFor(request), franchiseId, { fromVersionId: String(formData.get("from") ?? ""), toVersionId: String(formData.get("to") ?? "") })
  );
}

/** Legal output: a different person from the requester must decide (enforced by the AI gateway, not here). */
export async function decideComparisonAction(request: RequestedShellContext, franchiseId: string, runId: string, decision: "approved" | "rejected") {
  await perform(request, franchiseId, decision === "approved" ? "comparison_reviewed" : "comparison_rejected", async () => {
    if (decision !== "approved" && decision !== "rejected") throw new Error("Unknown decision.");
    await decideAiRunAsActor(await actorFor(request), runId, { state: decision });
  });
}
