import { fixtureIds } from "@raring2go/db";
import { describe, expect, it } from "vitest";
import {
  ShellAccessError,
  requireShellPermission,
  resolveShell,
  shellNavigation
} from "./app-shell";

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

  it("supports network and system capability behaviour", async () => {
    const shell = await resolveShell({
      sessionKey: "superadmin",
      organisationId: fixtureIds.organisations.hq
    });

    expect(shell.kind).toBe("authenticated");

    if (shell.kind === "authenticated") {
      expect(shell.navigation.map((item) => item.id)).toEqual(["roles", "system"]);
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
