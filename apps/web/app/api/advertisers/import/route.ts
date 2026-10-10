import { cookies } from "next/headers";
import { rateLimitRules } from "@raring2go/security";
import { NextResponse } from "next/server";
import { requireShellPermission, ShellAccessError } from "../../../../lib/app-shell";
import { AdvertiserImportFileError, previewAdvertiserImport } from "../../../../lib/advertiser-import-runtime";
import { sessionCookieName } from "../../../../lib/auth-runtime";
import { appLogger } from "../../../../lib/logger";
import { firstRateLimitRefusal, tooManyRequestsResponse } from "../../../../lib/rate-limit-runtime";

/**
 * Uploads an advertiser CSV as a DRY RUN: it is parsed and checked and no advertiser record changes. Identity comes only from the
 * session, and the territory is checked against what that person may import into.
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
        organisationId: url.searchParams.get("organisationId") ?? undefined,
        territoryId: url.searchParams.get("territoryId") ?? undefined
      },
      { module: "advertiser.import", action: "manage" }
    );
  } catch (error) {
    if (error instanceof ShellAccessError) return NextResponse.json({ error: error.message }, { status: error.kind === "unauthenticated" ? 401 : 403 });
    throw error;
  }

  const refusal = await firstRateLimitRefusal([{ rule: rateLimitRules.advertiserImportUser, identifier: shell.userId }]);
  if (refusal) return tooManyRequestsResponse(refusal);

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a CSV file to import." }, { status: 400 });
  if (file.size > 1024 * 1024) return NextResponse.json({ error: "That file is larger than 1 MB. Split it and import in parts." }, { status: 400 });

  try {
    const created = await previewAdvertiserImport(
      { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId },
      { territoryId: String(formData.get("territoryId") || shell.activeContext.territoryId || ""), source: String(formData.get("source") ?? ""), fileName: file.name, text: await file.text() }
    );
    return NextResponse.json({ ok: true, id: created.id, existing: created.existing });
  } catch (error) {
    // File problems are written for staff and never echo the file's contents.
    if (error instanceof AdvertiserImportFileError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && /No permission grant|outside/i.test(error.message)) return NextResponse.json({ error: "You cannot import into that territory." }, { status: 403 });
    appLogger.error("advertiser import dry run failed", { error });
    return NextResponse.json({ error: "The file could not be checked. Please try again." }, { status: 500 });
  }
}
