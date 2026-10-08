"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { JobAccessError, JobStateError, jobSources } from "@raring2go/workflows";
import type { JobSource } from "@raring2go/workflows";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { cancelJobAsActor, retryJobAsActor } from "../../../../../lib/jobs-runtime";

/** Fixed result codes only: the banner text is looked up, never reflected from the URL. */
export type JobActionResult = "retried" | "cancelled" | "not_allowed" | "wrong_state";

/**
 * The session is re-verified here on every call; the job's own territory/organisation
 * is then checked against the actor's grant inside the workflows service. Nothing the
 * browser sends is trusted for scope.
 */
async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "system.jobs", action: "view" });
  return {
    userId: shell.userId,
    organisationId: shell.activeContext.organisationId,
    territoryId: shell.activeContext.territoryId
  };
}

async function perform(request: RequestedShellContext, jobId: string, work: (userContext: Awaited<ReturnType<typeof actorFor>>) => Promise<unknown>, success: JobActionResult) {
  let result: JobActionResult = success;

  try {
    await work(await actorFor(request));
  } catch (error) {
    if (error instanceof JobAccessError) {
      result = "not_allowed";
    } else if (error instanceof JobStateError) {
      result = "wrong_state";
    } else {
      throw error;
    }
  }

  revalidatePath("/app/system/jobs");
  revalidatePath(`/app/system/jobs/${jobId}`);

  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/system/jobs?${query.toString()}` as Route);
}

export async function retryJobAction(request: RequestedShellContext, source: JobSource, jobId: string) {
  // `source` arrives from the browser: accept only known values, never pass it through.
  if (!jobSources.includes(source)) {
    throw new Error("Unknown job source.");
  }
  await perform(request, jobId, (actor) => retryJobAsActor(actor, jobId, source), "retried");
}

export async function cancelJobAction(request: RequestedShellContext, jobId: string) {
  await perform(request, jobId, (actor) => cancelJobAsActor(actor, jobId), "cancelled");
}
