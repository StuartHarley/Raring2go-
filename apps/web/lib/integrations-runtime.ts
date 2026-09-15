import { createDb, fixtureIds, foundationSeed, socialAccounts } from "@raring2go/db";
import {
  completeProviderConnection,
  createDrizzleProviderConnectionRepository,
  createDrizzleSecretRepository,
  createEncryptedSecretStore,
  createMetaAuthorizationUrl,
  createMicrosoftAuthorizationUrl,
  createOAuthConnectionTransaction,
  exchangeMicrosoftOAuthCode,
  getConnectionCredential,
  getMicrosoftMailboxIdentity,
  hashOAuthValue,
  integrationCapabilities,
  listMetaFacebookPages,
  refreshMicrosoftAccessToken,
  revokeProviderConnection,
  safeInternalReturnTo
} from "@raring2go/integrations";
import { recordAuditEvent } from "@raring2go/audit";
import { eq } from "drizzle-orm";
import type { PermissionData } from "@raring2go/permissions";
import type { ProviderConnection } from "@raring2go/integrations";
import type { RequestedShellContext } from "./app-shell";
import { requireShellPermission, resolveShell } from "./app-shell";

export const integrationsPermissionData: PermissionData = {
  roleAssignments: [
    {
      id: "fixture_assignment_hq",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.hqAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_franchisee",
      userId: fixtureIds.users.franchisee,
      roleId: fixtureIds.roles.franchisee,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield
    }
  ],
  rolePermissions: [
    ...Object.entries(integrationCapabilities).flatMap(([key, capability]) => [
      grant(fixtureIds.roles.hqAdmin, capability, "network"),
      grant(fixtureIds.roles.franchisee, capability, "own_territory", key)
    ])
  ],
  territories: foundationSeed.territories.map((territory) => ({
    id: territory.id,
    franchiseOrganisationId: territory.franchiseOrganisationId
  }))
};

export async function listConnectionCards(
  request: RequestedShellContext,
  provider: string = "meta",
  connectionType: string = "facebook_page"
) {
  const shell = await requireShellPermission(request, { module: "integrations", action: "view" });
  const { db, sql } = createDb();

  try {
    const repository = createDrizzleProviderConnectionRepository(db);
    const connections = await repository.listConnections({
      provider,
      connectionType,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId ?? undefined
    });

    return {
      shell,
      connections: connections.map((connection: ProviderConnection) => ({
        id: connection.id,
        provider: connection.provider,
        connectionType: connection.connectionType,
        externalAccountDisplayName: connection.externalAccountDisplayName,
        externalAccountId: connection.externalAccountId,
        status: connection.status,
        lastHealthStatus: connection.lastHealthStatus,
        lastHealthCheckAt: connection.lastHealthCheckAt,
        lastFailureSummary: connection.lastFailureSummary
      }))
    };
  } finally {
    await sql.end();
  }
}

export async function startMetaConnection(request: RequestedShellContext, returnTo?: string | null) {
  const shell = await requireShellPermission(request, { module: "integrations", action: "connect" });
  const { db, sql } = createDb();

  try {
    const repository = createDrizzleProviderConnectionRepository(db);
    const transaction = await createOAuthConnectionTransaction({
      context: {
        userId: shell.userId,
        organisationId: shell.activeContext.organisationId,
        territoryId: shell.activeContext.territoryId
      },
      permissions: integrationsPermissionData,
      repository,
      provider: "meta",
      connectionType: "facebook_page",
      returnTo: safeInternalReturnTo(returnTo)
    });
    const config = metaConfig();
    const url = createMetaAuthorizationUrl({
      config,
      state: transaction.state
    });
    return url;
  } finally {
    await sql.end();
  }
}

export async function completeMetaConnection(input: {
  request: RequestedShellContext;
  state: string;
  code: string;
  selectedPageId?: string | null;
}) {
  const shell = await resolveShell(input.request);
  if (shell.kind !== "authenticated") {
    throw new Error("Meta OAuth callback requires an active session.");
  }
  const { db, sql } = createDb();

  try {
    const repository = createDrizzleProviderConnectionRepository(db);
    const transaction = await repository.consumeOAuthTransaction({
      stateHash: hashOAuthValue(input.state),
      userId: shell.userId,
      now: new Date()
    });
    const config = metaConfig();
    const token = await import("@raring2go/integrations").then(({ exchangeMetaOAuthCode }) =>
      exchangeMetaOAuthCode({ config, code: input.code })
    );
    const pages = await listMetaFacebookPages({
      userAccessToken: token.accessToken,
      graphApiVersion: config.graphApiVersion
    });

    if (pages.length === 0) {
      throw new Error("No eligible Facebook Pages were returned by Meta.");
    }
    if (pages.length > 1 && !input.selectedPageId) {
      return {
        kind: "page_selection_required" as const,
        pages: pages.map((page: { id: string; name: string; grantedScopes: string[] }) => ({
          id: page.id,
          name: page.name,
          grantedScopes: page.grantedScopes
        })),
        returnTo: transaction.returnTo
      };
    }
    const page = input.selectedPageId
      ? pages.find((candidate: { id: string }) => candidate.id === input.selectedPageId)
      : pages[0];
    if (!page) {
      throw new Error("Selected Facebook Page was not eligible.");
    }

    const secretStore = createEncryptedSecretStore({
      repository: createDrizzleSecretRepository(db),
      encryptionKey: requiredEnv("INTEGRATION_SECRET_ENCRYPTION_KEY"),
      keyVersion: process.env.INTEGRATION_SECRET_KEY_VERSION ?? "v1"
    });
    const audit = drizzleAuditRecorder(db);
    const connection = await completeProviderConnection({
      context: {
        userId: shell.userId,
        organisationId: transaction.organisationId,
        territoryId: transaction.territoryId
      },
      permissions: integrationsPermissionData,
      repository,
      secretStore,
      audit,
      provider: "meta",
      connectionType: "facebook_page",
      externalAccountId: page.id,
      externalAccountDisplayName: page.name,
      grantedScopes: page.grantedScopes,
      token: page.accessToken,
      tokenExpiryAt: page.expiresAt,
      providerSafeMetadata: page.safeMetadata
    });

    await upsertSocialAccount(db, {
      connectionId: connection.id,
      organisationId: connection.organisationId,
      territoryId: connection.territoryId,
      pageId: page.id,
      pageName: page.name
    });

    return {
      kind: "connected" as const,
      connection,
      returnTo: transaction.returnTo
    };
  } finally {
    await sql.end();
  }
}

export async function disconnectMetaConnection(request: RequestedShellContext, connectionId: string) {
  const shell = await requireShellPermission(request, { module: "integrations", action: "revoke" });
  const { db, sql } = createDb();

  try {
    const repository = createDrizzleProviderConnectionRepository(db);
    const secretStore = createEncryptedSecretStore({
      repository: createDrizzleSecretRepository(db),
      encryptionKey: requiredEnv("INTEGRATION_SECRET_ENCRYPTION_KEY"),
      keyVersion: process.env.INTEGRATION_SECRET_KEY_VERSION ?? "v1"
    });
    return revokeProviderConnection({
      context: {
        userId: shell.userId,
        organisationId: shell.activeContext.organisationId,
        territoryId: shell.activeContext.territoryId
      },
      permissions: integrationsPermissionData,
      repository,
      secretStore,
      audit: drizzleAuditRecorder(db),
      connectionId
    });
  } finally {
    await sql.end();
  }
}

export const disconnectMicrosoftConnection = disconnectMetaConnection;

export async function startMicrosoftConnection(request: RequestedShellContext, returnTo?: string | null) {
  const shell = await requireShellPermission(request, { module: "integrations", action: "connect" });
  const { db, sql } = createDb();

  try {
    const repository = createDrizzleProviderConnectionRepository(db);
    const transaction = await createOAuthConnectionTransaction({
      context: {
        userId: shell.userId,
        organisationId: shell.activeContext.organisationId,
        territoryId: shell.activeContext.territoryId
      },
      permissions: integrationsPermissionData,
      repository,
      provider: "microsoft",
      connectionType: "outlook_mailbox",
      returnTo: safeInternalReturnTo(returnTo)
    });
    return createMicrosoftAuthorizationUrl({
      config: microsoftConfig(),
      state: transaction.state
    });
  } finally {
    await sql.end();
  }
}

export async function completeMicrosoftConnection(input: {
  request: RequestedShellContext;
  state: string;
  code: string;
}) {
  const shell = await resolveShell(input.request);
  if (shell.kind !== "authenticated") {
    throw new Error("Microsoft OAuth callback requires an active session.");
  }
  const { db, sql } = createDb();

  try {
    const repository = createDrizzleProviderConnectionRepository(db);
    const transaction = await repository.consumeOAuthTransaction({
      stateHash: hashOAuthValue(input.state),
      userId: shell.userId,
      now: new Date()
    });
    const config = microsoftConfig();
    const token = await exchangeMicrosoftOAuthCode({ config, code: input.code });
    const mailbox = await getMicrosoftMailboxIdentity({ accessToken: token.accessToken });

    const secretStore = createEncryptedSecretStore({
      repository: createDrizzleSecretRepository(db),
      encryptionKey: requiredEnv("INTEGRATION_SECRET_ENCRYPTION_KEY"),
      keyVersion: process.env.INTEGRATION_SECRET_KEY_VERSION ?? "v1"
    });
    const connection = await completeProviderConnection({
      context: {
        userId: shell.userId,
        organisationId: transaction.organisationId,
        territoryId: transaction.territoryId
      },
      permissions: integrationsPermissionData,
      repository,
      secretStore,
      audit: drizzleAuditRecorder(db),
      provider: "microsoft",
      connectionType: "outlook_mailbox",
      externalAccountId: mailbox.id,
      externalAccountDisplayName: mailbox.mail ?? mailbox.userPrincipalName ?? mailbox.displayName,
      grantedScopes: typeof token.safeMetadata.scope === "string" ? token.safeMetadata.scope.split(" ") : config.scopes,
      token: JSON.stringify({ accessToken: token.accessToken, refreshToken: token.refreshToken }),
      tokenExpiryAt: token.expiresAt,
      providerSafeMetadata: { ...token.safeMetadata, displayName: mailbox.displayName }
    });

    return { connection, returnTo: transaction.returnTo };
  } finally {
    await sql.end();
  }
}

function microsoftConfig() {
  return {
    clientId: requiredEnv("MICROSOFT_CLIENT_ID"),
    clientSecret: requiredEnv("MICROSOFT_CLIENT_SECRET"),
    tenantId: process.env.MICROSOFT_TENANT_ID ?? "common",
    redirectUri: requiredEnv("MICROSOFT_OAUTH_REDIRECT_URI"),
    scopes: (process.env.MICROSOFT_OAUTH_SCOPES ?? "Mail.Send offline_access User.Read").split(" ").map((scope) => scope.trim())
  };
}

type StoredMicrosoftToken = { accessToken: string; refreshToken: string | null };

export async function getValidMicrosoftAccessToken(connectionId: string): Promise<string> {
  const { db, sql } = createDb();

  try {
    const repository = createDrizzleProviderConnectionRepository(db);
    const connection = await repository.getConnection(connectionId);

    if (!connection || connection.provider !== "microsoft" || connection.status !== "connected") {
      throw new Error("Outlook mailbox connection is not available.");
    }

    const secretStore = createEncryptedSecretStore({
      repository: createDrizzleSecretRepository(db),
      encryptionKey: requiredEnv("INTEGRATION_SECRET_ENCRYPTION_KEY"),
      keyVersion: process.env.INTEGRATION_SECRET_KEY_VERSION ?? "v1"
    });
    const stored = JSON.parse(await getConnectionCredential({ connection, secretStore })) as StoredMicrosoftToken;
    const expiresSoon = !connection.tokenExpiryAt || new Date(connection.tokenExpiryAt).getTime() < Date.now() + 60_000;

    if (!expiresSoon) {
      return stored.accessToken;
    }

    if (!stored.refreshToken) {
      await repository.updateConnection(connection.id, {
        status: "expired",
        lastHealthStatus: "expired",
        lastFailureSummary: "Outlook access token expired and no refresh token is available. Reconnect required.",
        lastHealthCheckAt: new Date()
      });
      throw new Error("Outlook mailbox connection has expired and needs to be reconnected.");
    }

    const refreshed = await refreshMicrosoftAccessToken({ config: microsoftConfig(), refreshToken: stored.refreshToken });
    const newSecret = await secretStore.set({
      providerConnectionId: connection.id,
      value: JSON.stringify({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken } satisfies StoredMicrosoftToken),
      additionalAuthenticatedData: connection.id
    });
    await repository.updateConnection(connection.id, {
      secretRef: newSecret.secretRef,
      tokenExpiryAt: refreshed.expiresAt,
      refreshedAt: new Date(),
      lastHealthStatus: "healthy",
      lastHealthCheckAt: new Date(),
      lastFailureCode: null,
      lastFailureSummary: null
    });

    return refreshed.accessToken;
  } finally {
    await sql.end();
  }
}

function metaConfig() {
  return {
    appId: requiredEnv("META_APP_ID"),
    appSecret: requiredEnv("META_APP_SECRET"),
    redirectUri: requiredEnv("META_OAUTH_REDIRECT_URI"),
    graphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v20.0",
    scopes: (process.env.META_OAUTH_SCOPES ?? "pages_manage_posts,pages_read_engagement").split(",").map((scope) => scope.trim())
  };
}

function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is required for Meta provider connections.`);
  }
  return value;
}

function drizzleAuditRecorder(db: Parameters<typeof recordAuditEvent>[0]) {
  return {
    async record(event: {
      action: string;
      actorUserId?: string | null;
      entityType: string;
      entityId?: string | null;
      organisationId?: string | null;
      territoryId?: string | null;
      payload?: Record<string, unknown>;
    }) {
      await recordAuditEvent(db, {
        action: event.action,
        actor: event.actorUserId
          ? { type: "human", userId: event.actorUserId }
          : { type: "system", systemId: "integrations" },
        entity: { type: event.entityType, id: event.entityId ?? undefined },
        scope: {
          organisationId: event.organisationId ?? undefined,
          territoryId: event.territoryId ?? undefined
        },
        metadata: event.payload
      });
    }
  };
}

async function upsertSocialAccount(
  db: ReturnType<typeof createDb>["db"],
  input: {
    connectionId: string;
    organisationId?: string | null;
    territoryId?: string | null;
    pageId: string;
    pageName: string;
  }
) {
  const existing = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.externalAccountReference, input.pageId));
  if (existing[0]) {
    await db
      .update(socialAccounts)
      .set({
        providerConnectionId: input.connectionId,
        displayName: input.pageName,
        connectionStatus: "connected",
        connectionHealth: "healthy",
        active: true,
        lastSyncedAt: new Date()
      })
      .where(eq(socialAccounts.id, existing[0].id));
    return;
  }

  await db.insert(socialAccounts).values({
    channel: "facebook",
    organisationId: input.organisationId,
    territoryId: input.territoryId,
    providerConnectionId: input.connectionId,
    externalAccountReference: input.pageId,
    displayName: input.pageName,
    connectionStatus: "connected",
    connectionHealth: "healthy",
    capabilityMetadata: {},
    providerMetadata: {},
    active: true,
    lastSyncedAt: new Date()
  });
}

function grant(roleId: string, permission: { module: string; action: string }, scope: string, suffix = permission.action) {
  return {
    roleId,
    permissionId: `${roleId}:${permission.module}:${permission.action}:${suffix}`,
    permission: {
      id: `${roleId}:${permission.module}:${permission.action}:${suffix}`,
      ...permission
    },
    scope,
    constraints: {}
  };
}
