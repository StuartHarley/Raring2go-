import { createHash, randomBytes, randomUUID } from "node:crypto";
import { auditActions } from "@raring2go/audit";
import { requirePermission, type PermissionData } from "@raring2go/permissions";
import type { SecretStore } from "./secrets";

export type ProviderConnectionStatus = "pending" | "connected" | "degraded" | "expired" | "revoked" | "failed";
export type ProviderConnectionHealth = "healthy" | "degraded" | "expired" | "revoked" | "unknown";

export type IntegrationActorContext = {
  userId: string;
  organisationId?: string | null;
  territoryId?: string | null;
};

export type ProviderConnection = {
  id: string;
  provider: string;
  connectionType: string;
  organisationId?: string | null;
  territoryId?: string | null;
  externalAccountId: string;
  externalAccountDisplayName: string;
  status: ProviderConnectionStatus;
  grantedScopes: string[];
  tokenExpiryAt?: string | Date | null;
  lastHealthCheckAt?: string | Date | null;
  lastHealthStatus: ProviderConnectionHealth;
  lastFailureCode?: string | null;
  lastFailureSummary?: string | null;
  connectedByUserId?: string | null;
  connectedAt?: string | Date | null;
  refreshedAt?: string | Date | null;
  revokedAt?: string | Date | null;
  secretRef?: string | null;
  providerSafeMetadata: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type OAuthConnectionTransaction = {
  id: string;
  stateHash: string;
  codeVerifierHash?: string | null;
  provider: string;
  connectionType: string;
  organisationId?: string | null;
  territoryId?: string | null;
  requestedByUserId: string;
  returnTo: string;
  expiresAt: Date;
  usedAt?: Date | null;
  providerSafeMetadata: Record<string, unknown>;
};

export type ProviderConnectionRepository = {
  upsertConnection(input: ProviderConnection): Promise<ProviderConnection>;
  getConnection(id: string): Promise<ProviderConnection | undefined>;
  listConnections(input: {
    provider?: string;
    connectionType?: string;
    organisationId?: string | null;
    territoryId?: string | null;
  }): Promise<ProviderConnection[]>;
  updateConnection(id: string, patch: Partial<ProviderConnection>): Promise<ProviderConnection>;
  createOAuthTransaction(input: OAuthConnectionTransaction): Promise<OAuthConnectionTransaction>;
  consumeOAuthTransaction(input: {
    stateHash: string;
    userId: string;
    now: Date;
  }): Promise<OAuthConnectionTransaction>;
};

export type IntegrationAuditRecorder = {
  record(event: {
    action: string;
    actorUserId?: string | null;
    entityType: string;
    entityId?: string | null;
    organisationId?: string | null;
    territoryId?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void>;
};

export const integrationCapabilities = {
  view: { module: "integrations", action: "view" },
  connect: { module: "integrations", action: "connect" },
  reconnect: { module: "integrations", action: "reconnect" },
  revoke: { module: "integrations", action: "revoke" },
  test: { module: "integrations", action: "test" }
} as const;

export function requireIntegrationPermission(
  context: IntegrationActorContext,
  permissions: PermissionData,
  capability: keyof typeof integrationCapabilities,
  resource?: { organisationId?: string | null; territoryId?: string | null }
) {
  const descriptor = integrationCapabilities[capability];
  return requirePermission({
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
  }, permissions);
}

export async function createOAuthConnectionTransaction(input: {
  context: IntegrationActorContext;
  permissions: PermissionData;
  repository: ProviderConnectionRepository;
  provider: string;
  connectionType: string;
  returnTo?: string;
  now?: Date;
}) {
  requireIntegrationPermission(input.context, input.permissions, "connect");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const now = input.now ?? new Date();
  const transaction = await input.repository.createOAuthTransaction({
    id: randomUUID(),
    stateHash: hashOAuthValue(state),
    codeVerifierHash: hashOAuthValue(verifier),
    provider: input.provider,
    connectionType: input.connectionType,
    organisationId: input.context.organisationId,
    territoryId: input.context.territoryId,
    requestedByUserId: input.context.userId,
    returnTo: safeInternalReturnTo(input.returnTo),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    providerSafeMetadata: {}
  });

  return { state, codeVerifier: verifier, transaction };
}

export async function completeProviderConnection(input: {
  context: IntegrationActorContext;
  permissions: PermissionData;
  repository: ProviderConnectionRepository;
  secretStore: SecretStore;
  audit: IntegrationAuditRecorder;
  provider: string;
  connectionType: string;
  externalAccountId: string;
  externalAccountDisplayName: string;
  grantedScopes: string[];
  token: string;
  tokenExpiryAt?: Date | null;
  providerSafeMetadata?: Record<string, unknown>;
}) {
  requireIntegrationPermission(input.context, input.permissions, "connect", input.context);
  const connectionId = randomUUID();
  const storedSecret = await input.secretStore.set({
    providerConnectionId: connectionId,
    value: input.token,
    additionalAuthenticatedData: connectionId
  });
  const now = new Date();
  const connection = await input.repository.upsertConnection({
    id: connectionId,
    provider: input.provider,
    connectionType: input.connectionType,
    organisationId: input.context.organisationId,
    territoryId: input.context.territoryId,
    externalAccountId: input.externalAccountId,
    externalAccountDisplayName: input.externalAccountDisplayName,
    status: "connected",
    grantedScopes: input.grantedScopes,
    tokenExpiryAt: input.tokenExpiryAt,
    lastHealthCheckAt: now,
    lastHealthStatus: "healthy",
    lastFailureCode: null,
    lastFailureSummary: null,
    connectedByUserId: input.context.userId,
    connectedAt: now,
    refreshedAt: now,
    revokedAt: null,
    secretRef: storedSecret.secretRef,
    providerSafeMetadata: {
      ...(input.providerSafeMetadata ?? {}),
      keyVersion: storedSecret.keyVersion
    }
  });

  await input.audit.record({
    action: auditActions.integrationConnected,
    actorUserId: input.context.userId,
    entityType: "provider_connection",
    entityId: connection.id,
    organisationId: connection.organisationId,
    territoryId: connection.territoryId,
    payload: safeConnectionAuditPayload(connection, { result: "connected" })
  });

  return connection;
}

export async function revokeProviderConnection(input: {
  context: IntegrationActorContext;
  permissions: PermissionData;
  repository: ProviderConnectionRepository;
  secretStore: SecretStore;
  audit: IntegrationAuditRecorder;
  connectionId: string;
}) {
  const connection = await requireScopedConnection(input);
  requireIntegrationPermission(input.context, input.permissions, "revoke", connection);
  if (connection.secretRef) {
    await input.secretStore.delete(connection.secretRef);
  }
  const revoked = await input.repository.updateConnection(connection.id, {
    status: "revoked",
    lastHealthStatus: "revoked",
    revokedAt: new Date(),
    secretRef: null
  });
  await input.audit.record({
    action: auditActions.integrationRevoked,
    actorUserId: input.context.userId,
    entityType: "provider_connection",
    entityId: revoked.id,
    organisationId: revoked.organisationId,
    territoryId: revoked.territoryId,
    payload: safeConnectionAuditPayload(revoked, { result: "revoked" })
  });
  return revoked;
}

export async function getConnectionCredential(input: {
  connection: ProviderConnection;
  secretStore: SecretStore;
}) {
  if (input.connection.status === "revoked" || input.connection.status === "expired" || !input.connection.secretRef) {
    throw new Error("Provider connection is not usable.");
  }
  return input.secretStore.get({
    secretRef: input.connection.secretRef,
    additionalAuthenticatedData: input.connection.id
  });
}

export function hashOAuthValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeInternalReturnTo(value?: string | null) {
  if (!value) return "/app/settings/connections";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://")) {
    return "/app/settings/connections";
  }
  return value;
}

export function safeConnectionAuditPayload(
  connection: ProviderConnection,
  extra: Record<string, unknown> = {}
) {
  return {
    provider: connection.provider,
    connectionType: connection.connectionType,
    externalAccountId: connection.externalAccountId,
    externalAccountDisplayName: connection.externalAccountDisplayName,
    status: connection.status,
    lastHealthStatus: connection.lastHealthStatus,
    ...extra
  };
}

async function requireScopedConnection(input: {
  context: IntegrationActorContext;
  repository: ProviderConnectionRepository;
  connectionId: string;
}) {
  const connection = await input.repository.getConnection(input.connectionId);
  if (!connection || connection.deletedAt) {
    throw new Error("Provider connection was not found.");
  }
  if (input.context.territoryId && connection.territoryId !== input.context.territoryId) {
    throw new Error("Provider connection is outside the active territory.");
  }
  if (input.context.organisationId && connection.organisationId !== input.context.organisationId) {
    throw new Error("Provider connection is outside the active organisation.");
  }
  return connection;
}

export function createMemoryProviderConnectionRepository(
  seed: ProviderConnection[] = []
): ProviderConnectionRepository & {
  connections: ProviderConnection[];
  transactions: OAuthConnectionTransaction[];
} {
  const connections = [...seed];
  const transactions: OAuthConnectionTransaction[] = [];

  return {
    connections,
    transactions,
    async upsertConnection(input) {
      const existing = connections.find((connection) =>
        connection.provider === input.provider &&
        connection.connectionType === input.connectionType &&
        connection.externalAccountId === input.externalAccountId &&
        connection.organisationId === input.organisationId &&
        connection.territoryId === input.territoryId &&
        !connection.deletedAt
      );
      if (existing) {
        Object.assign(existing, input, { id: existing.id });
        return existing;
      }
      connections.push(input);
      return input;
    },
    async getConnection(id) {
      return connections.find((connection) => connection.id === id && !connection.deletedAt);
    },
    async listConnections(filter) {
      return connections.filter((connection) =>
        !connection.deletedAt &&
        (!filter.provider || connection.provider === filter.provider) &&
        (!filter.connectionType || connection.connectionType === filter.connectionType) &&
        (filter.organisationId === undefined || connection.organisationId === filter.organisationId) &&
        (filter.territoryId === undefined || connection.territoryId === filter.territoryId)
      );
    },
    async updateConnection(id, patch) {
      const connection = connections.find((candidate) => candidate.id === id && !candidate.deletedAt);
      if (!connection) throw new Error("Provider connection was not found.");
      Object.assign(connection, patch);
      return connection;
    },
    async createOAuthTransaction(input) {
      transactions.push(input);
      return input;
    },
    async consumeOAuthTransaction({ stateHash, userId, now }) {
      const transaction = transactions.find((candidate) => candidate.stateHash === stateHash);
      if (!transaction) throw new Error("OAuth state was not found.");
      if (transaction.requestedByUserId !== userId) throw new Error("OAuth state does not match the signed-in user.");
      if (transaction.usedAt) throw new Error("OAuth state was already used.");
      if (transaction.expiresAt.getTime() <= now.getTime()) throw new Error("OAuth state has expired.");
      transaction.usedAt = now;
      return transaction;
    }
  };
}
