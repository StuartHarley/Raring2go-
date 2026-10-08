"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { JobAccessError, JobStateError } from "@raring2go/workflows";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { completeTaskAsActor, decideApprovalAsActor } from "../../../../lib/automation-runtime";

/** Fixed result codes only: banner text is looked up, never reflected from the URL. */
export type TaskActionResult = "task_done" | "approved" | "rejected" | "not_allowed" | "wrong_state";

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "automation.task", action: "view" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

async function perform(request: RequestedShellContext, work: (actor: Awaited<ReturnType<typeof actorFor>>) => Promise<unknown>, success: TaskActionResult) {
  let result: TaskActionResult = success;

  try {
    await work(await actorFor(request));
  } catch (error) {
    if (error instanceof JobAccessError) result = "not_allowed";
    else if (error instanceof JobStateError) result = "wrong_state";
    else throw error;
  }

  revalidatePath("/app/tasks");
  revalidatePath("/app");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/tasks?${query.toString()}` as Route);
}

export async function completeTaskAction(request: RequestedShellContext, taskId: string) {
  await perform(request, (actor) => completeTaskAsActor(actor, taskId), "task_done");
}

export async function decideApprovalAction(request: RequestedShellContext, approvalId: string, decision: "approved" | "rejected", formData: FormData) {
  if (decision !== "approved" && decision !== "rejected") throw new Error("Unknown decision.");
  const note = String(formData.get("note") ?? "").slice(0, 500);
  await perform(request, (actor) => decideApprovalAsActor(actor, approvalId, { status: decision, note }), decision);
}
