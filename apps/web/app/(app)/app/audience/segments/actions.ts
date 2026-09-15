"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { validateSegmentDefinition } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { sessionCookieName } from "../../../../../lib/auth-runtime";
import { createAudienceSegment, previewSegmentAudience, updateAudienceSegment } from "../../../../../lib/marketing-runtime";

// Called directly from the client-side SegmentRuleBuilder as the user edits
// rules, before anything is saved — unlike the other actions on this page,
// it isn't bound to a page-resolved context, so it re-derives a trusted
// actor context from the session itself rather than trusting a client-passed
// one (AGENTS.md: never trust client-supplied territory/organisation IDs).
export async function previewSegmentAudienceAction(input: { territoryId: string | null; definition: unknown }) {
  const cookieStore = await cookies();
  const shell = await requireShellPermission(
    { sessionToken: cookieStore.get(sessionCookieName)?.value },
    { module: "marketing.segment", action: "view" }
  );
  const root = validateSegmentDefinition(input.definition);
  const audience = await previewSegmentAudience(
    { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId },
    { territoryId: input.territoryId, definition: { version: 1, root } }
  );
  return { count: audience.length };
}

export async function createSegmentAction(context: MarketingActorContext, formData: FormData) {
  const key = String(formData.get("key") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const territoryId = String(formData.get("territoryId") || "") || null;
  const definitionJson = String(formData.get("definitionJson") || "");

  if (!key || !name) {
    throw new Error("Give the segment a key and a name.");
  }

  let definition: unknown;

  try {
    definition = JSON.parse(definitionJson);
  } catch {
    throw new Error("The segment rules could not be read. Try again.");
  }

  await createAudienceSegment(context, { key, name, territoryId, definition });
  revalidatePath("/app/audience/segments");
}

export async function updateSegmentAction(context: MarketingActorContext, segmentId: string, formData: FormData) {
  const name = String(formData.get("name") || "").trim() || undefined;
  const definitionJson = String(formData.get("definitionJson") || "");
  let definition: unknown;

  try {
    definition = JSON.parse(definitionJson);
  } catch {
    throw new Error("The segment rules could not be read. Try again.");
  }

  await updateAudienceSegment(context, segmentId, { name, definition });
  revalidatePath("/app/audience/segments");
}
