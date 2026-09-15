import { fileReferences } from "@raring2go/db";
import { eq } from "drizzle-orm";
import type { FileReference } from "@raring2go/storage";

type FilesDb = any;

function rowToFileReference(row: Record<string, unknown>): FileReference {
  return {
    id: row.id as string,
    providerKey: row.providerKey as string,
    storageKey: row.storageKey as string,
    fileName: row.fileName as string,
    contentType: row.contentType as string,
    byteSize: (row.byteSize as number | null) ?? null,
    checksum: (row.checksum as string | null) ?? null,
    accessScope: row.accessScope as FileReference["accessScope"],
    organisationId: (row.organisationId as string | null) ?? null,
    territoryId: (row.territoryId as string | null) ?? null,
    ownerUserId: (row.ownerUserId as string | null) ?? null,
    version: row.version as number,
    virusScanStatus: row.virusScanStatus as FileReference["virusScanStatus"],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: (row.createdAt as Date).toISOString(),
    lockedAt: row.lockedAt ? (row.lockedAt as Date).toISOString() : null,
    deletedAt: row.deletedAt ? (row.deletedAt as Date).toISOString() : null
  };
}

export async function insertFileReferenceRecord(db: FilesDb, reference: FileReference) {
  await db.insert(fileReferences).values({
    id: reference.id,
    providerKey: reference.providerKey,
    storageKey: reference.storageKey,
    fileName: reference.fileName,
    contentType: reference.contentType,
    byteSize: reference.byteSize ?? null,
    checksum: reference.checksum ?? null,
    accessScope: reference.accessScope,
    organisationId: reference.organisationId ?? null,
    territoryId: reference.territoryId ?? null,
    ownerUserId: reference.ownerUserId ?? null,
    version: reference.version,
    virusScanStatus: reference.virusScanStatus,
    metadata: reference.metadata,
    lockedAt: reference.lockedAt ? new Date(reference.lockedAt) : null
  });
}

export async function updateFileReferenceScanRecord(db: FilesDb, reference: FileReference) {
  await db
    .update(fileReferences)
    .set({
      virusScanStatus: reference.virusScanStatus,
      metadata: reference.metadata
    })
    .where(eq(fileReferences.id, reference.id));
}

export async function getFileReferenceRecord(db: FilesDb, id: string): Promise<FileReference | undefined> {
  const rows = await db.select().from(fileReferences).where(eq(fileReferences.id, id));
  const row = rows[0];
  return row ? rowToFileReference(row) : undefined;
}
