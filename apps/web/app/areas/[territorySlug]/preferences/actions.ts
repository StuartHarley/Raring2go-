"use server";

import { cookies } from "next/headers";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { ParentSelfServiceError } from "@raring2go/marketing";
import { revalidatePath } from "next/cache";
import { safeReturnTo, sessionCookieName } from "../../../../lib/auth-runtime";
import {
  ParentSignInRequiredError,
  changeParentEmailOptOut,
  changeParentEmailSubscription,
  savePublicContentForParent,
  saveParentPreferences,
  unsavePublicContentForParent
} from "../../../../lib/parent-runtime";

/**
 * Parent self-service actions. Every action reads the parent from the session cookie on the
 * server; nothing a form submits can name a different contact.
 */

async function token() {
  return (await cookies()).get(sessionCookieName)?.value;
}

function back(slug: string, outcome: "saved" | "error", message?: string): never {
  const query = new URLSearchParams({ [outcome]: message ?? "1" });
  redirect(`/areas/${encodeURIComponent(slug)}/preferences?${query.toString()}` as Route);
}

function signIn(returnTo: string): never {
  redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}` as Route);
}

async function run(slug: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    if (error instanceof ParentSignInRequiredError) signIn(`/areas/${slug}/preferences`);
    if (error instanceof ParentSelfServiceError) back(slug, "error", error.message);
    throw error;
  }
  revalidatePath(`/areas/${slug}/preferences`);
  revalidatePath(`/areas/${slug}/saved`);
  back(slug, "saved");
}

const words = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);

export async function savePreferencesAction(slug: string, formData: FormData) {
  await run(slug, async () =>
    saveParentPreferences(await token(), {
      homeTerritoryId: String(formData.get("homeTerritoryId") ?? "") || null,
      followedTerritoryIds: formData.getAll("followed").map(String),
      childAgeBands: formData.getAll("ageBands").map(String),
      interests: words(formData.get("interests")),
      eventCategories: words(formData.get("eventCategories")),
      offerPreferences: words(formData.get("offerPreferences")),
      competitionPreferences: words(formData.get("competitionPreferences")),
      newsletterFrequency: String(formData.get("newsletterFrequency") ?? "weekly"),
      personalisationEnabled: formData.get("personalisationEnabled") === "on"
    })
  );
}

export async function setEmailSubscriptionAction(slug: string, territoryId: string, subscribed: boolean) {
  await run(slug, async () => changeParentEmailSubscription(await token(), { territoryId, subscribed }));
}

export async function setEmailOptOutAction(slug: string, optOut: boolean) {
  await run(slug, async () => changeParentEmailOptOut(await token(), optOut));
}

export async function toggleSavedContentAction(slug: string, contentId: string, save: boolean, returnTo: string) {
  const destination = safeReturnTo(returnTo);
  try {
    const sessionToken = await token();
    if (save) await savePublicContentForParent({ sessionToken, territorySlug: slug, contentId });
    else await unsavePublicContentForParent({ sessionToken, contentId });
  } catch (error) {
    if (error instanceof ParentSignInRequiredError) signIn(destination);
    throw error;
  }
  revalidatePath(`/areas/${slug}/saved`);
  redirect(destination as Route);
}
