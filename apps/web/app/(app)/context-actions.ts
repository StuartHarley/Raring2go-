"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { resolveShell } from "../../lib/app-shell";
import { sessionCookieName } from "../../lib/auth-runtime";
import { serialiseWorkingContext, workingContextCookieName, workingContextCookieOptions, workingContextFromParams } from "../../lib/working-context";

/**
 * Switches the working context. The requested organisation and territory are checked against the
 * contexts this session may use before anything is stored; a request for a context the person
 * does not belong to simply leaves the cookie as it was.
 */
export async function switchContextAction(formData: FormData) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(sessionCookieName)?.value;
  const requested = workingContextFromParams({
    organisationId: String(formData.get("organisationId") ?? ""),
    territoryId: String(formData.get("territoryId") ?? "")
  });

  const shell = await resolveShell({ sessionToken });
  if (shell.kind === "authenticated" && requested.organisationId) {
    const allowed = shell.availableContexts.some(
      (context) => context.organisationId === requested.organisationId && (context.territoryId ?? undefined) === requested.territoryId
    );
    if (allowed) {
      cookieStore.set(workingContextCookieName, serialiseWorkingContext(requested), workingContextCookieOptions);
    }
  }

  revalidatePath("/app", "layout");
  redirect("/app" as Route);
}

/** Forgets the stored context so the person's default context applies again. */
export async function clearContextAction() {
  const cookieStore = await cookies();
  cookieStore.delete(workingContextCookieName);
  revalidatePath("/app", "layout");
  redirect("/app" as Route);
}
