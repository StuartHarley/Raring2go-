import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

export const providerConnections = pgTable(
  "provider_connections",
  {
    id,
    provider: text("provider").notNull(),
    connectionType: text("connection_type").notNull(),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    externalAccountId: text("external_account_id").notNull(),
    externalAccountDisplayName: text("external_account_display_name").notNull(),
    status: text("status").notNull().default("pending"),
    grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull().default([]),
    tokenExpiryAt: timestamp("token_expiry_at", { withTimezone: true }),
    lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
    lastHealthStatus: text("last_health_status").notNull().default("unknown"),
    lastFailureCode: text("last_failure_code"),
    lastFailureSummary: text("last_failure_summary"),
    connectedByUserId: uuid("connected_by_user_id").references(() => users.id),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    secretRef: text("secret_ref"),
    providerSafeMetadata: jsonb("provider_safe_metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("provider_connections_external_scope_uidx").on(
      table.provider,
      table.connectionType,
      table.externalAccountId,
      table.organisationId,
      table.territoryId
    ),
    index("provider_connections_provider_idx").on(table.provider, table.connectionType),
    index("provider_connections_org_idx").on(table.organisationId),
    index("provider_connections_territory_idx").on(table.territoryId),
    index("provider_connections_status_idx").on(table.status),
    index("provider_connections_deleted_at_idx").on(table.deletedAt)
  ]
);

export const providerConnectionSecrets = pgTable(
  "provider_connection_secrets",
  {
    id,
    providerConnectionId: uuid("provider_connection_id").references(() => providerConnections.id),
    secretRef: text("secret_ref").notNull(),
    backend: text("backend").notNull().default("postgres_aes_256_gcm"),
    keyVersion: text("key_version").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("provider_connection_secrets_ref_uidx").on(table.secretRef),
    index("provider_connection_secrets_connection_idx").on(table.providerConnectionId),
    index("provider_connection_secrets_deleted_at_idx").on(table.deletedAt)
  ]
);

export const oauthConnectionTransactions = pgTable(
  "oauth_connection_transactions",
  {
    id,
    stateHash: text("state_hash").notNull(),
    codeVerifierHash: text("code_verifier_hash"),
    provider: text("provider").notNull(),
    connectionType: text("connection_type").notNull(),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id),
    returnTo: text("return_to").notNull().default("/app/settings/connections"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    providerSafeMetadata: jsonb("provider_safe_metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => [
    uniqueIndex("oauth_connection_transactions_state_uidx").on(table.stateHash),
    index("oauth_connection_transactions_user_idx").on(table.requestedByUserId),
    index("oauth_connection_transactions_expiry_idx").on(table.expiresAt)
  ]
);
