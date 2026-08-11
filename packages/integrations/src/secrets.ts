import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

const algorithm = "aes-256-gcm";
const ivBytes = 12;

export type SecretStoreRecord = {
  id: string;
  providerConnectionId?: string | null;
  secretRef: string;
  backend: string;
  keyVersion: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  deletedAt?: Date | null;
};

export type SecretStoreRepository = {
  write(record: Omit<SecretStoreRecord, "id"> & { id?: string }): Promise<SecretStoreRecord>;
  read(secretRef: string): Promise<SecretStoreRecord | undefined>;
  delete(secretRef: string): Promise<void>;
};

export type SecretStore = {
  set(input: {
    providerConnectionId?: string | null;
    value: string;
    additionalAuthenticatedData?: string;
  }): Promise<{ secretRef: string; keyVersion: string }>;
  get(input: {
    secretRef: string;
    additionalAuthenticatedData?: string;
  }): Promise<string>;
  delete(secretRef: string): Promise<void>;
};

export function createEncryptedSecretStore(input: {
  repository: SecretStoreRepository;
  encryptionKey: string;
  keyVersion: string;
}): SecretStore {
  const key = parseEncryptionKey(input.encryptionKey);

  return {
    async set(secret) {
      const secretRef = `secret_${randomUUID()}`;
      const iv = randomBytes(ivBytes);
      const cipher = createCipheriv(algorithm, key, iv);
      const aad = secret.additionalAuthenticatedData ?? secretRef;
      cipher.setAAD(Buffer.from(aad, "utf8"));
      const ciphertext = Buffer.concat([
        cipher.update(secret.value, "utf8"),
        cipher.final()
      ]);
      const authTag = cipher.getAuthTag();
      const record = await input.repository.write({
        providerConnectionId: secret.providerConnectionId,
        secretRef,
        backend: "postgres_aes_256_gcm",
        keyVersion: input.keyVersion,
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64")
      });

      return {
        secretRef: record.secretRef,
        keyVersion: record.keyVersion
      };
    },
    async get(secret) {
      const record = await input.repository.read(secret.secretRef);
      if (!record || record.deletedAt) {
        throw new Error("Secret material is unavailable.");
      }
      if (record.keyVersion !== input.keyVersion) {
        throw new Error("Secret material key version is not available.");
      }

      const decipher = createDecipheriv(
        algorithm,
        key,
        Buffer.from(record.iv, "base64")
      );
      decipher.setAAD(Buffer.from(secret.additionalAuthenticatedData ?? record.secretRef, "utf8"));
      decipher.setAuthTag(Buffer.from(record.authTag, "base64"));

      try {
        return Buffer.concat([
          decipher.update(Buffer.from(record.ciphertext, "base64")),
          decipher.final()
        ]).toString("utf8");
      } catch {
        throw new Error("Secret material failed authentication.");
      }
    },
    async delete(secretRef) {
      await input.repository.delete(secretRef);
    }
  };
}

export function createMemorySecretRepository(): SecretStoreRepository & { records: SecretStoreRecord[] } {
  const records: SecretStoreRecord[] = [];

  return {
    records,
    async write(record) {
      const stored = {
        id: record.id ?? randomUUID(),
        ...record
      };
      records.push(stored);
      return stored;
    },
    async read(secretRef) {
      return records.find((record) => record.secretRef === secretRef && !record.deletedAt);
    },
    async delete(secretRef) {
      const record = records.find((candidate) => candidate.secretRef === secretRef && !candidate.deletedAt);
      if (record) {
        record.deletedAt = new Date();
      }
    }
  };
}

export function parseEncryptionKey(value: string) {
  const buffer = Buffer.from(value, "base64");
  if (buffer.length !== 32) {
    throw new Error("INTEGRATION_SECRET_ENCRYPTION_KEY must be a base64 encoded 32-byte key.");
  }
  return buffer;
}
