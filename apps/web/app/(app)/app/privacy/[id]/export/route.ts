import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PrivacyAccessError, PrivacyStateError } from "@raring2go/security";
import { requireShellPermission, ShellAccessError } from "../../../../../../lib/app-shell";
import { sessionCookieName } from "../../../../../../lib/auth-runtime";
import { exportSubjectAsActor } from "../../../../../../lib/privacy-runtime";

export const dynamic = "force-dynamic";

/** A subscriber's data export, generated on demand and never stored: it is downloaded, audited, and gone. */
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
      { module: "privacy.request", action: "export" }
    );
  } catch (error) {
    if (error instanceof ShellAccessError) return NextResponse.json({ error: error.message }, { status: error.kind === "unauthenticated" ? 401 : 403 });
    throw error;
  }

  const { id } = await params;
  try {
    const { bundle } = await exportSubjectAsActor({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, id);
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="subject-data-${id}.json"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof PrivacyAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof PrivacyStateError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
