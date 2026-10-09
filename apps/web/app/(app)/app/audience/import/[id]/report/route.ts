import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireShellPermission, ShellAccessError } from "../../../../../../../lib/app-shell";
import { readImportReport } from "../../../../../../../lib/audience-import-runtime";
import { sessionCookieName } from "../../../../../../../lib/auth-runtime";

export const dynamic = "force-dynamic";

/** The reject report for one import: rows that were refused or left pending, with the reason, ready to fix and re-upload. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
      { module: "marketing.import", action: "manage" }
    );
  } catch (error) {
    if (error instanceof ShellAccessError) return NextResponse.json({ error: error.message }, { status: error.kind === "unauthenticated" ? 401 : 403 });
    throw error;
  }

  const { id } = await params;
  try {
    const csv = await readImportReport({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, id);
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="import-${id}-report.csv"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "Import was not found." }, { status: 404 });
  }
}
