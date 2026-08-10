import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("auth_accounts_provider_account_uidx").on(
      table.provider,
      table.providerAccountId
    ),
    index("auth_accounts_user_id_idx").on(table.userId)
  ]
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sessionTokenHash: text("session_token_hash").notNull(),
    assuranceLevel: text("assurance_level").notNull().default("standard"),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true })
      .notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_uidx").on(table.sessionTokenHash),
    index("auth_sessions_user_id_idx").on(table.userId),
    index("auth_sessions_expires_at_idx").on(table.expiresAt),
    index("auth_sessions_revoked_at_idx").on(table.revokedAt)
  ]
);

export const authVerificationTokens = pgTable(
  "auth_verification_tokens",
  {
    id,
    identifier: text("identifier").notNull(),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true })
      .notNull(),
    usedAt: timestamp("used_at", { mode: "date", withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("auth_verification_tokens_token_hash_uidx").on(table.tokenHash),
    index("auth_verification_tokens_identifier_idx").on(table.identifier),
    index("auth_verification_tokens_expires_at_idx").on(table.expiresAt)
  ]
);

export const authInvitations = pgTable(
  "auth_invitations",
  {
    id,
    email: text("email").notNull(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("pending"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true })
      .notNull(),
    acceptedAt: timestamp("accepted_at", { mode: "date", withTimezone: true }),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("auth_invitations_token_hash_uidx").on(table.tokenHash),
    index("auth_invitations_email_idx").on(table.email),
    index("auth_invitations_organisation_id_idx").on(table.organisationId),
    index("auth_invitations_territory_id_idx").on(table.territoryId),
    index("auth_invitations_status_idx").on(table.status)
  ]
);
