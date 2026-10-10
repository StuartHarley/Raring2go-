import { cookies } from "next/headers";
import { rateLimitRules } from "@raring2go/security";
import { NextResponse } from "next/server";
import { requireShellPermission, ShellAccessError } from "../../../../../lib/app-shell";
import { sessionCookieName } from "../../../../../lib/auth-runtime";
import { firstRateLimitRefusal, tooManyRequestsResponse } from "../../../../../lib/rate-limit-runtime";
import { listStudioImages, uploadStudioImage } from "../../../../../lib/studio-images";

export const dynamic = "force-dynamic";

async function authorise(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  try {
    return await requireShellPermission(
      {
        sessionKey: url.searchParams.get("session") ?? undefined,
        sessionToken: cookieStore.get(sessionCookieName)?.value,
        organisationId: url.searchParams.get("organisationId") ?? undefined,
        territoryId: url.searchParams.get("territoryId") ?? undefined
      },
      { module: "edition.content", action: "edit_local" }
    );
  } catch (error) {
    if (error instanceof ShellAccessError) return NextResponse.json({ error: error.message }, { status: error.kind === "unauthenticated" ? 401 : 403, headers: { "cache-control": "no-store" } });
    throw error;
  }
}

const actorOf = (shell: Exclude<Awaited<ReturnType<typeof authorise>>, Response>) => ({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });

/** The images already uploaded for this edition's territory, with their pixel sizes. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const shell = await authorise(request);
  if (shell instanceof Response) return shell;
  const { id } = await params;
  try {
    return NextResponse.json({ images: await listStudioImages(actorOf(shell), id) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "That edition could not be found." }, { status: 404, headers: { "cache-control": "no-store" } });
  }
}

/** Uploads one image for the edition: type and size checked, pixel size read from the file, scanned, stored against the edition's territory. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const shell = await authorise(request);
  if (shell instanceof Response) return shell;
  const refusal = await firstRateLimitRefusal([{ rule: rateLimitRules.fileUploadUser, identifier: shell.userId }]);
  if (refusal) return tooManyRequestsResponse(refusal);
  const { id } = await params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was provided." }, { status: 400 });
  try {
    const image = await uploadStudioImage(actorOf(shell), id, { fileName: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return NextResponse.json(image, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // Messages here are our own (type, size, scan) or a refusal for an edition outside the caller's scope.
    const message = error instanceof Error ? error.message : "Upload failed.";
    const outOfScope = /outside|not found|No permission/i.test(message);
    return NextResponse.json({ error: outOfScope ? "That edition could not be found." : message }, { status: outOfScope ? 404 : 400, headers: { "cache-control": "no-store" } });
  }
}
