import { randomUUID } from "node:crypto";
import { createDb } from "@raring2go/db";
import { completeFileUpload, getFileReferenceRecord, insertFileReferenceRecord, listFileReferences } from "@raring2go/files";
import { readImageSize } from "@raring2go/publishing";
import type { PublishingActorContext } from "@raring2go/publishing";
import { evaluatePermission } from "@raring2go/permissions";
import { assertFileIsDownloadable, createScannerProviderFromEnv, createStorageProviderFromEnv } from "@raring2go/storage";
import type { FileReference } from "@raring2go/storage";
import { getPermissionData } from "./permission-source";
import { readTerritoryEdition } from "./publishing-runtime";

/**
 * Images for magazine pages. They are stored against the edition's own territory (not the uploader's), so anyone
 * working on that edition can use them and nobody working on another territory can. The pixel size is read from the
 * file's bytes at upload and stored, so print preflight never relies on what the editor typed.
 */

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // serverless request bodies are capped near 4.5MB
const ALLOWED: Record<string, "png" | "jpeg" | "webp"> = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" };

export type StudioImage = { fileId: string; fileName: string; widthPx: number; heightPx: number };

type FileDeps = { storage: ReturnType<typeof createStorageProviderFromEnv>; scanner: ReturnType<typeof createScannerProviderFromEnv>; fetch?: typeof fetch };

async function editionScope(actor: PublishingActorContext, territoryEditionId: string) {
  const { row } = await readTerritoryEdition(actor, territoryEditionId); // throws unless the edition is within the actor's scope
  return { territoryId: row.territoryEdition.territoryId, organisationId: row.territoryEdition.franchiseOrganisationId ?? actor.organisationId ?? null, edition: row.territoryEdition };
}

async function assertCanEditContent(actor: PublishingActorContext) {
  const permissions = await getPermissionData();
  const decision = evaluatePermission({ userId: actor.userId, module: "edition.content", action: "edit_local", context: { organisationId: actor.organisationId ?? undefined, territoryId: actor.territoryId ?? undefined } }, permissions);
  if (!decision.allowed) throw new Error("No permission grant matched this request.");
  return permissions;
}

function toImage(reference: FileReference): StudioImage | null {
  const widthPx = Number(reference.metadata.widthPx);
  const heightPx = Number(reference.metadata.heightPx);
  return Number.isInteger(widthPx) && Number.isInteger(heightPx) && widthPx > 0 && heightPx > 0 ? { fileId: reference.id, fileName: reference.fileName, widthPx, heightPx } : null;
}

export async function uploadStudioImage(actor: PublishingActorContext, territoryEditionId: string, input: { fileName: string; contentType: string; bytes: Uint8Array }, deps?: FileDeps): Promise<StudioImage> {
  const permissions = await assertCanEditContent(actor);
  const scope = await editionScope(actor, territoryEditionId);
  const declared = ALLOWED[input.contentType];
  if (!declared) throw new Error("Images must be PNG, JPEG or WebP.");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Images must be between 1 byte and 4MB.");
  const size = readImageSize(input.bytes);
  if (!size || size.format !== declared) throw new Error("That file is not a readable image of the type it claims to be.");

  const id = randomUUID();
  const safeName = input.fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-100) || "image";
  const uploaded = await completeFileUpload(
    { userId: actor.userId, organisationId: scope.organisationId, territoryId: scope.territoryId },
    permissions,
    deps ?? { storage: createStorageProviderFromEnv(), scanner: createScannerProviderFromEnv() },
    { id, storageKey: `editions/${scope.territoryId}/${territoryEditionId}/images/${id}-${safeName}`, fileName: input.fileName.slice(-200), contentType: input.contentType, bytes: input.bytes, accessScope: "territory" }
  );
  if (uploaded.virusScanStatus !== "clean" && uploaded.virusScanStatus !== "not_required") throw new Error("The uploaded file failed a security scan and cannot be used.");
  const reference: FileReference = { ...uploaded, metadata: { ...uploaded.metadata, widthPx: size.widthPx, heightPx: size.heightPx, kind: "edition_image" } };
  const { db, sql } = createDb();
  try {
    await insertFileReferenceRecord(db, reference);
  } finally {
    await sql.end();
  }
  return toImage(reference)!;
}

export async function listStudioImages(actor: PublishingActorContext, territoryEditionId: string): Promise<StudioImage[]> {
  const scope = await editionScope(actor, territoryEditionId);
  const { db, sql } = createDb();
  try {
    const references = await listFileReferences(db, { territoryId: scope.territoryId, contentTypePrefix: "image/", virusScanStatus: "clean", limit: 60 });
    return references.filter((reference) => reference.accessScope === "territory").map(toImage).filter((image): image is StudioImage => image !== null);
  } finally {
    await sql.end();
  }
}

/** A chosen image must exist, belong to this edition's territory, be clean, and have a recorded size. */
export async function resolveStudioImage(actor: PublishingActorContext, territoryEditionId: string, fileId: string): Promise<StudioImage> {
  const scope = await editionScope(actor, territoryEditionId);
  const { db, sql } = createDb();
  try {
    const reference = await getFileReferenceRecord(db, fileId);
    const image = reference ? toImage(reference) : null;
    if (!reference || reference.deletedAt || reference.territoryId !== scope.territoryId || reference.accessScope !== "territory" || !image) {
      throw new Error("That image is not available for this edition.");
    }
    assertFileIsDownloadable(reference);
    return image;
  } finally {
    await sql.end();
  }
}

/** Short-lived addresses for rendering. Anything missing, unclean or from another territory stops the render rather than leaving a blank. */
export async function resolveImageUrlsForRender(territoryId: string, fileIds: string[], deps?: { storage?: ReturnType<typeof createStorageProviderFromEnv> }): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  if (fileIds.length === 0) return urls;
  const storage = deps?.storage ?? createStorageProviderFromEnv();
  const { db, sql } = createDb();
  try {
    for (const fileId of new Set(fileIds)) {
      const reference = await getFileReferenceRecord(db, fileId);
      if (!reference || reference.deletedAt || reference.territoryId !== territoryId || reference.accessScope !== "territory") throw new Error("A placed image is missing or does not belong to this territory.");
      assertFileIsDownloadable(reference);
      urls[fileId] = (await storage.createDownloadIntent(reference, { disposition: "inline" })).downloadUrl;
    }
    return urls;
  } finally {
    await sql.end();
  }
}

/** Fills in each uploaded image's stored size and checks it belongs here, so what is saved on the page is what the file really is. */
export async function resolveSnapshotImages(actor: PublishingActorContext, territoryEditionId: string, snapshot: Record<string, unknown>): Promise<Record<string, unknown>> {
  const images = (snapshot.images ?? {}) as Record<string, { fileId?: string; alt?: string; url?: string }>;
  const resolved: Record<string, unknown> = {};
  for (const [zoneId, entry] of Object.entries(images)) {
    if (entry.fileId) {
      const image = await resolveStudioImage(actor, territoryEditionId, entry.fileId);
      resolved[zoneId] = { fileId: image.fileId, alt: entry.alt ?? "", widthPx: image.widthPx, heightPx: image.heightPx };
    } else {
      resolved[zoneId] = entry;
    }
  }
  return { ...snapshot, images: resolved };
}
