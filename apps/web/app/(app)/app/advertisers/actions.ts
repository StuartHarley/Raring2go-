"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import {
  DuplicateAdvertiserError,
  addContactRecord,
  createAdvertiserRecord,
  createOpportunityRecord,
  logActivityRecord,
  moveOpportunityStage,
  refreshMetricsRecord,
  updateAdvertiserRecord,
  updateOpportunityRecord
} from "../../../../lib/advertising-mutations";

/**
 * Staff advertiser CRM actions. The signed-in actor is resolved here on the server; the domain then
 * checks the exact permission and territory scope. Result codes are fixed, so banner text is looked
 * up on the page and never reflected from the URL.
 */
export type CrmResult = "created" | "saved" | "duplicate" | "not_allowed" | "invalid";

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "advertiser", action: "view" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

type Actor = Awaited<ReturnType<typeof actorFor>>;

function resultFor(error: unknown): CrmResult | undefined {
  if (error instanceof DuplicateAdvertiserError) return "duplicate";
  if (!(error instanceof Error)) return undefined;
  if (/Missing permission|outside|not permitted|cannot access|scope/i.test(error.message)) return "not_allowed";
  // Rule violations thrown by the domain read as plain messages; infrastructure failures must still surface.
  if (/^(Failed query|connect|read ECONN|Connection)/.test(error.message)) return undefined;
  return "invalid";
}

function backTo(request: RequestedShellContext, path: string, result: CrmResult): never {
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`${path}?${query.toString()}` as Route);
}

async function perform(request: RequestedShellContext, path: string, success: CrmResult, work: (actor: Actor) => Promise<unknown>) {
  let result: CrmResult = success;
  try {
    await work(await actorFor(request));
  } catch (error) {
    const mapped = resultFor(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath("/app/advertisers");
  revalidatePath(path);
  backTo(request, path, result);
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const pounds = (formData: FormData, name: string) => Math.round(Number(text(formData, name) || 0) * 100);

export async function createAdvertiserAction(request: RequestedShellContext, formData: FormData) {
  let createdId: string | undefined;
  let result: CrmResult = "created";
  try {
    const actor = await actorFor(request);
    const created = await createAdvertiserRecord(actor, {
      newOrganisationName: text(formData, "name"),
      owningTerritoryId: text(formData, "territoryId") || actor.territoryId || "",
      source: text(formData, "source")
    });
    createdId = created.id;
  } catch (error) {
    const mapped = resultFor(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath("/app/advertisers");
  backTo(request, createdId ? `/app/advertisers/${createdId}` : "/app/advertisers", result);
}

export async function updateAdvertiserAction(request: RequestedShellContext, advertiserId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) =>
    updateAdvertiserRecord(actor, advertiserId, { status: text(formData, "status") || undefined, notes: text(formData, "notes") })
  );
}

export async function addContactAction(request: RequestedShellContext, advertiserId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) =>
    addContactRecord(actor, advertiserId, {
      label: text(formData, "label") || "Contact",
      name: text(formData, "name"),
      email: text(formData, "email"),
      phone: text(formData, "phone"),
      role: text(formData, "role") || "contact",
      isPrimary: formData.get("isPrimary") === "on"
    })
  );
}

export async function logActivityAction(request: RequestedShellContext, advertiserId: string, formData: FormData) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) =>
    logActivityRecord(actor, advertiserId, { activityType: text(formData, "activityType") || "note", title: text(formData, "title"), body: text(formData, "body") })
  );
}

export async function refreshMetricsAction(request: RequestedShellContext, advertiserId: string) {
  await perform(request, `/app/advertisers/${advertiserId}`, "saved", (actor) => refreshMetricsRecord(actor, advertiserId));
}

export async function createOpportunityAction(request: RequestedShellContext, formData: FormData) {
  await perform(request, "/app/advertisers/pipeline", "created", (actor) =>
    createOpportunityRecord(actor, {
      advertiserId: text(formData, "advertiserId"),
      stageId: text(formData, "stageId"),
      title: text(formData, "title"),
      estimatedValueMinor: pounds(formData, "value"),
      expectedCloseDate: text(formData, "expectedCloseDate"),
      nextAction: text(formData, "nextAction"),
      nextActionDate: text(formData, "nextActionDate")
    })
  );
}

export async function updateOpportunityAction(request: RequestedShellContext, opportunityId: string, formData: FormData) {
  await perform(request, "/app/advertisers/pipeline", "saved", (actor) =>
    updateOpportunityRecord(actor, opportunityId, {
      nextAction: text(formData, "nextAction") || null,
      nextActionDate: text(formData, "nextActionDate") || null,
      expectedCloseDate: text(formData, "expectedCloseDate") || null
    })
  );
}

export async function moveOpportunityStageAction(request: RequestedShellContext, opportunityId: string, formData: FormData) {
  await perform(request, "/app/advertisers/pipeline", "saved", (actor) =>
    moveOpportunityStage(actor, opportunityId, { stageId: text(formData, "stageId"), lostReason: text(formData, "lostReason"), competitor: text(formData, "competitor") })
  );
}
