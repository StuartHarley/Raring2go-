"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { SeasonSpecError } from "@raring2go/publishing";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { approveMasterAsActor, createSeasonAsActor, generateEditionsAsActor } from "../../../../../lib/edition-runtime";

function back(request: RequestedShellContext, result: string): never {
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/editions/seasons?${query.toString()}` as Route);
}

async function actorFor(request: RequestedShellContext, action: "create" | "approve") {
  const shell = await requireShellPermission(request, { module: "edition", action });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

export async function createSeasonAction(request: RequestedShellContext, formData: FormData) {
  const actor = await actorFor(request, "create");
  const text = (name: string) => String(formData.get(name) ?? "");
  try {
    await createSeasonAsActor(actor, {
      key: text("key"), name: text("name"), year: text("year"), season: text("season"), accent: text("accent"), pageCount: text("pageCount"),
      bookingDeadline: text("bookingDeadline"), artworkDeadline: text("artworkDeadline"), editorialDeadline: text("editorialDeadline"),
      proofDeadline: text("proofDeadline"), printDeadline: text("printDeadline"), distributionDate: text("distributionDate"), publicationDate: text("publicationDate")
    });
  } catch (error) {
    if (error instanceof SeasonSpecError) back(request, error.code);
    if (error instanceof Error && /already exists/.test(error.message)) back(request, "season_exists");
    throw error;
  }
  revalidatePath("/app/editions/seasons");
  back(request, "season_created");
}

export async function approveMasterAction(request: RequestedShellContext, masterId: string) {
  const actor = await actorFor(request, "approve");
  await approveMasterAsActor(actor, masterId);
  revalidatePath("/app/editions/seasons");
  back(request, "master_approved");
}

export async function generateEditionsAction(request: RequestedShellContext, masterId: string, formData: FormData) {
  const actor = await actorFor(request, "create");
  const territoryIds = formData.getAll("territoryIds").map(String).filter(Boolean);
  if (territoryIds.length === 0) back(request, "no_territories");
  const created = await generateEditionsAsActor(actor, masterId, territoryIds);
  revalidatePath("/app/editions");
  revalidatePath("/app/editions/seasons");
  back(request, created.length > 0 ? "editions_generated" : "editions_exist");
}
