import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireShellPermission, ShellAccessError } from "../../../../../../../lib/app-shell";
import { sessionCookieName } from "../../../../../../../lib/auth-runtime";
import { resolveOutputDownload } from "../../../../../../../lib/edition-output";

export const dynamic = "force-dynamic";

/** Sends the caller to a short-lived link for an edition output's PDF, after proving the edition is within their scope. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; outputId: string }> }) {
  const url = new URL(request.url);
  const cookieStore = await cookies();

  let shell;
  try {
    shell = await requireShellPermission(
      {
        sessionKey: url.searchParams.get("session") ?? undefined,
        sessionToken: cookieStore.get(sessionCookieName)?.value,
        organisationId: url.searchParams.get("organisationId") ?? undefined,
        territoryId: url.searchParams.get("territoryId") ?? undefined
      },
      { module: "edition", action: "view" }
    );
  } catch (error) {
    if (error instanceof ShellAccessError) return NextResponse.json({ error: error.message }, { status: error.kind === "unauthenticated" ? 401 : 403 });
    throw error;
  }

  const { id, outputId } = await params;
  try {
    const { url: target } = await resolveOutputDownload({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, id, outputId);
    return new NextResponse(null, { status: 302, headers: { location: target, "cache-control": "no-store" } });
  } catch {
    // The same answer for "not yours" and "not there", so output ids cannot be probed.
    return NextResponse.json({ error: "That output could not be found." }, { status: 404, headers: { "cache-control": "no-store" } });
  }
}
