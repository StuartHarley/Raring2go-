import { cookies } from "next/headers";
import { ShellAccessError, resolveShell } from "./app-shell";
import { isFixtureSessionAllowed, sessionCookieName } from "./auth-runtime";

/**
 * Some server actions receive the acting context as an argument bound by the page that rendered them. That value
 * is never trusted on its own: every such action first proves, from the request's own session cookie, that the
 * signed-in user is the user in the context and that they really belong to the organisation and territory named.
 * (Development fixture sessions have no cookie and are only accepted outside production.)
 */
export async function assertBoundActor(context: { userId: string; organisationId?: string | null; territoryId?: string | null }) {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) {
    if (isFixtureSessionAllowed()) return;
    throw new ShellAccessError("unauthenticated", "Sign in to continue.");
  }
  const shell = await resolveShell({ sessionToken: token, organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined });
  if (shell.kind !== "authenticated" || shell.userId !== context.userId) {
    throw new ShellAccessError("unauthorised", "This action is not available to the signed-in user.");
  }
}
