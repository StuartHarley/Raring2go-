import {
  oauthConnectionTransactions,
  providerConnectionSecrets,
  providerConnections
} from "@raring2go/db";
import { and, eq, isNull } from "drizzle-orm";
import type {
  OAuthConnectionTransaction,
  ProviderConnection,
  ProviderConnectionRepository
} from "./connections";
import type { SecretStoreRecord, SecretStoreRepository } from "./secrets";

type Db = {
  insert(table: unknown): {
    values(value: Record<string, unknown>): {
      onConflictDoUpdate?(input: unknown): { returning(): Promise<Array<Record<string, unknown>>> };
      returning(): Promise<Array<Record<string, unknown>>>;
    };
  };
  update(table: unknown): {
    set(value: Record<string, unknown>): {
      where(value: unknown): { returning(): Promise<Array<Record<string, unknown>>> };
    };
  };
  select(): {
    from(table: unknown): {
      where(value?: unknown): Promise<Array<Record<string, unknown>>>;
    };
  };
};

export function createDrizzleProviderConnectionRepository(db: Db): ProviderConnectionRepository {
  return {
    async upsertConnection(input) {
      const existing = await this.listConnections({
        provider: input.provider,
        connectionType: input.connectionType,
        organisationId: input.organisationId,
        territoryId: input.territoryId
      });
      const matching = existing.find((connection) => connection.externalAccountId === input.externalAccountId);

      if (matching) {
        return this.updateConnection(matching.id, {
          ...input,
          id: matching.id
        });
      }

      const [row] = await db.insert(providerConnections).values(providerConnectionToRow(input)).returning();
      if (!row) throw new Error("Provider connection was not stored.");
      return rowToProviderConnection(row);
    },
    async getConnection(id) {
      const [row] = await db
        .select()
        .from(providerConnections)
        .where(and(eq(providerConnections.id, id), isNull(providerConnections.deletedAt)));
      return row ? rowToProviderConnection(row) : undefined;
    },
    async listConnections(filter) {
      const rows = await db
        .select()
        .from(providerConnections)
        .where(and(
          isNull(providerConnections.deletedAt),
          filter.provider ? eq(providerConnections.provider, filter.provider) : undefined,
          filter.connectionType ? eq(providerConnections.connectionType, filter.connectionType) : undefined,
          filter.organisationId !== undefined
            ? filter.organisationId === null
              ? isNull(providerConnections.organisationId)
              : eq(providerConnections.organisationId, filter.organisationId)
            : undefined,
          filter.territoryId !== undefined
            ? filter.territoryId === null
              ? isNull(providerConnections.territoryId)
              : eq(providerConnections.territoryId, filter.territoryId)
            : undefined
        ));
      return rows.map(rowToProviderConnection);
    },
    async updateConnection(id, patch) {
      const [row] = await db
        .update(providerConnections)
        .set(providerConnectionPatchToRow(patch))
        .where(eq(providerConnections.id, id))
        .returning();
      if (!row) throw new Error("Provider connection was not found.");
      return rowToProviderConnection(row);
    },
    async createOAuthTransaction(input) {
      const [row] = await db.insert(oauthConnectionTransactions).values(oauthTransactionToRow(input)).returning();
      if (!row) throw new Error("OAuth transaction was not stored.");
      return rowToOAuthTransaction(row);
    },
    async consumeOAuthTransaction(input) {
      const [row] = await db
        .select()
        .from(oauthConnectionTransactions)
        .where(eq(oauthConnectionTransactions.stateHash, input.stateHash));
      if (!row) throw new Error("OAuth state was not found.");
      const transaction = rowToOAuthTransaction(row);
      if (transaction.requestedByUserId !== input.userId) throw new Error("OAuth state does not match the signed-in user.");
      if (transaction.usedAt) throw new Error("OAuth state was already used.");
      if (transaction.expiresAt.getTime() <= input.now.getTime()) throw new Error("OAuth state has expired.");
      const [updated] = await db
        .update(oauthConnectionTransactions)
        .set({ usedAt: input.now })
        .where(eq(oauthConnectionTransactions.id, transaction.id))
        .returning();
      if (!updated) throw new Error("OAuth state was not consumed.");
      return rowToOAuthTransaction(updated);
    }
  };
}

export function createDrizzleSecretRepository(db: Db): SecretStoreRepository {
  return {
    async write(record) {
      const [row] = await db.insert(providerConnectionSecrets).values({
        id: record.id,
        providerConnectionId: record.providerConnectionId,
        secretRef: record.secretRef,
        backend: record.backend,
        keyVersion: record.keyVersion,
        ciphertext: record.ciphertext,
        iv: record.iv,
        authTag: record.authTag
      }).returning();
      if (!row) throw new Error("Provider secret was not stored.");
      return rowToSecret(row);
    },
    async read(secretRef) {
      const [row] = await db
        .select()
        .from(providerConnectionSecrets)
        .where(and(eq(providerConnectionSecrets.secretRef, secretRef), isNull(providerConnectionSecrets.deletedAt)));
      return row ? rowToSecret(row) : undefined;
    },
    async delete(secretRef) {
      await db
        .update(providerConnectionSecrets)
        .set({ deletedAt: new Date() })
        .where(eq(providerConnectionSecrets.secretRef, secretRef))
        .returning();
    }
  };
}

function providerConnectionToRow(input: ProviderConnection) {
  return {
    id: input.id,
    provider: input.provider,
    connectionType: input.connectionType,
    organisationId: input.organisationId,
    territoryId: input.territoryId,
    externalAccountId: input.externalAccountId,
    externalAccountDisplayName: input.externalAccountDisplayName,
    status: input.status,
    grantedScopes: input.grantedScopes,
    tokenExpiryAt: input.tokenExpiryAt ? new Date(input.tokenExpiryAt) : null,
    lastHealthCheckAt: input.lastHealthCheckAt ? new Date(input.lastHealthCheckAt) : null,
    lastHealthStatus: input.lastHealthStatus,
    lastFailureCode: input.lastFailureCode,
    lastFailureSummary: input.lastFailureSummary,
    connectedByUserId: input.connectedByUserId,
    connectedAt: input.connectedAt ? new Date(input.connectedAt) : null,
    refreshedAt: input.refreshedAt ? new Date(input.refreshedAt) : null,
    revokedAt: input.revokedAt ? new Date(input.revokedAt) : null,
    secretRef: input.secretRef,
    providerSafeMetadata: input.providerSafeMetadata
  };
}

function providerConnectionPatchToRow(input: Partial<ProviderConnection>) {
  return Object.fromEntries(
    Object.entries(providerConnectionToRow({ ...emptyConnection(), ...input } as ProviderConnection))
      .filter(([key]) => key !== "id")
      .filter(([, value]) => value !== undefined)
  );
}

function oauthTransactionToRow(input: OAuthConnectionTransaction) {
  return {
    id: input.id,
    stateHash: input.stateHash,
    codeVerifierHash: input.codeVerifierHash,
    provider: input.provider,
    connectionType: input.connectionType,
    organisationId: input.organisationId,
    territoryId: input.territoryId,
    requestedByUserId: input.requestedByUserId,
    returnTo: input.returnTo,
    expiresAt: input.expiresAt,
    usedAt: input.usedAt,
    providerSafeMetadata: input.providerSafeMetadata
  };
}

function rowToProviderConnection(row: Record<string, unknown>): ProviderConnection {
  return {
    id: String(row.id),
    provider: String(row.provider),
    connectionType: String(row.connectionType),
    organisationId: row.organisationId as string | null,
    territoryId: row.territoryId as string | null,
    externalAccountId: String(row.externalAccountId),
    externalAccountDisplayName: String(row.externalAccountDisplayName),
    status: row.status as ProviderConnection["status"],
    grantedScopes: row.grantedScopes as string[],
    tokenExpiryAt: row.tokenExpiryAt as Date | null,
    lastHealthCheckAt: row.lastHealthCheckAt as Date | null,
    lastHealthStatus: row.lastHealthStatus as ProviderConnection["lastHealthStatus"],
    lastFailureCode: row.lastFailureCode as string | null,
    lastFailureSummary: row.lastFailureSummary as string | null,
    connectedByUserId: row.connectedByUserId as string | null,
    connectedAt: row.connectedAt as Date | null,
    refreshedAt: row.refreshedAt as Date | null,
    revokedAt: row.revokedAt as Date | null,
    secretRef: row.secretRef as string | null,
    providerSafeMetadata: row.providerSafeMetadata as Record<string, unknown>,
    deletedAt: row.deletedAt as Date | null
  };
}

function rowToOAuthTransaction(row: Record<string, unknown>): OAuthConnectionTransaction {
  return {
    id: String(row.id),
    stateHash: String(row.stateHash),
    codeVerifierHash: row.codeVerifierHash as string | null,
    provider: String(row.provider),
    connectionType: String(row.connectionType),
    organisationId: row.organisationId as string | null,
    territoryId: row.territoryId as string | null,
    requestedByUserId: String(row.requestedByUserId),
    returnTo: String(row.returnTo),
    expiresAt: row.expiresAt as Date,
    usedAt: row.usedAt as Date | null,
    providerSafeMetadata: row.providerSafeMetadata as Record<string, unknown>
  };
}

function rowToSecret(row: Record<string, unknown>): SecretStoreRecord {
  return {
    id: String(row.id),
    providerConnectionId: row.providerConnectionId as string | null,
    secretRef: String(row.secretRef),
    backend: String(row.backend),
    keyVersion: String(row.keyVersion),
    ciphertext: String(row.ciphertext),
    iv: String(row.iv),
    authTag: String(row.authTag),
    deletedAt: row.deletedAt as Date | null
  };
}

function emptyConnection(): ProviderConnection {
  return {
    id: "",
    provider: "",
    connectionType: "",
    externalAccountId: "",
    externalAccountDisplayName: "",
    status: "pending",
    grantedScopes: [],
    lastHealthStatus: "unknown",
    providerSafeMetadata: {}
  };
}
