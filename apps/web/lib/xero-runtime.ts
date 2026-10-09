import { advertiserProviderSyncReferences, createDb } from "@raring2go/db";
import {
  XERO_DEFAULT_SCOPES,
  XeroAuthError,
  completeProviderConnection,
  createDrizzleProviderConnectionRepository,
  createDrizzleSecretRepository,
  createEncryptedSecretStore,
  createOAuthConnectionTransaction,
  createXeroAccountingProvider,
  createXeroAuthorizationUrl,
  defaultXeroMapping,
  exchangeXeroOAuthCode,
  getConnectionCredential,
  hashOAuthValue,
  listXeroTenants,
  refreshXeroAccessToken,
  requireIntegrationPermission,
  safeInternalReturnTo
} from "@raring2go/integrations";
import type { XeroContactStore, XeroMapping } from "@raring2go/integrations";
import type { AccountingProvider } from "@raring2go/finance";
import { and, eq, sql as rawSql } from "drizzle-orm";
import type { RequestedShellContext } from "./app-shell";
import { requireShellPermission, resolveShell } from "./app-shell";
import { drizzleAuditRecorder, requiredEnv } from "./integrations-runtime";
import { getPermissionData } from "./permission-source";

/**
 * Xero for accounting hand-off, one connection per franchise (organisation + territory). The advertiser invoices a
 * franchise issues go to that franchise's own Xero organisation. Tokens live only in the encrypted secret store.
 */
export const XERO_PROVIDER = "xero";
export const XERO_CONNECTION_TYPE = "accounting";
const CONTACT_SYNC_TYPE = "accounting_contact";

export function xeroConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.XERO_CLIENT_ID && env.XERO_CLIENT_SECRET && env.XERO_OAUTH_REDIRECT_URI);
}

function xeroConfig() {
  return {
    clientId: requiredEnv("XERO_CLIENT_ID"),
    clientSecret: requiredEnv("XERO_CLIENT_SECRET"),
    redirectUri: requiredEnv("XERO_OAUTH_REDIRECT_URI"),
    scopes: (process.env.XERO_OAUTH_SCOPES ?? XERO_DEFAULT_SCOPES.join(" ")).split(/\s+/).filter(Boolean)
  };
}

type Db = ReturnType<typeof createDb>["db"];
type StoredToken = { accessToken: string; refreshToken: string | null };

const secretStoreFor = (db: Db) =>
  createEncryptedSecretStore({ repository: createDrizzleSecretRepository(db), encryptionKey: requiredEnv("INTEGRATION_SECRET_ENCRYPTION_KEY"), keyVersion: process.env.INTEGRATION_SECRET_KEY_VERSION ?? "v1" });

// ---- Connecting -------------------------------------------------------------------------------

export async function startXeroConnection(request: RequestedShellContext, returnTo?: string | null) {
  const permissions = await getPermissionData();
  const shell = await requireShellPermission(request, { module: "integrations", action: "connect" });
  if (!shell.activeContext.territoryId) throw new Error("Choose your franchise territory before connecting Xero.");
  const { db, sql } = createDb();
  try {
    const transaction = await createOAuthConnectionTransaction({
      context: { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId },
      permissions,
      repository: createDrizzleProviderConnectionRepository(db),
      provider: XERO_PROVIDER,
      connectionType: XERO_CONNECTION_TYPE,
      returnTo: safeInternalReturnTo(returnTo)
    });
    return createXeroAuthorizationUrl({ config: xeroConfig(), state: transaction.state });
  } finally {
    await sql.end();
  }
}

export async function completeXeroConnection(input: { request: RequestedShellContext; state: string; code: string }) {
  const permissions = await getPermissionData();
  const shell = await resolveShell(input.request);
  if (shell.kind !== "authenticated") throw new Error("The Xero callback needs an active session.");
  const { db, sql } = createDb();
  try {
    const repository = createDrizzleProviderConnectionRepository(db);
    const transaction = await repository.consumeOAuthTransaction({ stateHash: hashOAuthValue(input.state), userId: shell.userId, now: new Date() });
    const config = xeroConfig();
    const token = await exchangeXeroOAuthCode({ config, code: input.code });
    const tenants = await listXeroTenants({ accessToken: token.accessToken });
    const tenant = tenants[0];
    if (!tenant) throw new Error("No Xero organisation was authorised.");

    const connection = await completeProviderConnection({
      context: { userId: shell.userId, organisationId: transaction.organisationId, territoryId: transaction.territoryId },
      permissions,
      repository,
      secretStore: secretStoreFor(db),
      audit: drizzleAuditRecorder(db),
      provider: XERO_PROVIDER,
      connectionType: XERO_CONNECTION_TYPE,
      externalAccountId: tenant.tenantId,
      externalAccountDisplayName: tenant.tenantName,
      grantedScopes: typeof token.safeMetadata.scope === "string" ? token.safeMetadata.scope.split(" ") : config.scopes,
      token: JSON.stringify({ accessToken: token.accessToken, refreshToken: token.refreshToken } satisfies StoredToken),
      tokenExpiryAt: token.expiresAt,
      providerSafeMetadata: { ...token.safeMetadata, mapping: defaultXeroMapping, organisationsAuthorised: tenants.length }
    });
    return { connection, returnTo: transaction.returnTo, organisationsAuthorised: tenants.length };
  } finally {
    await sql.end();
  }
}

// ---- Mapping ----------------------------------------------------------------------------------

const CODE = /^[A-Za-z0-9_.-]{1,40}$/;

/** Validates what a person typed into the mapping form. Codes are short identifiers, never free text sent to Xero. */
export function parseXeroMapping(input: { salesAccountCode: string; standardVat: string; zeroRated: string; exempt: string }): XeroMapping {
  const clean = (value: string, label: string) => {
    const trimmed = value.trim();
    if (!CODE.test(trimmed)) throw new Error(`${label} is not a valid Xero code.`);
    return trimmed;
  };
  return {
    salesAccountCode: clean(input.salesAccountCode, "The sales account code"),
    taxTypes: { standard_vat: clean(input.standardVat, "The standard VAT tax type"), zero_rated: clean(input.zeroRated, "The zero-rated tax type"), exempt: clean(input.exempt, "The exempt tax type") }
  };
}

export async function saveXeroMapping(request: RequestedShellContext, connectionId: string, mapping: XeroMapping) {
  const permissions = await getPermissionData();
  const shell = await requireShellPermission(request, { module: "integrations", action: "connect" });
  const { db, sql } = createDb();
  try {
    const repository = createDrizzleProviderConnectionRepository(db);
    const connection = await repository.getConnection(connectionId);
    // The same "not found" for another franchise's connection as for a missing one.
    if (!connection || connection.provider !== XERO_PROVIDER || connection.organisationId !== shell.activeContext.organisationId || connection.territoryId !== (shell.activeContext.territoryId ?? null)) {
      throw new Error("Xero connection was not found.");
    }
    requireIntegrationPermission({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, permissions, "connect", connection);
    await repository.updateConnection(connection.id, { providerSafeMetadata: { ...connection.providerSafeMetadata, mapping } });
    await drizzleAuditRecorder(db).record({
      action: "integration.connection.configure",
      actorUserId: shell.userId,
      entityType: "provider_connection",
      entityId: connection.id,
      organisationId: connection.organisationId,
      territoryId: connection.territoryId,
      payload: { provider: XERO_PROVIDER, mapping }
    });
  } finally {
    await sql.end();
  }
}

// ---- Tokens -----------------------------------------------------------------------------------

/**
 * A usable access token. Xero refresh tokens are single-use, so two workers must never refresh at once: refreshing
 * takes a per-connection advisory lock, re-reads what is stored (someone else may just have refreshed), and writes
 * the new pair before the lock is released. `rejectedToken` is the token Xero just refused; if the stored one differs,
 * another worker already replaced it and that one is returned.
 */
export async function getValidXeroAccessToken(connectionId: string, options: { rejectedToken?: string; fetch?: typeof fetch } = {}): Promise<string> {
  const { db, sql } = createDb();
  try {
    // A refusal is recorded after the lock transaction ends: throwing inside it would roll the "expired" mark back.
    const outcome = await db.transaction(async (tx): Promise<{ token: string } | { refusal: XeroAuthError }> => {
      const scoped = tx as unknown as Db;
      await scoped.execute(rawSql`select pg_advisory_xact_lock(hashtext(${`xero-token:${connectionId}`}))`);
      const repository = createDrizzleProviderConnectionRepository(scoped);
      const connection = await repository.getConnection(connectionId);
      if (!connection || connection.provider !== XERO_PROVIDER || connection.status !== "connected") return { refusal: new XeroAuthError("The Xero connection is not available. Reconnect Xero.", true) };

      const secretStore = secretStoreFor(scoped);
      const stored = JSON.parse(await getConnectionCredential({ connection, secretStore })) as StoredToken;
      const stillValid = connection.tokenExpiryAt && new Date(connection.tokenExpiryAt).getTime() > Date.now() + 60_000;
      if (stillValid && stored.accessToken !== options.rejectedToken) return { token: stored.accessToken };
      if (options.rejectedToken && stored.accessToken !== options.rejectedToken) return { token: stored.accessToken };

      if (!stored.refreshToken) return { refusal: new XeroAuthError("The Xero connection has expired. Reconnect Xero.", true) };
      try {
        const refreshed = await refreshXeroAccessToken({ config: xeroConfig(), refreshToken: stored.refreshToken, fetch: options.fetch });
        const secret = await secretStore.set({ providerConnectionId: connection.id, value: JSON.stringify({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken } satisfies StoredToken), additionalAuthenticatedData: connection.id });
        await repository.updateConnection(connection.id, { secretRef: secret.secretRef, tokenExpiryAt: refreshed.expiresAt, refreshedAt: new Date(), lastHealthStatus: "healthy", lastHealthCheckAt: new Date(), lastFailureCode: null, lastFailureSummary: null });
        return { token: refreshed.accessToken };
      } catch (error) {
        if (error instanceof XeroAuthError && error.reconnectRequired) return { refusal: error };
        throw error;
      }
    });

    if ("token" in outcome) return outcome.token;
    await createDrizzleProviderConnectionRepository(db).updateConnection(connectionId, {
      status: "expired",
      lastHealthStatus: "expired",
      lastFailureSummary: "Xero no longer accepts this connection. Reconnect required.",
      lastHealthCheckAt: new Date()
    });
    throw outcome.refusal;
  } finally {
    await sql.end();
  }
}

// ---- Resolving a provider for a franchise -----------------------------------------------------

function contactStoreFor(connectionId: string): XeroContactStore {
  return {
    async get(customerOrganisationId) {
      const { db, sql } = createDb();
      try {
        const [row] = await db
          .select({ providerEntityId: advertiserProviderSyncReferences.providerEntityId })
          .from(advertiserProviderSyncReferences)
          .where(and(eq(advertiserProviderSyncReferences.providerType, CONTACT_SYNC_TYPE), eq(advertiserProviderSyncReferences.providerKey, connectionId), eq(advertiserProviderSyncReferences.entityType, "advertiser_organisation"), eq(advertiserProviderSyncReferences.entityId, customerOrganisationId)));
        return row?.providerEntityId ?? null;
      } finally {
        await sql.end();
      }
    },
    async set(customerOrganisationId, xeroContactId) {
      const { db, sql } = createDb();
      try {
        await db
          .insert(advertiserProviderSyncReferences)
          .values({ providerType: CONTACT_SYNC_TYPE, providerKey: connectionId, entityType: "advertiser_organisation", entityId: customerOrganisationId, providerEntityId: xeroContactId, status: "synced", metadata: {} })
          .onConflictDoUpdate({ target: [advertiserProviderSyncReferences.providerType, advertiserProviderSyncReferences.providerKey, advertiserProviderSyncReferences.entityType, advertiserProviderSyncReferences.entityId], set: { providerEntityId: xeroContactId } });
      } finally {
        await sql.end();
      }
    }
  };
}

/** The Xero provider for the franchise that issued a document, or null when that franchise has not connected Xero. */
export async function xeroResolver(target: { issuerOrganisationId: string; territoryId: string }, options: { fetch?: typeof fetch } = {}): Promise<AccountingProvider | null> {
  const { db, sql } = createDb();
  let connection;
  let needsReconnect = false;
  try {
    const all = await createDrizzleProviderConnectionRepository(db).listConnections({ provider: XERO_PROVIDER, connectionType: XERO_CONNECTION_TYPE, organisationId: target.issuerOrganisationId, territoryId: target.territoryId });
    connection = all.find((candidate) => candidate.status === "connected");
    needsReconnect = !connection && all.some((candidate) => candidate.status === "expired");
  } finally {
    await sql.end();
  }
  if (!connection && needsReconnect) {
    // Connected once, but Xero stopped accepting it: that is a person's job to fix, not "never connected".
    const refuse = async (): Promise<never> => {
      throw new XeroAuthError("The Xero connection has expired. Reconnect Xero.", true);
    };
    return { pushInvoice: refuse, pushCreditNote: refuse };
  }
  if (!connection) return null;

  const stored = (connection.providerSafeMetadata as { mapping?: Partial<XeroMapping> }).mapping;
  const mapping: XeroMapping = { salesAccountCode: stored?.salesAccountCode ?? defaultXeroMapping.salesAccountCode, taxTypes: { ...defaultXeroMapping.taxTypes, ...(stored?.taxTypes ?? {}) } };
  const connectionId = connection.id;
  let lastToken = "";
  return createXeroAccountingProvider({
    tenantId: connection.externalAccountId,
    mapping,
    contacts: contactStoreFor(connectionId),
    fetch: options.fetch,
    getAccessToken: async () => (lastToken = await getValidXeroAccessToken(connectionId, { fetch: options.fetch })),
    refreshAccessToken: async () => (lastToken = await getValidXeroAccessToken(connectionId, { rejectedToken: lastToken, fetch: options.fetch }))
  });
}
