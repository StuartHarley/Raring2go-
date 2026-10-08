"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { AnalyticsAccessError, AnalyticsStateError, HealthConfigValidationError } from "@raring2go/analytics";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { activateConfigAsActor, createConfigDraftAsActor, updateConfigDraftAsActor } from "../../../../../lib/analytics-runtime";

export type ConfigFormState = { errors: string[] } | undefined;

const ROWS = 12;

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "analytics.health_config", action: "manage" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function back(request: RequestedShellContext, result?: string) {
  const query = new URLSearchParams();
  if (result) query.set("result", result);
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const suffix = query.toString();
  return `/app/analytics/health${suffix ? `?${suffix}` : ""}` as Route;
}

function describe(error: unknown): string[] | undefined {
  if (error instanceof HealthConfigValidationError) return error.errors;
  if (error instanceof AnalyticsAccessError) return ["You do not have permission to do that."];
  if (error instanceof AnalyticsStateError) return [error.message];
  return undefined;
}

/** Rows with no metric selected are ignored; everything else goes to the server-side validator as-is. */
function parseConfig(formData: FormData) {
  const factors = [];
  for (let index = 0; index < ROWS; index += 1) {
    const metric = String(formData.get(`metric_${index}`) ?? "").trim();
    if (!metric) continue;
    factors.push({
      metric,
      weight: Number(formData.get(`weight_${index}`)),
      bad: Number(formData.get(`bad_${index}`)),
      good: Number(formData.get(`good_${index}`))
    });
  }
  return { factors, thresholds: { green: Number(formData.get("green")), amber: Number(formData.get("amber")) } };
}

const note = (formData: FormData) => String(formData.get("changeNote") ?? "").trim() || null;

export async function saveDraftAction(request: RequestedShellContext, draftId: string | null, _state: ConfigFormState, formData: FormData): Promise<ConfigFormState> {
  try {
    const actor = await actorFor(request);
    const config = parseConfig(formData);
    if (draftId) await updateConfigDraftAsActor(actor, draftId, config, note(formData));
    else await createConfigDraftAsActor(actor, config, note(formData));
  } catch (error) {
    const errors = describe(error);
    if (!errors) throw error;
    return { errors };
  }
  revalidatePath("/app/analytics/health");
  redirect(back(request, draftId ? "draft_saved" : "draft_created"));
}

export async function activateAction(request: RequestedShellContext, configId: string) {
  let result = "activated";
  try {
    await activateConfigAsActor(await actorFor(request), configId);
  } catch (error) {
    if (!describe(error)) throw error;
    result = error instanceof AnalyticsAccessError ? "not_allowed" : "wrong_state";
  }
  revalidatePath("/app/analytics");
  revalidatePath("/app/analytics/health");
  redirect(back(request, result));
}
