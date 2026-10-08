import { randomUUID } from "node:crypto";
import { createDb } from "@raring2go/db";
import { completeFileUpload, getFileReferenceRecord, insertFileReferenceRecord, listFileReferences, requireFilesPermission } from "@raring2go/files";
import type { FilesActorContext } from "@raring2go/files";
import { canAccessFile, assertFileIsDownloadable, createScannerProviderFromEnv, createStorageProviderFromEnv } from "@raring2go/storage";
import type { FileReference } from "@raring2go/storage";
import { getPermissionData } from "./permission-source";


const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export type UploadedNewsletterImage = {
  fileId: string;
  src: string;
  fileName: string;
  virusScanStatus: FileReference["virusScanStatus"];
};

export async function uploadNewsletterImage(
  context: FilesActorContext,
  input: { fileName: string; contentType: string; bytes: Uint8Array }
): Promise<UploadedNewsletterImage> {
  const filesPermissionData = await getPermissionData();
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(input.contentType)) {
    throw new Error("Only PNG, JPEG, GIF or WebP images can be uploaded.");
  }
  if (input.bytes.byteLength === 0) {
    throw new Error("The uploaded file is empty.");
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("Images must be 5MB or smaller.");
  }

  const { db, sql } = createDb();

  try {
    const id = randomUUID();
    const safeFileName = input.fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120) || "image";
    const scopeSegment = context.territoryId ?? "network";
    const storageKey = `newsletters/${scopeSegment}/${id}-${safeFileName}`;

    const reference = await completeFileUpload(
      context,
      filesPermissionData,
      { storage: createStorageProviderFromEnv(), scanner: createScannerProviderFromEnv() },
      {
        id,
        storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        bytes: input.bytes,
        accessScope: context.territoryId ? "territory" : "organisation"
      }
    );

    await insertFileReferenceRecord(db, reference);

    const storage = createStorageProviderFromEnv();
    const src =
      reference.virusScanStatus === "clean" || reference.virusScanStatus === "not_required"
        ? (await storage.createDownloadIntent(reference, { disposition: "inline" })).downloadUrl
        : "";

    return { fileId: reference.id, src, fileName: reference.fileName, virusScanStatus: reference.virusScanStatus };
  } finally {
    await sql.end();
  }
}

// Serverless request bodies are capped (about 4.5MB), so uploads through the app stay under that.
// Larger print files need the direct-to-storage flow once the real storage provider is configured.
const MAX_ARTWORK_BYTES = 4 * 1024 * 1024;
/** Print-ready and web artwork. PDFs are scanned like every other upload before they can be used. */
const ALLOWED_ARTWORK_CONTENT_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/tiff"]);

export type UploadedArtworkFile = {
  fileId: string;
  fileName: string;
  contentType: string;
  virusScanStatus: FileReference["virusScanStatus"];
};

/**
 * Stores advertiser artwork through the same storage and malware-scanning pipeline as other
 * uploads. The file is held against the advertiser's own organisation (never a territory),
 * so only that organisation can read it back.
 */
export async function uploadAdvertiserArtwork(
  context: FilesActorContext,
  input: { fileName: string; contentType: string; bytes: Uint8Array }
): Promise<UploadedArtworkFile> {
  const filesPermissionData = await getPermissionData();
  if (!ALLOWED_ARTWORK_CONTENT_TYPES.has(input.contentType)) {
    throw new Error("Artwork must be a PDF, PNG, JPEG or TIFF file.");
  }
  if (input.bytes.byteLength === 0) {
    throw new Error("The uploaded file is empty.");
  }
  if (input.bytes.byteLength > MAX_ARTWORK_BYTES) {
    throw new Error("Artwork files must be 4MB or smaller. For larger print files, ask your account manager.");
  }
  if (!context.organisationId) {
    throw new Error("Artwork can only be uploaded for an advertiser organisation.");
  }

  const { db, sql } = createDb();

  try {
    const id = randomUUID();
    const safeFileName = input.fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120) || "artwork";
    const reference = await completeFileUpload(
      context,
      filesPermissionData,
      { storage: createStorageProviderFromEnv(), scanner: createScannerProviderFromEnv() },
      { id, storageKey: `advertisers/${context.organisationId}/artwork/${id}-${safeFileName}`, fileName: input.fileName, contentType: input.contentType, bytes: input.bytes, accessScope: "organisation" }
    );

    await insertFileReferenceRecord(db, reference);
    return { fileId: reference.id, fileName: reference.fileName, contentType: reference.contentType, virusScanStatus: reference.virusScanStatus };
  } finally {
    await sql.end();
  }
}

export type UploadedImageOption = {
  fileId: string;
  src: string;
  fileName: string;
};

/**
 * Lists the composer's own previously uploaded, scanned-clean images, so a
 * newsletter image block can reuse one instead of always uploading again.
 * Own organisation/territory scope only, matching every other territory
 * boundary in this app.
 */
export async function listMyUploadedImages(context: FilesActorContext): Promise<UploadedImageOption[]> {
  const filesPermissionData = await getPermissionData();
  requireFilesPermission(context, filesPermissionData, "upload");

  const { db, sql } = createDb();

  try {
    const references = await listFileReferences(db, {
      organisationId: context.organisationId,
      territoryId: context.territoryId,
      contentTypePrefix: "image/",
      virusScanStatus: "clean"
    });

    const storage = createStorageProviderFromEnv();
    const options = await Promise.all(
      references.map(async (reference) => ({
        fileId: reference.id,
        fileName: reference.fileName,
        src: (await storage.createDownloadIntent(reference, { disposition: "inline" })).downloadUrl
      }))
    );

    return options;
  } finally {
    await sql.end();
  }
}

/**
 * Defense-in-depth check at compose time: a block's `fileId` is client-supplied
 * and must be re-verified server-side — the referenced file must actually exist,
 * be scanned clean, and be accessible to the composer's organisation/territory —
 * before a campaign referencing it is allowed to proceed. Never trust a fileId
 * just because it parses as a UUID.
 */
export async function assertFileIsAttachable(context: FilesActorContext, fileId: string): Promise<void> {
  const filesPermissionData = await getPermissionData();
  requireFilesPermission(context, filesPermissionData, "upload");

  const { db, sql } = createDb();

  try {
    const reference = await getFileReferenceRecord(db, fileId);

    if (!reference) {
      throw new Error("The referenced image could not be found.");
    }

    if (!canAccessFile(reference, { organisationId: context.organisationId, territoryId: context.territoryId })) {
      throw new Error("The referenced image is not available in this territory.");
    }

    assertFileIsDownloadable(reference);
  } finally {
    await sql.end();
  }
}
