"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { AccessDeniedError, AccessEscalationError, AccessInputError, AccessStateError, AdministratorRequiredError } from "@raring2go/access";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { addRoleGrantAsActor, assignRoleAsActor, createRoleAsActor, deleteRoleAsActor, inviteUserAsActor, removeRoleGrantAsActor, revokeAssignmentAsActor, revokeInvitationAsActor } from "../../../../lib/access-runtime";
import { directoryLookupByEmail } from "./lookup";

/** Fixed result codes only: banner text is looked up on the page, never reflected from the URL. */
async function actorFor(request: RequestedShellContext, action: "view" | "manage" | "assign" | "invite") {
  const shell = await requireShellPermission(request, { module: "roles", action });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function target(request: RequestedShellContext, path: string, result: string): Route {
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  return `${path}?${query.toString()}` as Route;
}

function resultFor(error: unknown): string | undefined {
  if (error instanceof AdministratorRequiredError) return "last_administrator";
  if (error instanceof AccessEscalationError) return "escalation";
  if (error instanceof AccessDeniedError) return "not_allowed";
  if (error instanceof AccessInputError) return "invalid_input";
  if (error instanceof AccessStateError) return "wrong_state";
  return undefined;
}

async function perform(request: RequestedShellContext, path: string, success: string, work: () => Promise<unknown>) {
  let result = success;
  try {
    await work();
  } catch (error) {
    const mapped = resultFor(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath("/app/roles");
  redirect(target(request, path, result));
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

/** A "where" value is either an organisation id, or `organisationId:territoryId`. */
function parseWhere(value: string): { organisationId: string; territoryId: string | null } {
  const [organisationId = "", territoryId] = value.split(":");
  return { organisationId, territoryId: territoryId || null };
}

export async function createRoleAction(request: RequestedShellContext, formData: FormData) {
  await perform(request, "/app/roles", "role_created", async () => createRoleAsActor(await actorFor(request, "manage"), { key: text(formData, "key"), name: text(formData, "name"), description: text(formData, "description") || null }));
}

export async function addGrantAction(request: RequestedShellContext, roleId: string, formData: FormData) {
  await perform(request, `/app/roles/${roleId}`, "grant_added", async () => addRoleGrantAsActor(await actorFor(request, "manage"), { roleId, permissionId: text(formData, "permissionId"), scope: text(formData, "scope") }));
}

export async function removeGrantAction(request: RequestedShellContext, roleId: string, permissionId: string, scope: string) {
  await perform(request, `/app/roles/${roleId}`, "grant_removed", async () => removeRoleGrantAsActor(await actorFor(request, "manage"), { roleId, permissionId, scope }));
}

export async function deleteRoleAction(request: RequestedShellContext, roleId: string) {
  let result = "role_deleted";
  try {
    await deleteRoleAsActor(await actorFor(request, "manage"), roleId);
  } catch (error) {
    const mapped = resultFor(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath("/app/roles");
  redirect(target(request, result === "role_deleted" ? "/app/roles" : `/app/roles/${roleId}`, result));
}

export async function assignRoleAction(request: RequestedShellContext, formData: FormData) {
  await perform(request, "/app/roles", "assigned", async () => {
    const actor = await actorFor(request, "assign");
    const where = parseWhere(text(formData, "where"));
    const person = await directoryLookupByEmail(text(formData, "email"));
    if (!person) throw new AccessStateError("No account with that email address exists yet.");
    const endsRaw = text(formData, "endsAt");
    await assignRoleAsActor(actor, { userId: person.id, roleId: text(formData, "roleId"), organisationId: where.organisationId, territoryId: where.territoryId, endsAt: endsRaw ? new Date(`${endsRaw}T23:59:59Z`) : null });
  });
}

export async function revokeAssignmentAction(request: RequestedShellContext, assignmentId: string) {
  await perform(request, "/app/roles", "revoked", async () => revokeAssignmentAsActor(await actorFor(request, "assign"), assignmentId));
}

export async function inviteAction(request: RequestedShellContext, formData: FormData) {
  let result = "invited";
  try {
    const where = parseWhere(text(formData, "where"));
    const outcome = await inviteUserAsActor(await actorFor(request, "invite"), { email: text(formData, "email"), organisationId: where.organisationId, territoryId: where.territoryId, roleId: text(formData, "roleId") || null });
    if (!outcome.emailSent) result = "invited_email_failed";
  } catch (error) {
    const mapped = resultFor(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath("/app/roles");
  redirect(target(request, "/app/roles", result));
}

export async function revokeInvitationAction(request: RequestedShellContext, invitationId: string) {
  await perform(request, "/app/roles", "invitation_revoked", async () => revokeInvitationAsActor(await actorFor(request, "invite"), invitationId));
}
