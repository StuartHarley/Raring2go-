import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEncryptedSecretStore, createMemorySecretRepository } from "./secrets";

const key = randomBytes(32).toString("base64");
const wrongKey = randomBytes(32).toString("base64");

describe("encrypted SecretStore", () => {
  it("stores encrypted credentials without plaintext persistence", async () => {
    const repository = createMemorySecretRepository();
    const store = createEncryptedSecretStore({ repository, encryptionKey: key, keyVersion: "v1" });

    const written = await store.set({
      providerConnectionId: "connection_1",
      value: "page-token",
      additionalAuthenticatedData: "connection_1"
    });

    expect(repository.records[0]?.ciphertext).not.toContain("page-token");
    await expect(store.get({
      secretRef: written.secretRef,
      additionalAuthenticatedData: "connection_1"
    })).resolves.toBe("page-token");
  });

  it("fails safely with the wrong key or tampered ciphertext", async () => {
    const repository = createMemorySecretRepository();
    const store = createEncryptedSecretStore({ repository, encryptionKey: key, keyVersion: "v1" });
    const written = await store.set({ value: "page-token", additionalAuthenticatedData: "connection_1" });
    const wrongStore = createEncryptedSecretStore({ repository, encryptionKey: wrongKey, keyVersion: "v1" });

    await expect(wrongStore.get({
      secretRef: written.secretRef,
      additionalAuthenticatedData: "connection_1"
    })).rejects.toThrow("failed authentication");

    repository.records[0]!.ciphertext = Buffer.from("tampered").toString("base64");
    await expect(store.get({
      secretRef: written.secretRef,
      additionalAuthenticatedData: "connection_1"
    })).rejects.toThrow("failed authentication");
  });

  it("deletes secret material so revoked connections cannot retrieve credentials", async () => {
    const repository = createMemorySecretRepository();
    const store = createEncryptedSecretStore({ repository, encryptionKey: key, keyVersion: "v1" });
    const written = await store.set({ value: "page-token" });

    await store.delete(written.secretRef);

    await expect(store.get({ secretRef: written.secretRef })).rejects.toThrow("unavailable");
  });
});
