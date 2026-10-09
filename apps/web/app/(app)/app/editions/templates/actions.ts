"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { TemplateSpecError } from "@raring2go/publishing";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { approveTemplateVersionAsActor, createTemplateAsActor, publishTemplateVersionAsActor, reviseTemplateAsActor } from "../../../../../lib/edition-runtime";
import { templateSpecFromForm } from "./template-form";

function back(request: RequestedShellContext, path: string, result: string): never {
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`${path}?${query.toString()}` as Route);
}

async function actorFor(request: RequestedShellContext, action: "create" | "edit" | "approve" | "publish") {
  const shell = await requireShellPermission(request, { module: "edition.template", action });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

export async function createTemplateAction(request: RequestedShellContext, formData: FormData) {
  const actor = await actorFor(request, "create");
  let id: string;
  try {
    id = await createTemplateAsActor(actor, { key: String(formData.get("key") ?? ""), name: String(formData.get("name") ?? ""), category: String(formData.get("category") ?? "article"), spec: templateSpecFromForm(formData) });
  } catch (error) {
    if (error instanceof TemplateSpecError) back(request, "/app/editions/templates/new", error.code);
    if (error instanceof Error && /already exists/.test(error.message)) back(request, "/app/editions/templates/new", "template_exists");
    if (error instanceof Error && /Template zone/.test(error.message)) back(request, "/app/editions/templates/new", "zone_geometry");
    throw error;
  }
  revalidatePath("/app/editions/templates");
  void id;
  back(request, "/app/editions/templates", "template_created");
}

export async function reviseTemplateAction(request: RequestedShellContext, templateId: string, formData: FormData) {
  const actor = await actorFor(request, "edit");
  try {
    await reviseTemplateAsActor(actor, templateId, templateSpecFromForm(formData));
  } catch (error) {
    if (error instanceof TemplateSpecError) back(request, `/app/editions/templates/${templateId}/revise`, error.code);
    if (error instanceof Error && /Template zone/.test(error.message)) back(request, `/app/editions/templates/${templateId}/revise`, "zone_geometry");
    throw error;
  }
  revalidatePath("/app/editions/templates");
  back(request, "/app/editions/templates", "revision_created");
}

export async function approveTemplateVersionAction(request: RequestedShellContext, versionId: string) {
  const actor = await actorFor(request, "approve");
  await approveTemplateVersionAsActor(actor, versionId);
  revalidatePath("/app/editions/templates");
  back(request, "/app/editions/templates", "version_approved");
}

export async function publishTemplateVersionAction(request: RequestedShellContext, versionId: string) {
  const actor = await actorFor(request, "publish");
  await publishTemplateVersionAsActor(actor, versionId);
  revalidatePath("/app/editions/templates");
  back(request, "/app/editions/templates", "version_published");
}
