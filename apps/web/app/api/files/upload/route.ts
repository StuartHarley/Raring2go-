import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireShellPermission, ShellAccessError } from "../../../../lib/app-shell";
import { sessionCookieName } from "../../../../lib/auth-runtime";
import { uploadNewsletterImage } from "../../../../lib/files-runtime";

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
      { module: "marketing.email", action: "view" }
    );
  } catch (error) {
    if (error instanceof ShellAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.kind === "unauthenticated" ? 401 : 403 });
    }
    throw error;
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was provided." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const uploaded = await uploadNewsletterImage(
      {
        userId: shell.userId,
        organisationId: shell.activeContext.organisationId,
        territoryId: shell.activeContext.territoryId
      },
      { fileName: file.name, contentType: file.type, bytes }
    );

    if (!uploaded.src) {
      return NextResponse.json(
        { error: "The uploaded file failed a security scan and cannot be used.", virusScanStatus: uploaded.virusScanStatus },
        { status: 422 }
      );
    }

    return NextResponse.json(uploaded);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed." }, { status: 400 });
  }
}
