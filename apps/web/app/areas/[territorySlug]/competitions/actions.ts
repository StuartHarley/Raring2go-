"use server";

import { cookies } from "next/headers";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { safeReturnTo, sessionCookieName } from "../../../../lib/auth-runtime";
import { CompetitionClosedError, enterCompetitionForParent } from "../../../../lib/competition-runtime";
import { ParentSignInRequiredError } from "../../../../lib/parent-runtime";

function withResult(destination: string, result: string) {
  const [path, hash] = destination.split("#");
  return `${path}${path!.includes("?") ? "&" : "?"}entry=${result}${hash ? `#${hash}` : ""}`;
}

/**
 * Enters the competition for the signed-in parent. The parent comes from the session cookie on the server, never from the form;
 * a visitor who is not signed in is sent to sign in and brought back. Results are fixed codes shown on the page.
 */
export async function enterCompetitionAction(slug: string, contentId: string, returnTo: string) {
  const destination = safeReturnTo(returnTo);
  let result = "entered";
  try {
    const outcome = await enterCompetitionForParent({ sessionToken: (await cookies()).get(sessionCookieName)?.value, territorySlug: slug, contentId });
    if (outcome.alreadyEntered) result = "already";
  } catch (error) {
    if (error instanceof ParentSignInRequiredError) redirect(`/sign-in?returnTo=${encodeURIComponent(destination)}` as Route);
    if (error instanceof CompetitionClosedError) result = "closed";
    else throw error;
  }
  revalidatePath(destination.split("?")[0]!);
  redirect(withResult(destination, result) as Route);
}
