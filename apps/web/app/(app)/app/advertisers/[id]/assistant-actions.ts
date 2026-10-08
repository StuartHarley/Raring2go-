"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { outreachPurposes } from "@raring2go/assistants";
import type { OutreachPurpose } from "@raring2go/assistants";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { decideAiRunAsActor } from "../../../../../lib/ai-runtime";
import { assistantErrorCode } from "../../../../../lib/assistants-runtime";
import { generateAdvertiserBrief, generateOutreachDraft } from "../../../../../lib/assistants-sales";

/** Fixed result codes only: banner text is looked up on the page, never reflected from the URL. */
async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "advertiser", action: "view" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function back(request: RequestedShellContext, advertiserId: string, result: string): Route {
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  return `/app/advertisers/${advertiserId}?${query.toString()}#sales-assistant` as Route;
}

async function perform(request: RequestedShellContext, advertiserId: string, success: string, work: () => Promise<unknown>) {
  let result = success;
  try {
    await work();
  } catch (error) {
    const mapped = assistantErrorCode(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath(`/app/advertisers/${advertiserId}`);
  redirect(back(request, advertiserId, result));
}

export async function generateBriefAction(request: RequestedShellContext, advertiserId: string) {
  await perform(request, advertiserId, "ai_done", async () => generateAdvertiserBrief(await actorFor(request), advertiserId));
}

export async function draftOutreachAction(request: RequestedShellContext, advertiserId: string, formData: FormData) {
  await perform(request, advertiserId, "ai_done", async () => {
    const purpose = String(formData.get("purpose") ?? "") as OutreachPurpose;
    if (!(outreachPurposes as readonly string[]).includes(purpose)) throw new Error("Unknown purpose.");
    const senderName = String(formData.get("senderName") ?? "").trim().slice(0, 80) || "The Raring2go! team";
    await generateOutreachDraft(await actorFor(request), advertiserId, { purpose, senderName, talkingPoints: String(formData.get("talkingPoints") ?? "").trim().slice(0, 1200) || null });
  });
}

/** A person reads the draft and marks it reviewed (approve) or discards it (reject). It is never sent from here. */
export async function decideDraftAction(request: RequestedShellContext, advertiserId: string, runId: string, decision: "approved" | "rejected") {
  await perform(request, advertiserId, decision === "approved" ? "draft_reviewed" : "draft_discarded", async () => {
    if (decision !== "approved" && decision !== "rejected") throw new Error("Unknown decision.");
    await decideAiRunAsActor(await actorFor(request), runId, { state: decision });
  });
}
