import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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

export type FileScanResult = {
  fileId: string;
  status: Exclude<FileVirusScanStatus, "pending">;
  providerKey: string;
  scannedAt: string;
  signature?: string | null;
  findings?: string[];
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
  deleteObject?(reference: FileReference): Promise<FileReference>;
};

export type FileScannerProvider = {
  key: string;
  scan(reference: FileReference): Promise<FileScanResult>;
  verifyScanEvent?(input: {
    headers: Record<string, string | string[] | undefined>;
    body: string;
    secret?: string;
  }): Promise<FileScanResult>;
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

export function assertFileIsDownloadable(reference: FileReference) {
  if (reference.deletedAt) {
    throw new Error("Deleted files cannot be downloaded.");
  }

  if (!["clean", "not_required"].includes(reference.virusScanStatus)) {
    throw new Error("Files must pass security scanning before download.");
  }
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
      assertFileIsDownloadable(reference);

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

export function createSignedUrlStorageProvider(input: {
  key?: string;
  baseUrl: string;
  secret: string;
  expiresInSeconds?: number;
}): StorageProvider {
  if (!input.baseUrl || !input.secret) {
    throw new Error("Signed URL storage provider requires baseUrl and secret.");
  }

  return {
    key: input.key ?? "signed-url",
    async createUploadIntent(reference) {
      const expiresAt = secondsFromNow(input.expiresInSeconds ?? 900);

      return {
        reference: {
          ...reference,
          providerKey: input.key ?? "signed-url"
        },
        uploadUrl: signedUrl(input.baseUrl, "upload", reference.storageKey, expiresAt, input.secret),
        headers: {
          "x-raring2go-storage-provider": input.key ?? "signed-url",
          "content-type": reference.contentType
        },
        expiresAt
      };
    },
    async createDownloadIntent(reference, downloadInput) {
      assertFileIsDownloadable(reference);
      const expiresAt = secondsFromNow(input.expiresInSeconds ?? 900);

      return {
        reference: {
          ...reference,
          providerKey: input.key ?? "signed-url"
        },
        downloadUrl: signedUrl(input.baseUrl, "download", reference.storageKey, expiresAt, input.secret),
        expiresAt,
        disposition: downloadInput?.disposition ?? "attachment"
      };
    },
    async markDeleted(reference) {
      return {
        ...reference,
        deletedAt: new Date().toISOString()
      };
    }
  } satisfies StorageProvider;
}

export function createR2StorageProvider(input: {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresInSeconds?: number;
  now?: () => Date;
  fetch?: typeof fetch;
}): StorageProvider {
  if (!input.accountId || !input.bucket || !input.accessKeyId || !input.secretAccessKey) {
    throw new Error("R2 storage provider requires account ID, bucket and access credentials.");
  }

  const expiresInSeconds = input.expiresInSeconds ?? 900;
  const endpoint = `https://${input.accountId}.r2.cloudflarestorage.com`;

  return {
    key: "r2",
    async createUploadIntent(reference) {
      const now = input.now?.() ?? new Date();
      const signed = r2SignedUrl({
        method: "PUT",
        endpoint,
        bucket: input.bucket,
        storageKey: reference.storageKey,
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        expiresInSeconds,
        now
      });

      return {
        reference: { ...reference, providerKey: "r2" },
        uploadUrl: signed.url,
        headers: {
          "content-type": reference.contentType
        },
        expiresAt: signed.expiresAt
      };
    },
    async createDownloadIntent(reference, downloadInput) {
      assertFileIsDownloadable(reference);
      const now = input.now?.() ?? new Date();
      const signed = r2SignedUrl({
        method: "GET",
        endpoint,
        bucket: input.bucket,
        storageKey: reference.storageKey,
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        expiresInSeconds,
        now,
        responseContentDisposition: downloadInput?.disposition === "inline"
          ? `inline; filename="${reference.fileName}"`
          : `attachment; filename="${reference.fileName}"`
      });

      return {
        reference: { ...reference, providerKey: "r2" },
        downloadUrl: signed.url,
        expiresAt: signed.expiresAt,
        disposition: downloadInput?.disposition ?? "attachment"
      };
    },
    async markDeleted(reference) {
      return {
        ...reference,
        providerKey: "r2",
        deletedAt: new Date().toISOString()
      };
    },
    async deleteObject(reference) {
      const now = input.now?.() ?? new Date();
      const signed = r2SignedUrl({
        method: "DELETE",
        endpoint,
        bucket: input.bucket,
        storageKey: reference.storageKey,
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        expiresInSeconds,
        now
      });
      const response = await (input.fetch ?? fetch)(signed.url, { method: "DELETE" });

      if (!response.ok && response.status !== 404) {
        throw new Error(`R2 delete failed with HTTP ${response.status}.`);
      }

      return {
        ...reference,
        providerKey: "r2",
        deletedAt: new Date().toISOString()
      };
    }
  } satisfies StorageProvider;
}

export function createStorageProviderFromEnv(source: NodeJS.ProcessEnv = process.env) {
  const provider = source.STORAGE_PROVIDER ?? "development";

  if (provider === "development") {
    return createDevelopmentStorageProvider(source.STORAGE_DEVELOPMENT_BASE_URL);
  }

  if (provider === "signed-url") {
    if (!source.STORAGE_BASE_URL || !source.STORAGE_SIGNING_SECRET) {
      throw new Error("STORAGE_PROVIDER=signed-url requires STORAGE_BASE_URL and STORAGE_SIGNING_SECRET.");
    }

    return createSignedUrlStorageProvider({
      key: source.STORAGE_PROVIDER_KEY,
      baseUrl: source.STORAGE_BASE_URL,
      secret: source.STORAGE_SIGNING_SECRET,
      expiresInSeconds: source.STORAGE_URL_TTL_SECONDS
        ? Number(source.STORAGE_URL_TTL_SECONDS)
        : undefined
    });
  }

  if (provider === "r2") {
    if (!source.R2_ACCOUNT_ID || !source.R2_BUCKET || !source.R2_ACCESS_KEY_ID || !source.R2_SECRET_ACCESS_KEY) {
      throw new Error("STORAGE_PROVIDER=r2 requires R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.");
    }

    return createR2StorageProvider({
      accountId: source.R2_ACCOUNT_ID,
      bucket: source.R2_BUCKET,
      accessKeyId: source.R2_ACCESS_KEY_ID,
      secretAccessKey: source.R2_SECRET_ACCESS_KEY,
      expiresInSeconds: source.STORAGE_URL_TTL_SECONDS
        ? Number(source.STORAGE_URL_TTL_SECONDS)
        : undefined
    });
  }

  throw new Error(`Unsupported storage provider: ${provider}`);
}

export function createMemoryScannerProvider(input?: {
  key?: string;
  status?: Exclude<FileVirusScanStatus, "pending">;
}) {
  return {
    key: input?.key ?? "memory-scanner",
    async scan(reference) {
      return {
        fileId: reference.id,
        status: input?.status ?? "clean",
        providerKey: input?.key ?? "memory-scanner",
        scannedAt: new Date().toISOString(),
        findings: []
      };
    }
  } satisfies FileScannerProvider;
}

export function createClamAvHttpScannerProvider(input: {
  endpoint: string;
  apiKey?: string;
  key?: string;
  fetch?: typeof fetch;
}): FileScannerProvider {
  if (!input.endpoint) {
    throw new Error("ClamAV HTTP scanner provider requires an endpoint.");
  }

  return {
    key: input.key ?? "clamav-http",
    async scan(reference) {
      const fetcher = input.fetch ?? fetch;
      const response = await fetcher(input.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {})
        },
        body: JSON.stringify({
          fileId: reference.id,
          storageKey: reference.storageKey,
          contentType: reference.contentType,
          checksum: reference.checksum
        })
      });

      const payload = await response.json().catch(() => ({})) as {
        status?: FileScanResult["status"];
        scannedAt?: string;
        signature?: string;
        findings?: string[];
      };

      if (!response.ok || !payload.status) {
        return {
          fileId: reference.id,
          status: "failed",
          providerKey: input.key ?? "clamav-http",
          scannedAt: new Date().toISOString(),
          findings: ["scanner_unavailable"]
        };
      }

      return {
        fileId: reference.id,
        status: payload.status,
        providerKey: input.key ?? "clamav-http",
        scannedAt: payload.scannedAt ?? new Date().toISOString(),
        signature: payload.signature ?? null,
        findings: payload.findings ?? []
      };
    },
    async verifyScanEvent({ headers, body, secret }) {
      if (secret) {
        const signature = headerValue(headers["x-raring2go-scanner-signature"]);
        verifyHmacSignature(body, secret, signature, "Scanner webhook");
      }

      const payload = JSON.parse(body) as FileScanResult;
      return {
        fileId: payload.fileId,
        status: payload.status,
        providerKey: payload.providerKey ?? input.key ?? "clamav-http",
        scannedAt: payload.scannedAt,
        signature: payload.signature ?? null,
        findings: payload.findings ?? []
      };
    }
  } satisfies FileScannerProvider;
}

export function createScannerProviderFromEnv(source: NodeJS.ProcessEnv = process.env) {
  const provider = source.SCANNER_PROVIDER ?? "memory";

  if (provider === "memory") {
    return createMemoryScannerProvider();
  }

  if (provider === "clamav-http") {
    if (!source.CLAMAV_SCANNER_ENDPOINT) {
      throw new Error("SCANNER_PROVIDER=clamav-http requires CLAMAV_SCANNER_ENDPOINT.");
    }

    return createClamAvHttpScannerProvider({
      endpoint: source.CLAMAV_SCANNER_ENDPOINT,
      apiKey: source.CLAMAV_SCANNER_API_KEY
    });
  }

  throw new Error(`Unsupported scanner provider: ${provider}`);
}

export function applyScanResult(reference: FileReference, result: FileScanResult): FileReference {
  if (reference.id !== result.fileId) {
    throw new Error("Scan result does not match the file reference.");
  }

  return {
    ...reference,
    virusScanStatus: result.status,
    metadata: {
      ...reference.metadata,
      scan: {
        providerKey: result.providerKey,
        scannedAt: result.scannedAt,
        findings: result.findings ?? []
      }
    }
  };
}

export function verifySignedStorageUrl(
  input: {
    action: "upload" | "download";
    storageKey: string;
    expiresAt: string;
    signature: string;
  },
  secret: string,
  now = new Date()
) {
  if (new Date(input.expiresAt) <= now) {
    return false;
  }

  const expected = storageSignature(input.action, input.storageKey, input.expiresAt, secret);
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(input.signature, "hex");

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function secondsFromNow(seconds: number) {
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function signedUrl(baseUrl: string, action: "upload" | "download", storageKey: string, expiresAt: string, secret: string) {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/${action}/${encodeURIComponent(storageKey)}`);
  url.searchParams.set("expiresAt", expiresAt);
  url.searchParams.set("signature", storageSignature(action, storageKey, expiresAt, secret));
  return url.toString();
}

function storageSignature(action: "upload" | "download", storageKey: string, expiresAt: string, secret: string) {
  return createHmac("sha256", secret).update(`${action}:${storageKey}:${expiresAt}`).digest("hex");
}

function r2SignedUrl(input: {
  method: "DELETE" | "GET" | "PUT";
  endpoint: string;
  bucket: string;
  storageKey: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresInSeconds: number;
  now: Date;
  responseContentDisposition?: string;
}) {
  assertSafeStorageKey(input.storageKey);
  const amzDate = formatAmzDate(input.now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const credential = `${input.accessKeyId}/${credentialScope}`;
  const host = new URL(input.endpoint).host;
  const path = `/${input.bucket}/${input.storageKey.split("/").map(encodeURIComponent).join("/")}`;
  const expiresAt = new Date(input.now.getTime() + input.expiresInSeconds * 1_000).toISOString();
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": "host"
  });

  if (input.responseContentDisposition) {
    query.set("response-content-disposition", input.responseContentDisposition);
  }

  const canonicalQuery = canonicalQueryString(query);
  const canonicalRequest = [
    input.method,
    path,
    canonicalQuery,
    `host:${host}`,
    "",
    "host",
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signature = hmacHex(signingKey(input.secretAccessKey, dateStamp), stringToSign);
  query.set("X-Amz-Signature", signature);

  return {
    url: `${input.endpoint}${path}?${canonicalQueryString(query)}`,
    expiresAt
  };
}

function canonicalQueryString(params: URLSearchParams) {
  return [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function formatAmzDate(value: Date) {
  return value.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function signingKey(secretAccessKey: string, dateStamp: string) {
  const dateKey = createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const regionKey = createHmac("sha256", dateKey).update("auto").digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

function hmacHex(key: Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function verifyHmacSignature(body: string, secret: string, signature: string | undefined, label: string) {
  if (!signature) {
    throw new Error(`${label} signature is required.`);
  }

  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error(`${label} signature is invalid.`);
  }
}
