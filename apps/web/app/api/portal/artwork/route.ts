import { cookies } from "next/headers";
import { rateLimitRules } from "@raring2go/security";
import { NextResponse } from "next/server";
import { PortalAccessError, PortalStateError } from "@raring2go/advertising";
import { requireShellPermission, ShellAccessError } from "../../../../lib/app-shell";
import { sessionCookieName } from "../../../../lib/auth-runtime";
import { appLogger } from "../../../../lib/logger";
import { submitArtworkAsAdvertiser } from "../../../../lib/portal-runtime";
import { firstRateLimitRefusal, tooManyRequestsResponse } from "../../../../lib/rate-limit-runtime";

/**
 * Advertiser artwork upload. Identity comes only from the session: the organisation is taken
 * from the verified shell context, and the requirement id is checked against that organisation's
 * own records before the file is stored.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();

  let shell;
  try {
    shell = await requireShellPermission(
      {
        sessionKey: url.searchParams.get("session") ?? undefined,
        sessionToken: cookieStore.get(sessionCookieName)?.value,
        organisationId: url.searchParams.get("organisationId") ?? undefined
      },
      { module: "portal.advertiser", action: "view" }
    );
  } catch (error) {
    if (error instanceof ShellAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.kind === "unauthenticated" ? 401 : 403 });
    }
    throw error;
  }

  const refusal = await firstRateLimitRefusal([{ rule: rateLimitRules.artworkUploadUser, identifier: shell.userId }]);
  if (refusal) return tooManyRequestsResponse(refusal);

  const formData = await request.formData();
  const file = formData.get("file");
  const requirementId = String(formData.get("requirementId") ?? "");

  if (!(file instanceof File) || !requirementId) {
    return NextResponse.json({ error: "Choose a file to send." }, { status: 400 });
  }

  try {
    const version = await submitArtworkAsAdvertiser(
      { userId: shell.userId, organisationId: shell.activeContext.organisationId },
      { requirementId, fileName: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), notes: String(formData.get("notes") ?? "") }
    );
    return NextResponse.json({ ok: true, versionNumber: version.versionNumber });
  } catch (error) {
    if (error instanceof PortalAccessError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof PortalStateError) return NextResponse.json({ error: error.message }, { status: 409 });
    // Upload validation errors (type, size, empty) are written for users; anything else is not shown.
    if (error instanceof Error && /^(Artwork|The uploaded file|File upload)/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    appLogger.error("artwork upload failed", { error });
    return NextResponse.json({ error: "The file could not be sent. Please try again." }, { status: 500 });
  }
}
