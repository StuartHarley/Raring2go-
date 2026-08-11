import { createMemoryAuthRepository, hashToken } from "@raring2go/auth";
import { fixtureIds, foundationSeed } from "@raring2go/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ShellAccessError,
  requireShellPermission,
  resolveShell,
  shellNavigation
} from "./app-shell";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("app shell context and capabilities", () => {
  it("distinguishes unauthenticated shell access", async () => {
    await expect(resolveShell({})).resolves.toMatchObject({
      kind: "unauthenticated"
    });
  });

  it("resolves a valid organisation context", async () => {
    await expect(
      resolveShell({
        sessionKey: "superadmin",
        organisationId: fixtureIds.organisations.hq
      })
    ).resolves.toMatchObject({
      kind: "authenticated",
      activeContext: {
        organisationId: fixtureIds.organisations.hq
      }
    });
  });

  it("resolves a real session token", async () => {
    const repository = createRepositoryWithSession({
      userId: fixtureIds.users.superAdmin,
      token: "real-session-token"
    });

    await expect(
      resolveShell(
        {
          sessionToken: "real-session-token",
          organisationId: fixtureIds.organisations.hq
        },
        repository
      )
    ).resolves.toMatchObject({
      kind: "authenticated",
      userId: fixtureIds.users.superAdmin
    });
  });

  it("rejects revoked and expired real sessions", async () => {
    await expect(
      resolveShell(
        {
          sessionToken: "revoked-session",
          organisationId: fixtureIds.organisations.hq
        },
        createRepositoryWithSession({
          userId: fixtureIds.users.superAdmin,
          token: "revoked-session",
          revokedAt: new Date("2026-08-10T12:00:00.000Z")
        })
      )
    ).resolves.toMatchObject({
      kind: "invalid_context"
    });

    await expect(
      resolveShell(
        {
          sessionToken: "expired-session",
          organisationId: fixtureIds.organisations.hq
        },
        createRepositoryWithSession({
          userId: fixtureIds.users.superAdmin,
          token: "expired-session",
          expiresAt: new Date("2020-01-01T00:00:00.000Z")
        })
      )
    ).resolves.toMatchObject({
      kind: "invalid_context"
    });
  });

  it("resolves a valid territory context", async () => {
    await expect(
      resolveShell({
        sessionKey: "franchisee",
        organisationId: fixtureIds.organisations.franchise,
        territoryId: fixtureIds.territories.suttonColdfield
      })
    ).resolves.toMatchObject({
      kind: "authenticated",
      activeContext: {
        organisationId: fixtureIds.organisations.franchise,
        territoryId: fixtureIds.territories.suttonColdfield
      }
    });
  });

  it("rejects stale or invalid persisted context", async () => {
    await expect(
      resolveShell({
        sessionKey: "franchisee",
        organisationId: "00000000-0000-4000-8000-999999999999"
      })
    ).resolves.toMatchObject({
      kind: "invalid_context",
      auditAction: "auth.security.change"
    });
  });

  it("rejects cross-tenant context", async () => {
    await expect(
      resolveShell({
        sessionKey: "franchisee",
        organisationId: fixtureIds.organisations.franchise,
        territoryId: fixtureIds.territories.solihull
      })
    ).resolves.toMatchObject({
      kind: "invalid_context"
    });
  });

  it("lists multiple organisation context choices for a multi-organisation user", async () => {
    const shell = await resolveShell({
      sessionKey: "franchisee"
    });

    expect(shell.kind).toBe("authenticated");

    if (shell.kind === "authenticated") {
      expect(shell.availableContexts.map((context) => context.organisationId)).toContain(
        fixtureIds.organisations.advertiser
      );
    }
  });

  it("disables fixture sessions outside development and test", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      resolveShell({
        sessionKey: "superadmin",
        organisationId: fixtureIds.organisations.hq
      })
    ).resolves.toMatchObject({
      kind: "unauthenticated"
    });
  });

  it("supports network and system capability behaviour", async () => {
    const shell = await resolveShell({
      sessionKey: "superadmin",
      organisationId: fixtureIds.organisations.hq
    });

    expect(shell.kind).toBe("authenticated");

    if (shell.kind === "authenticated") {
      expect(shell.navigation.map((item) => item.id)).toEqual([
        "franchisees",
        "advertisers",
        "audience",
        "newsletters",
        "journeys",
        "content",
        "social",
        "commercial-command",
        "editions",
        "roles",
        "system"
      ]);
    }
  });

  it("drives navigation from permission descriptors", () => {
    expect(shellNavigation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "roles",
          capability: {
            module: "roles",
            action: "view"
          }
        })
      ])
    );
  });

  it("denies direct protected route access even when navigation is hidden", async () => {
    await expect(
      requireShellPermission(
        {
          sessionKey: "franchisee",
          organisationId: fixtureIds.organisations.franchise,
          territoryId: fixtureIds.territories.suttonColdfield
        },
        {
          module: "roles",
          action: "view"
        }
      )
    ).rejects.toMatchObject({
      kind: "unauthorised"
    });
  });

  it("keeps unauthorised and invalid context outcomes distinct", async () => {
    await expect(
      requireShellPermission(
        {
          sessionKey: "franchisee",
          organisationId: fixtureIds.organisations.franchise,
          territoryId: fixtureIds.territories.suttonColdfield
        },
        {
          module: "system",
          action: "administer"
        }
      )
    ).rejects.toBeInstanceOf(ShellAccessError);

    await expect(
      resolveShell({
        sessionKey: "franchisee",
        organisationId: fixtureIds.organisations.hq
      })
    ).resolves.toMatchObject({
      kind: "invalid_context"
    });
  });
});

function createRepositoryWithSession(input: {
  userId: string;
  token: string;
  expiresAt?: Date;
  revokedAt?: Date;
}) {
  return createMemoryAuthRepository({
    users: foundationSeed.users.map((user) => ({
      ...user,
      status: "active"
    })),
    memberships: [
      {
        id: "membership_superadmin",
        userId: fixtureIds.users.superAdmin,
        organisationId: fixtureIds.organisations.hq,
        status: "active"
      },
      {
        id: "membership_franchisee",
        userId: fixtureIds.users.franchisee,
        organisationId: fixtureIds.organisations.franchise,
        status: "active"
      }
    ],
    territories: foundationSeed.territories.map((territory) => ({
      ...territory,
      status: "active"
    })),
    sessions: [
      {
        id: "session_real",
        userId: input.userId,
        sessionTokenHash: hashToken(input.token),
        assuranceLevel: "standard",
        expiresAt: input.expiresAt ?? new Date("2099-01-01T00:00:00.000Z"),
        revokedAt: input.revokedAt
      }
    ]
  });
}
