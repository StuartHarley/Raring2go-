export type FileAccessScope = "system" | "network" | "organisation" | "territory" | "public";
export type FileVirusScanStatus = "pending" | "clean" | "infected" | "failed" | "not_required";

export type FileReference = {
  id: string;
  providerKey: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  byteSize?: number | null;
  checksum?: string | null;
  accessScope: FileAccessScope;
  organisationId?: string | null;
  territoryId?: string | null;
  ownerUserId?: string | null;
  version: number;
  virusScanStatus: FileVirusScanStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  lockedAt?: string | null;
  deletedAt?: string | null;
};

export type FileUploadIntent = {
  reference: FileReference;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type FileDownloadIntent = {
  reference: FileReference;
  downloadUrl: string;
  expiresAt: string;
  disposition: "inline" | "attachment";
};

export type CreateFileReferenceInput = {
  id: string;
  providerKey?: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  byteSize?: number | null;
  checksum?: string | null;
  accessScope: FileAccessScope;
  organisationId?: string | null;
  territoryId?: string | null;
  ownerUserId?: string | null;
  version?: number;
  virusScanStatus?: FileVirusScanStatus;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  lockedAt?: string | null;
};

export type StorageProvider = {
  key: string;
  createUploadIntent(reference: FileReference): Promise<FileUploadIntent>;
  createDownloadIntent(
    reference: FileReference,
    input?: { disposition?: "inline" | "attachment" }
  ): Promise<FileDownloadIntent>;
  markDeleted?(reference: FileReference): Promise<FileReference>;
};

export function createFileReference(input: CreateFileReferenceInput): FileReference {
  assertSafeStorageKey(input.storageKey);

  return {
    id: input.id,
    providerKey: input.providerKey ?? "development",
    storageKey: input.storageKey,
    fileName: input.fileName,
    contentType: input.contentType,
    byteSize: input.byteSize ?? null,
    checksum: input.checksum ?? null,
    accessScope: input.accessScope,
    organisationId: input.organisationId ?? null,
    territoryId: input.territoryId ?? null,
    ownerUserId: input.ownerUserId ?? null,
    version: input.version ?? 1,
    virusScanStatus: input.virusScanStatus ?? "pending",
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? new Date().toISOString(),
    lockedAt: input.lockedAt ?? null
  };
}

export function nextFileVersion(previous: FileReference, input: Omit<CreateFileReferenceInput, "version">) {
  return createFileReference({
    ...input,
    version: previous.version + 1,
    accessScope: input.accessScope,
    organisationId: input.organisationId ?? previous.organisationId,
    territoryId: input.territoryId ?? previous.territoryId
  });
}

export function lockFileReference(reference: FileReference, lockedAt = new Date().toISOString()): FileReference {
  return {
    ...reference,
    lockedAt
  };
}

export function canAccessFile(
  reference: FileReference,
  context: { organisationId?: string | null; territoryId?: string | null; system?: boolean }
) {
  if (reference.deletedAt) {
    return false;
  }

  if (context.system) {
    return true;
  }

  if (reference.accessScope === "public") {
    return true;
  }

  if (reference.accessScope === "system") {
    return false;
  }

  if (reference.accessScope === "network") {
    return Boolean(context.organisationId);
  }

  if (reference.accessScope === "organisation") {
    return Boolean(reference.organisationId && reference.organisationId === context.organisationId);
  }

  return Boolean(reference.territoryId && reference.territoryId === context.territoryId);
}

export function assertSafeStorageKey(storageKey: string) {
  if (
    storageKey.startsWith("/") ||
    storageKey.includes("..") ||
    storageKey.includes("\\") ||
    storageKey.trim() !== storageKey ||
    storageKey.length === 0
  ) {
    throw new Error("Storage keys must be relative, normalised provider paths.");
  }
}

export function createDevelopmentStorageProvider(baseUrl = "http://localhost:3000/api/files/development"): StorageProvider {
  return {
    key: "development",
    async createUploadIntent(reference) {
      return {
        reference,
        uploadUrl: `${baseUrl}/upload/${encodeURIComponent(reference.storageKey)}`,
        headers: {
          "x-raring2go-storage-provider": "development"
        },
        expiresAt: minutesFromNow(15)
      };
    },
    async createDownloadIntent(reference, input) {
      return {
        reference,
        downloadUrl: `${baseUrl}/download/${encodeURIComponent(reference.storageKey)}`,
        expiresAt: minutesFromNow(15),
        disposition: input?.disposition ?? "attachment"
      };
    },
    async markDeleted(reference) {
      return {
        ...reference,
        deletedAt: new Date().toISOString()
      };
    }
  };
}

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
