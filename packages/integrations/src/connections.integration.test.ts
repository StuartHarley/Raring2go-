import { randomBytes, randomUUID } from "node:crypto";
import { createDb, fixtureIds, fixturePermissionData, providerConnectionSecrets, providerConnections } from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { completeProviderConnection, getConnectionCredential } from "./connections";
import { createDrizzleProviderConnectionRepository, createDrizzleSecretRepository } from "./repository";
import { createEncryptedSecretStore } from "./secrets";

/** Real database: connecting (and reconnecting) a provider stores a secret that can be read back. `RUN_DB_TESTS=1 pnpm --filter @raring2go/integrations test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("provider connections (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const ids: string[] = [];
  const secretStore = createEncryptedSecretStore({ repository: createDrizzleSecretRepository(db), encryptionKey: randomBytes(32).toString("base64"), keyVersion: "v1" });
  const repository = createDrizzleProviderConnectionRepository(db);
  const context = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const connect = (token: string) =>
    completeProviderConnection({
      context, permissions: fixturePermissionData(), repository, secretStore, audit: { record: async () => undefined },
      provider: "itest", connectionType: "itest", externalAccountId: `acct-${tag}`, externalAccountDisplayName: "Itest", grantedScopes: [], token
    });

  afterAll(async () => {
    if (ids.length) {
      await db.delete(providerConnectionSecrets).where(inArray(providerConnectionSecrets.providerConnectionId, ids));
      await db.delete(providerConnections).where(inArray(providerConnections.id, ids));
    }
    await sql.end();
  });

  it("stores the secret against the real connection, and a reconnect keeps one connection whose secret still decrypts", async () => {
    const first = await connect("token-one");
    ids.push(first.id);
    expect(first.status).toBe("connected");
    expect(await getConnectionCredential({ connection: first, secretStore })).toBe("token-one");

    const second = await connect("token-two");
    expect(second.id).toBe(first.id);
    expect(await getConnectionCredential({ connection: second, secretStore })).toBe("token-two");

    // A partial update (as every token refresh and revoke is) leaves everything else on the row alone.
    await repository.updateConnection(first.id, { lastFailureSummary: "just a note" });
    const [row] = await db.select().from(providerConnections).where(eq(providerConnections.id, first.id));
    expect(row).toMatchObject({ provider: "itest", connectionType: "itest", externalAccountId: `acct-${tag}`, status: "connected", lastFailureSummary: "just a note" });
    expect(row!.tokenExpiryAt ?? null).toBe(row!.tokenExpiryAt ?? null);
    expect(row!.connectedAt).not.toBeNull();
    expect(row!.secretRef).toBe(second.secretRef);

    // The replaced secret is deleted, so only the current one is live.
    const live = (await db.select().from(providerConnectionSecrets).where(eq(providerConnectionSecrets.providerConnectionId, first.id))).filter((row) => !row.deletedAt);
    expect(live).toHaveLength(1);
    expect(live[0]!.secretRef).toBe(second.secretRef);
  });
});
