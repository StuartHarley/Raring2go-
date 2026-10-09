import { createHash, randomUUID } from "node:crypto";
import { getFileReferenceRecord, insertFileReferenceRecord } from "@raring2go/files";
import {
  applyScanResult,
  assertFileIsDownloadable,
  canAccessFile,
  createFileReference,
  createScannerProviderFromEnv,
  createStorageProviderFromEnv
} from "@raring2go/storage";
import type { FileReference, FileScannerProvider, StorageProvider } from "@raring2go/storage";

/**
 * Real file handling for the franchise document vault: type and size checks, storage, malware scanning, and
 * time-limited downloads. The browser never gets a permanent link: every download is authorised, audited, and
 * handed a short-lived URL from the storage provider.
 */

export const DOCUMENT_MAX_BYTES = 4 * 1024 * 1024; // serverless request bodies are capped near 4.5 MB

/** A problem with the file itself, written for the person uploading it. */
export class DocumentFileError extends Error {}

export type FileProviders = { storage: StorageProvider; scanner: FileScannerProvider; fetch?: typeof fetch };
export const defaultFileProviders = (): FileProviders => ({ storage: createStorageProviderFromEnv(), scanner: createScannerProviderFromEnv() });

type DocumentKind = "pdf" | "png" | "jpeg" | "docx";
const kindContentTypes: Record<DocumentKind, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpeg: ["image/jpeg"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
};

/** What the bytes actually are. The browser's claimed type and the file name are not trusted. */
export function sniffDocumentKind(bytes: Uint8Array): DocumentKind | undefined {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "pdf"; // %PDF-
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (starts(0xff, 0xd8, 0xff)) return "jpeg";
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "docx"; // zip container; checked against the claimed type below
  return undefined;
}

export function validateDocumentFile(file: { fileName: string; contentType: string; bytes: Uint8Array }) {
  if (file.bytes.byteLength === 0) throw new DocumentFileError("The file is empty.");
  if (file.bytes.byteLength > DOCUMENT_MAX_BYTES) throw new DocumentFileError("Documents must be 4MB or smaller.");
  const kind = sniffDocumentKind(file.bytes);
  if (!kind) throw new DocumentFileError("Upload a PDF, PNG, JPEG or Word (.docx) file.");
  if (!kindContentTypes[kind].includes(file.contentType)) throw new DocumentFileError("The file does not match its type. Upload a PDF, PNG, JPEG or Word (.docx) file.");
  if (kind === "docx" && !/\.docx$/i.test(file.fileName)) throw new DocumentFileError("Word files must be saved as .docx.");
  return { kind, contentType: kindContentTypes[kind][0]! };
}

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120) || "document";

/**
 * Stores and scans the file and returns its reference (not yet saved). Anything that is not scanned clean is refused
 * and the stored object is removed where the provider supports it, so an infected file is never kept or offered.
 */
export async function storeDocumentFile(
  input: { franchise: { organisationId: string; territoryId: string }; userId: string | null; fileName: string; contentType: string; bytes: Uint8Array },
  providers: FileProviders = defaultFileProviders()
): Promise<FileReference> {
  const id = randomUUID();
  const reference = createFileReference({
    id,
    storageKey: `franchises/${input.franchise.territoryId}/documents/${id}-${safeName(input.fileName)}`,
    fileName: input.fileName.slice(-200),
    contentType: input.contentType,
    byteSize: input.bytes.byteLength,
    checksum: createHash("sha256").update(input.bytes).digest("hex"),
    accessScope: "territory",
    organisationId: input.franchise.organisationId,
    territoryId: input.franchise.territoryId,
    ownerUserId: input.userId || null
  });

  const intent = await providers.storage.createUploadIntent(reference);
  const response = await (providers.fetch ?? fetch)(intent.uploadUrl, { method: "PUT", headers: { ...intent.headers, "content-type": input.contentType }, body: Buffer.from(input.bytes) });
  if (!response.ok) throw new Error(`File upload failed with HTTP ${response.status}.`);

  const scanned = applyScanResult(intent.reference, await providers.scanner.scan(intent.reference));
  if (scanned.virusScanStatus !== "clean" && scanned.virusScanStatus !== "not_required") {
    await providers.storage.deleteObject?.(scanned).catch(() => undefined);
    throw new DocumentFileError(scanned.virusScanStatus === "infected" ? "That file failed the security scan and was not saved." : "That file could not be security-scanned, so it was not saved. Try again shortly.");
  }
  return scanned;
}

export async function saveFileReference(db: Parameters<typeof insertFileReferenceRecord>[0], reference: FileReference) {
  await insertFileReferenceRecord(db, reference);
}

/**
 * A short-lived download link for an artefact, after re-checking the file itself: it must exist, belong to the
 * franchise's territory (so a tampered reference cannot reach another territory's file), match the artefact's
 * storage key, and have passed its scan.
 */
export async function createDocumentDownloadUrl(
  db: Parameters<typeof getFileReferenceRecord>[0],
  input: { artifact: { storageKey: string; providerMetadata?: Record<string, unknown> }; territoryId: string; organisationId: string; fileName?: string },
  providers: Pick<FileProviders, "storage"> = defaultFileProviders()
) {
  const fileId = (input.artifact.providerMetadata as { fileId?: unknown } | undefined)?.fileId;
  if (typeof fileId !== "string") throw new DocumentFileError("This document has no stored file.");
  const reference = await getFileReferenceRecord(db, fileId);
  if (!reference || reference.storageKey !== input.artifact.storageKey) throw new DocumentFileError("This document's file could not be found.");
  if (!canAccessFile(reference, { organisationId: input.organisationId, territoryId: input.territoryId }) || reference.territoryId !== input.territoryId) {
    throw new DocumentFileError("This document's file could not be found.");
  }
  assertFileIsDownloadable(reference);
  const intent = await providers.storage.createDownloadIntent(reference, { disposition: "attachment" });
  return { url: intent.downloadUrl, expiresAt: intent.expiresAt, fileName: reference.fileName, contentType: reference.contentType };
}
