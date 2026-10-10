"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { bulkActions, parseBulkSelection } from "@raring2go/publishing";
import type { BulkAction } from "@raring2go/publishing";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { runBulkEditionAction } from "../../../../lib/edition-runtime";

const permissionFor: Record<BulkAction, { module: string; action: string }> = {
  submit: { module: "edition", action: "edit" },
  approve: { module: "edition", action: "approve" },
  release: { module: "edition", action: "release" },
  digital: { module: "edition.output", action: "generate_digital" },
  print: { module: "edition.output", action: "generate_print" }
};

/** Runs a bulk action over the ticked editions and reports how many went through. Each edition is authorised on its own. */
export async function bulkEditionAction(request: RequestedShellContext, formData: FormData) {
  const action = String(formData.get("action") ?? "") as BulkAction;
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  if (!bulkActions.includes(action)) {
    query.set("result", "bulk_no_action");
    redirect(`/app/editions?${query.toString()}` as Route);
  }
  const shell = await requireShellPermission(request, permissionFor[action]);
  const { ids, truncated } = parseBulkSelection(formData.getAll("editionIds").map(String));
  if (ids.length === 0) {
    query.set("result", "bulk_none_selected");
    redirect(`/app/editions?${query.toString()}` as Route);
  }
  const outcome = await runBulkEditionAction({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, action, ids);
  revalidatePath("/app/editions");
  query.set("result", "bulk_done");
  query.set("done", String(outcome.succeeded));
  query.set("refused", String(outcome.refused));
  query.set("action", action);
  if (truncated) query.set("capped", "1");
  redirect(`/app/editions?${query.toString()}#queue` as Route);
}
