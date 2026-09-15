import { requirePermission, type PermissionData } from "@raring2go/permissions";
import { applyScanResult, createFileReference } from "@raring2go/storage";
import type { FileReference, FileScannerProvider, StorageProvider } from "@raring2go/storage";
import { filesCapabilities, type FilesCapability } from "./permissions";

export type FilesActorContext = {
  userId: string;
  organisationId?: string | null;
  territoryId?: string | null;
};

export function requireFilesPermission(
  context: FilesActorContext,
  permissions: PermissionData,
  capability: FilesCapability,
  resource?: { organisationId?: string | null; territoryId?: string | null }
) {
  const descriptor = filesCapabilities[capability];
  return requirePermission(
    {
      userId: context.userId,
      module: descriptor.module,
      action: descriptor.action,
      context: {
        organisationId: context.organisationId ?? undefined,
        territoryId: context.territoryId ?? undefined
      },
      resource: {
        organisationId: resource?.organisationId ?? context.organisationId ?? undefined,
        territoryId: resource?.territoryId ?? context.territoryId ?? undefined
      }
    },
    permissions
  );
}

/**
 * Uploads a file through the given StorageProvider (creates an upload intent,
 * then PUTs the bytes to it — same intent mechanic a real client-side presigned
 * upload would use, just performed server-side here), scans it, and returns the
 * final FileReference with the resolved virus-scan status. Does not persist —
 * the caller is responsible for writing the returned reference to the database.
 */
export async function completeFileUpload(
  context: FilesActorContext,
  permissions: PermissionData,
  providers: { storage: StorageProvider; scanner: FileScannerProvider; fetch?: typeof fetch },
  input: {
    id: string;
    storageKey: string;
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
    accessScope: FileReference["accessScope"];
  }
): Promise<FileReference> {
  requireFilesPermission(context, permissions, "upload");

  const reference = createFileReference({
    id: input.id,
    storageKey: input.storageKey,
    fileName: input.fileName,
    contentType: input.contentType,
    byteSize: input.bytes.byteLength,
    accessScope: input.accessScope,
    organisationId: context.organisationId ?? null,
    territoryId: context.territoryId ?? null,
    ownerUserId: context.userId
  });

  const intent = await providers.storage.createUploadIntent(reference);
  const fetcher = providers.fetch ?? fetch;
  const uploadResponse = await fetcher(intent.uploadUrl, {
    method: "PUT",
    headers: { ...intent.headers, "content-type": input.contentType },
    body: Buffer.from(input.bytes)
  });

  if (!uploadResponse.ok) {
    throw new Error(`File upload failed with HTTP ${uploadResponse.status}.`);
  }

  const scanResult = await providers.scanner.scan(intent.reference);
  return applyScanResult(intent.reference, scanResult);
}
