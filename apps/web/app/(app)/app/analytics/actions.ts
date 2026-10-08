"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { AnalyticsAccessError } from "@raring2go/analytics";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { generateSnapshotAsActor } from "../../../../lib/analytics-runtime";

/** Fixed result codes only: banner text is looked up, never reflected from the URL. */
export async function generateSnapshotAction(request: RequestedShellContext) {
  let result = "snapshot_generated";
  try {
    const shell = await requireShellPermission(request, { module: "analytics.snapshot", action: "generate" });
    await generateSnapshotAsActor({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
  } catch (error) {
    if (!(error instanceof AnalyticsAccessError)) throw error;
    result = "not_allowed";
  }
  revalidatePath("/app/analytics");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/analytics?${query.toString()}` as Route);
}
