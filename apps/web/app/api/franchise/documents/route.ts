import { cookies } from "next/headers";
import { rateLimitRules } from "@raring2go/security";
import { NextResponse } from "next/server";
import { requireShellPermission, ShellAccessError } from "../../../../lib/app-shell";
import { sessionCookieName } from "../../../../lib/auth-runtime";
import { DocumentFileError } from "../../../../lib/franchise-files";
import { addDocumentVersionForFranchise, uploadDocumentForFranchise } from "../../../../lib/franchise-runtime";
import { appLogger } from "../../../../lib/logger";
import { firstRateLimitRefusal, tooManyRequestsResponse } from "../../../../lib/rate-limit-runtime";

const categories = new Set(["agreement", "insurance_certificate", "company_document", "policy_certificate"]);

/**
 * Uploads a franchise document (or a new version of one). Identity and territory come from the session; the franchise
 * is checked against what that person may touch before any file is stored, and the file is scanned before it is kept.
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
      { module: "franchise.document", action: "upload" }
    );
  } catch (error) {
    if (error instanceof ShellAccessError) return NextResponse.json({ error: error.message }, { status: error.kind === "unauthenticated" ? 401 : 403 });
    throw error;
  }

  const refusal = await firstRateLimitRefusal([{ rule: rateLimitRules.franchiseDocumentUploadUser, identifier: shell.userId }]);
  if (refusal) return tooManyRequestsResponse(refusal);

  const form = await request.formData();
  const file = form.get("file");
  const franchiseId = String(form.get("franchiseId") ?? "");
  if (!(file instanceof File) || file.size === 0 || !franchiseId) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "Documents must be 4MB or smaller." }, { status: 400 });

  const context = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
  const upload = { fileName: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };

  try {
    const documentId = String(form.get("documentId") ?? "");
    if (documentId) {
      await addDocumentVersionForFranchise(context, franchiseId, documentId, { file: upload });
      return NextResponse.json({ ok: true });
    }
    const category = String(form.get("category") ?? "company_document");
    await uploadDocumentForFranchise(context, franchiseId, {
      category: categories.has(category) ? category : "company_document",
      documentType: String(form.get("documentType") ?? "general").slice(0, 80) || "general",
      title: String(form.get("title") ?? "").trim().slice(0, 160) || file.name.slice(0, 160),
      description: String(form.get("description") ?? "").trim().slice(0, 500) || null,
      expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(String(form.get("expiryDate") ?? "")) ? String(form.get("expiryDate")) : null,
      file: upload
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    // File problems are written for the uploader and never echo file contents.
    if (error instanceof DocumentFileError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && /Missing permission|No permission grant|outside|not found/i.test(error.message)) return NextResponse.json({ error: "You cannot upload documents for that franchise." }, { status: 403 });
    appLogger.error("franchise document upload failed", { error });
    return NextResponse.json({ error: "The document could not be saved. Please try again." }, { status: 500 });
  }
}
