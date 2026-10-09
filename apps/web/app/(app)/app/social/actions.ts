"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { londonLocalToIso } from "../../../../lib/london-time";
import {
  approveSocialRecord,
  cancelSocialRecord,
  queueSocialRecord,
  resolveSocialOutcomeRecord,
  retrySocialRecord,
  scheduleSocialRecord
} from "../../../../lib/social-runtime";

/**
 * Staff social queue actions. The actor is resolved here on the server; the domain checks the exact
 * permission and territory. Result codes are fixed, so banner text is looked up on the page.
 */
export type SocialResult = "created" | "saved" | "not_allowed" | "invalid" | "in_past" | "not_approved" | "check_first" | "bad_time";

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "social", action: "view" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function resultFor(error: unknown): SocialResult | undefined {
  if (!(error instanceof Error)) return undefined;
  if (/in the past/i.test(error.message)) return "in_past";
  if (/must be approved|Only approved|Only draft or review/i.test(error.message)) return "not_approved";
  if (/Check whether this post went out/i.test(error.message)) return "check_first";
  if (/Missing permission|No permission grant|outside|not permitted/i.test(error.message)) return "not_allowed";
  if (/^(Failed query|connect|read ECONN|Connection)/.test(error.message)) return undefined;
  return "invalid";
}

async function perform(request: RequestedShellContext, success: SocialResult, work: (actor: Awaited<ReturnType<typeof actorFor>>) => Promise<unknown>) {
  let result: SocialResult = success;
  try {
    await work(await actorFor(request));
  } catch (error) {
    const mapped = resultFor(error);
    if (!mapped) throw error;
    result = mapped;
  }
  revalidatePath("/app/social");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/social?${query.toString()}` as Route);
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

export async function queueSocialAction(request: RequestedShellContext, formData: FormData) {
  // The select carries "variantId|accountId" so one choice picks both.
  const [variantId = "", socialAccountId = ""] = text(formData, "target").split("|");
  await perform(request, "created", (actor) => queueSocialRecord(actor, { variantId, socialAccountId, linkUrl: text(formData, "linkUrl"), cta: text(formData, "cta") }));
}

export async function approveSocialAction(request: RequestedShellContext, publicationId: string) {
  await perform(request, "saved", (actor) => approveSocialRecord(actor, publicationId));
}

export async function scheduleSocialAction(request: RequestedShellContext, publicationId: string, formData: FormData) {
  const iso = londonLocalToIso(text(formData, "when"));
  if (!iso) {
    await perform(request, "saved", async () => {
      throw new Error("Choose a valid date and time to publish.");
    });
    return;
  }
  await perform(request, "saved", (actor) => scheduleSocialRecord(actor, publicationId, iso, "Europe/London"));
}

export async function cancelSocialAction(request: RequestedShellContext, publicationId: string) {
  await perform(request, "saved", (actor) => cancelSocialRecord(actor, publicationId));
}

export async function retrySocialAction(request: RequestedShellContext, publicationId: string) {
  await perform(request, "saved", (actor) => retrySocialRecord(actor, publicationId));
}

export async function resolveSocialAction(request: RequestedShellContext, publicationId: string, posted: boolean, formData: FormData) {
  await perform(request, "saved", (actor) => resolveSocialOutcomeRecord(actor, publicationId, { posted, externalReference: text(formData, "reference") }));
}
