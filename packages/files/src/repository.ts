import { fileReferences } from "@raring2go/db";
import { and, desc, eq, isNull, like } from "drizzle-orm";
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

/**
 * Lists previously uploaded files for reuse (e.g. a "choose from your
 * uploads" gallery) - own organisation/territory scope only, matching every
 * other territory boundary in this app. Ordered most-recent first.
 */
export async function listFileReferences(
  db: FilesDb,
  filter: {
    organisationId?: string | null;
    territoryId?: string | null;
    contentTypePrefix?: string;
    virusScanStatus?: FileReference["virusScanStatus"];
    limit?: number;
  }
): Promise<FileReference[]> {
  const conditions = [isNull(fileReferences.deletedAt)];

  if (filter.organisationId) {
    conditions.push(eq(fileReferences.organisationId, filter.organisationId));
  }
  if (filter.territoryId) {
    conditions.push(eq(fileReferences.territoryId, filter.territoryId));
  }
  if (filter.contentTypePrefix) {
    conditions.push(like(fileReferences.contentType, `${filter.contentTypePrefix}%`));
  }
  if (filter.virusScanStatus) {
    conditions.push(eq(fileReferences.virusScanStatus, filter.virusScanStatus));
  }

  const rows = await db
    .select()
    .from(fileReferences)
    .where(and(...conditions))
    .orderBy(desc(fileReferences.createdAt))
    .limit(filter.limit ?? 24);

  return rows.map(rowToFileReference);
}
