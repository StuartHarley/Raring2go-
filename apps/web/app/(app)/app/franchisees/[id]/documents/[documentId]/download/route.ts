import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireShellPermission, ShellAccessError } from "../../../../../../../../lib/app-shell";
import { sessionCookieName } from "../../../../../../../../lib/auth-runtime";
import { DocumentFileError } from "../../../../../../../../lib/franchise-files";
import { downloadDocumentForFranchise } from "../../../../../../../../lib/franchise-runtime";

export const dynamic = "force-dynamic";

/** Authorises, scopes and audits a download, then redirects to a short-lived storage link. The link is never stored or shared. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
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
      { module: "franchise.document", action: "download" }
    );
  } catch (error) {
    if (error instanceof ShellAccessError) return NextResponse.json({ error: error.message }, { status: error.kind === "unauthenticated" ? 401 : 403 });
    throw error;
  }

  const { id, documentId } = await params;
  const versionParam = Number(url.searchParams.get("version"));
  try {
    const link = await downloadDocumentForFranchise(
      { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId },
      id,
      documentId,
      Number.isInteger(versionParam) && versionParam > 0 ? versionParam : undefined
    );
    return NextResponse.redirect(link.url, { status: 302, headers: { "cache-control": "no-store" } });
  } catch (error) {
    // Not found, not yours and not downloadable all look the same from outside.
    const message = error instanceof DocumentFileError ? error.message : "Document was not found.";
    return NextResponse.json({ error: message }, { status: 404, headers: { "cache-control": "no-store" } });
  }
}
