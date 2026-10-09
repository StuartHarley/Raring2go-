import {
  acceptInvitation,
  consumePasswordlessSignIn,
  createDrizzleAuthRepository,
  createMemoryAuditRecorder,
  createMemoryAuthRepository,
  createSession,
  findOrCreateUserByEmail,
  normalizeEmail,
  requestPasswordlessSignIn,
  revokeSession,
  revokeAllSessions
} from "@raring2go/auth";
import { recordAuditEvent } from "@raring2go/audit";
import {
  createEmailProviderFromEnv,
  sendPasswordlessSignInEmail
} from "@raring2go/email";
import { createDb, fixtureIds, foundationSeed } from "@raring2go/db";
import type {
  AuditRecorder,
  AuthInvitation,
  AuthMembership,
  AuthRepository,
  AuthTerritory,
  AuthTokenRepository,
  AuthUser
} from "@raring2go/auth";

export const sessionCookieName = "r2go_session";

export type IdentityPorts = {
  repository: AuthRepository & AuthTokenRepository;
  audit: AuditRecorder;
};

type Db = ReturnType<typeof createDb>["db"];

const auditFor = (db: Db): AuditRecorder => ({
  async record(input) {
    await recordAuditEvent(db, input);
  }
});

let identityOverride: (IdentityPorts & { audit: ReturnType<typeof createMemoryAuditRecorder> }) | undefined;

/**
 * Run identity work (sessions, sign-in links, invitations) against Postgres, with audit events written
 * to the real audit table. `transaction: true` makes the whole unit atomic: using a sign-in link, or
 * accepting an invitation, either fully happens or does not happen at all. Tests substitute an
 * in-memory identity with `setIdentityForTests`.
 */
export async function withIdentity<T>(work: (ports: IdentityPorts) => Promise<T>, options: { transaction?: boolean } = {}): Promise<T> {
  if (identityOverride) return work(identityOverride);

  const { db, sql } = createDb();
  try {
    if (options.transaction) {
      return await db.transaction(async (tx) => {
        const scoped = tx as unknown as Db;
        return work({ repository: createDrizzleAuthRepository(scoped), audit: auditFor(scoped) });
      });
    }
    return await work({ repository: createDrizzleAuthRepository(db), audit: auditFor(db) });
  } finally {
    await sql.end();
  }
}

/** The seeded users, memberships and territories as an in-memory identity, for unit tests only. */
export function createFixtureIdentity() {
  const users: AuthUser[] = foundationSeed.users.map((user) => ({ ...user, status: "active" }));
  const memberships: AuthMembership[] = [
    { id: "fixture_membership_superadmin", userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, status: "active" },
    { id: "fixture_membership_franchisee", userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, status: "active" },
    { id: "fixture_membership_advertiser", userId: fixtureIds.users.advertiserUser, organisationId: fixtureIds.organisations.advertiser, status: "active" },
    { id: "fixture_membership_franchisee_advertiser", userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.advertiser, status: "active" }
  ];
  const territories: AuthTerritory[] = foundationSeed.territories.map((territory) => ({ ...territory, status: "active" }));
  const invitations: AuthInvitation[] = [
    {
      id: fixtureIds.invitations.franchiseStaff,
      email: "staff@example.raring2go.test",
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield,
      tokenHash: "0000000000000000000000000000000000000000000000000000000000000801",
      status: "pending",
      expiresAt: new Date("2099-01-01T00:00:00.000Z")
    }
  ];
  const audit = createMemoryAuditRecorder();
  return { repository: createMemoryAuthRepository({ users, memberships, territories, invitations }), audit };
}

export function setIdentityForTests(identity: ReturnType<typeof createFixtureIdentity> | undefined) {
  if (process.env.NODE_ENV === "production") throw new Error("Fixture identity is not available in production.");
  identityOverride = identity;
}

export function isFixtureSessionAllowed(env = process.env.NODE_ENV) {
  return env === "development" || env === "test";
}

export function safeReturnTo(value?: string | null) {
  if (!value) {
    return "/app";
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/app";
  }

  try {
    const parsed = new URL(value, "https://raring2go.local");

    if (parsed.origin !== "https://raring2go.local") {
      return "/app";
    }

    if (!parsed.pathname.startsWith("/app") && !parsed.pathname.startsWith("/areas/")) {
      return "/app";
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/app";
  }
}

export async function requestSignIn(input: { email: string; token: string; returnTo?: string }) {
  const delivery = await withIdentity(({ repository, audit }) =>
    requestPasswordlessSignIn(repository, audit, {
      email: input.email,
      token: input.token,
      returnTo: safeReturnTo(input.returnTo),
      baseUrl: publicBaseUrl()
    })
  );

  await sendPasswordlessSignInEmail(createEmailProviderFromEnv(), {
    to: delivery.email,
    url: delivery.url ?? signInUrl(input.token),
    expiresAt: delivery.expiresAt,
    from: process.env.EMAIL_FROM,
    idempotencyKey: `passwordless:${delivery.email}:${input.token}`
  });

  return delivery;
}

export async function verifySignIn(input: { token: string; sessionToken: string }) {
  // One transaction: the link is consumed, the account loaded or created, and the session and its
  // audit event written together, so a failure part-way cannot burn a link without signing anyone in.
  return withIdentity(({ repository, audit }) => consumePasswordlessSignIn(repository, audit, input), { transaction: true });
}

export async function signOutEverywhere(input: { sessionToken: string }) {
  return withIdentity(({ repository, audit }) => revokeAllSessions(repository, audit, { token: input.sessionToken }), { transaction: true });
}

export async function signOut(input: { sessionToken: string }) {
  return withIdentity(({ repository, audit }) => revokeSession(repository, audit, { token: input.sessionToken }));
}

export async function acceptInvite(input: { token: string; email: string; displayName?: string }) {
  return withIdentity(({ repository, audit }) => acceptInvitation(repository, audit, input), { transaction: true });
}

/** Used by the development sign-in shortcut: establishes a session for an email without the link round trip. */
export async function createDevelopmentSession(input: { email: string; sessionToken: string; ttlMs: number }) {
  return withIdentity(
    async ({ repository, audit }) => {
      const user = await findOrCreateUserByEmail(repository, { email: normalizeEmail(input.email) });
      if (user.status !== "active") throw new Error("This account is disabled.");
      return createSession(repository, audit, { userId: user.id, token: input.sessionToken, expiresAt: new Date(Date.now() + input.ttlMs) });
    },
    { transaction: true }
  );
}

function publicBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";
}

function signInUrl(token: string) {
  return `${publicBaseUrl()}/sign-in/verify?token=${encodeURIComponent(token)}`;
}
