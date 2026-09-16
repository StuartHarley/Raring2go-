import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireShellPermission, ShellAccessError } from "../../../../lib/app-shell";
import { sessionCookieName } from "../../../../lib/auth-runtime";
import { listMyUploadedImages } from "../../../../lib/files-runtime";

export async function GET(request: Request) {
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
      { module: "marketing.email", action: "view" }
    );
  } catch (error) {
    if (error instanceof ShellAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.kind === "unauthenticated" ? 401 : 403 });
    }
    throw error;
  }

  try {
    const images = await listMyUploadedImages({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return NextResponse.json({ images });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not list uploads." }, { status: 400 });
  }
}
