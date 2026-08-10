import {
  acceptInvitation,
  consumePasswordlessSignIn,
  createMemoryAuditRecorder,
  createMemoryAuthRepository,
  requestPasswordlessSignIn,
  revokeSession
} from "@raring2go/auth";
import { fixtureIds, foundationSeed } from "@raring2go/db";
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

const users: AuthUser[] = foundationSeed.users.map((user) => ({
  ...user,
  status: "active"
}));

const memberships: AuthMembership[] = [
  {
    id: "fixture_membership_superadmin",
    userId: fixtureIds.users.superAdmin,
    organisationId: fixtureIds.organisations.hq,
    status: "active"
  },
  {
    id: "fixture_membership_franchisee",
    userId: fixtureIds.users.franchisee,
    organisationId: fixtureIds.organisations.franchise,
    status: "active"
  },
  {
    id: "fixture_membership_franchisee_advertiser",
    userId: fixtureIds.users.franchisee,
    organisationId: fixtureIds.organisations.advertiser,
    status: "active"
  }
];

const territories: AuthTerritory[] = foundationSeed.territories.map((territory) => ({
  ...territory,
  status: "active"
}));

const invitations: AuthInvitation[] = [
  {
    id: fixtureIds.invitations.franchiseStaff,
    email: "staff@example.raring2go.test",
    organisationId: fixtureIds.organisations.franchise,
    territoryId: fixtureIds.territories.suttonColdfield,
    tokenHash:
      "0000000000000000000000000000000000000000000000000000000000000801",
    status: "pending",
    expiresAt: new Date("2099-01-01T00:00:00.000Z")
  }
];

type RuntimeAuthRepository = AuthRepository &
  AuthTokenRepository & {
    users: AuthUser[];
    memberships: AuthMembership[];
    sessions: unknown[];
    verificationTokens: unknown[];
  };

type RuntimeState = {
  repository: RuntimeAuthRepository;
  auditRecorder: ReturnType<typeof createMemoryAuditRecorder>;
};

const runtimeKey = Symbol.for("raring2go.auth-runtime");
const globalRuntime = globalThis as typeof globalThis & {
  [runtimeKey]?: RuntimeState;
};

function createRuntimeState(): RuntimeState {
  return {
    repository: createMemoryAuthRepository({
      users,
      memberships,
      territories,
      invitations
    }),
    auditRecorder: createMemoryAuditRecorder()
  };
}

const runtimeState = globalRuntime[runtimeKey] ?? createRuntimeState();
globalRuntime[runtimeKey] = runtimeState;

export const appAuthRepository = runtimeState.repository;
export const appAuditRecorder = runtimeState.auditRecorder;

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

    if (!parsed.pathname.startsWith("/app")) {
      return "/app";
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/app";
  }
}

export async function requestSignIn(input: {
  email: string;
  token: string;
  returnTo?: string;
  audit?: AuditRecorder;
}) {
  return requestPasswordlessSignIn(
    appAuthRepository,
    input.audit ?? appAuditRecorder,
    {
      email: input.email,
      token: input.token,
      returnTo: safeReturnTo(input.returnTo)
    }
  );
}

export async function verifySignIn(input: {
  token: string;
  sessionToken: string;
  audit?: AuditRecorder;
}) {
  return consumePasswordlessSignIn(
    appAuthRepository,
    input.audit ?? appAuditRecorder,
    input
  );
}

export async function signOut(input: {
  sessionToken: string;
  audit?: AuditRecorder;
}) {
  return revokeSession(appAuthRepository, input.audit ?? appAuditRecorder, {
    token: input.sessionToken
  });
}

export async function acceptInvite(input: {
  token: string;
  email: string;
  displayName?: string;
  audit?: AuditRecorder;
}) {
  return acceptInvitation(appAuthRepository, input.audit ?? appAuditRecorder, input);
}
