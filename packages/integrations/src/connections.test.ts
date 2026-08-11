import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fixtureIds, foundationSeed } from "@raring2go/db";
import type { PermissionData } from "@raring2go/permissions";
import {
  completeProviderConnection,
  createMemoryProviderConnectionRepository,
  createOAuthConnectionTransaction,
  hashOAuthValue,
  integrationCapabilities,
  revokeProviderConnection,
  safeInternalReturnTo
} from "./connections";
import { createEncryptedSecretStore, createMemorySecretRepository } from "./secrets";

const permissions: PermissionData = {
  roleAssignments: [{
    id: "assignment",
    roleId: fixtureIds.roles.hqAdmin,
    userId: fixtureIds.users.superAdmin,
    organisationId: fixtureIds.organisations.hq
  }, {
    id: "assignment_franchisee",
    roleId: fixtureIds.roles.franchisee,
    userId: fixtureIds.users.franchisee,
    organisationId: fixtureIds.organisations.franchise,
    territoryId: fixtureIds.territories.suttonColdfield
  }],
  rolePermissions: Object.values(integrationCapabilities).map((permission, index) => ({
    roleId: fixtureIds.roles.franchisee,
    permissionId: `permission_${index}`,
    permission: { id: `permission_${index}`, ...permission },
    scope: "own_territory",
    constraints: {}
  })),
  territories: foundationSeed.territories.map((territory) => ({
    id: territory.id,
    franchiseOrganisationId: territory.franchiseOrganisationId
  }))
};

const context = {
  userId: fixtureIds.users.franchisee,
  organisationId: fixtureIds.organisations.franchise,
  territoryId: fixtureIds.territories.suttonColdfield
};

describe("provider connection framework", () => {
  it("creates short-lived OAuth state server-side and rejects unsafe return paths", async () => {
    const repository = createMemoryProviderConnectionRepository();
    const result = await createOAuthConnectionTransaction({
      context,
      permissions,
      repository,
      provider: "meta",
      connectionType: "facebook_page",
      returnTo: "https://evil.test/app"
    });

    expect(result.state).toHaveLength(43);
    expect(repository.transactions[0]?.stateHash).toBe(hashOAuthValue(result.state));
    expect(repository.transactions[0]?.returnTo).toBe("/app/settings/connections");
    expect(safeInternalReturnTo("/app/social")).toBe("/app/social");
  });

  it("rejects OAuth state replay, expiry and mismatched users", async () => {
    const repository = createMemoryProviderConnectionRepository();
    const result = await createOAuthConnectionTransaction({
      context,
      permissions,
      repository,
      provider: "meta",
      connectionType: "facebook_page",
      now: new Date("2026-08-11T10:00:00.000Z")
    });

    await expect(repository.consumeOAuthTransaction({
      stateHash: hashOAuthValue(result.state),
      userId: fixtureIds.users.superAdmin,
      now: new Date("2026-08-11T10:01:00.000Z")
    })).rejects.toThrow("signed-in user");

    await expect(repository.consumeOAuthTransaction({
      stateHash: hashOAuthValue(result.state),
      userId: fixtureIds.users.franchisee,
      now: new Date("2026-08-11T10:11:00.000Z")
    })).rejects.toThrow("expired");

    const fresh = await createOAuthConnectionTransaction({
      context,
      permissions,
      repository,
      provider: "meta",
      connectionType: "facebook_page",
      now: new Date("2026-08-11T10:00:00.000Z")
    });
    await repository.consumeOAuthTransaction({
      stateHash: hashOAuthValue(fresh.state),
      userId: fixtureIds.users.franchisee,
      now: new Date("2026-08-11T10:01:00.000Z")
    });
    await expect(repository.consumeOAuthTransaction({
      stateHash: hashOAuthValue(fresh.state),
      userId: fixtureIds.users.franchisee,
      now: new Date("2026-08-11T10:02:00.000Z")
    })).rejects.toThrow("already used");
  });

  it("stores connection metadata separately from encrypted secrets and audits safely", async () => {
    const repository = createMemoryProviderConnectionRepository();
    const secretRepository = createMemorySecretRepository();
    const secretStore = createEncryptedSecretStore({
      repository: secretRepository,
      encryptionKey: randomBytes(32).toString("base64"),
      keyVersion: "v1"
    });
    const audit = { record: vi.fn(async () => undefined) };

    const connection = await completeProviderConnection({
      context,
      permissions,
      repository,
      secretStore,
      audit,
      provider: "meta",
      connectionType: "facebook_page",
      externalAccountId: "page_1",
      externalAccountDisplayName: "Raring2go Sutton Coldfield",
      grantedScopes: ["pages_manage_posts"],
      token: "page-token"
    });

    expect(connection.secretRef).toMatch(/^secret_/);
    expect(JSON.stringify(connection)).not.toContain("page-token");
    expect(JSON.stringify(secretRepository.records)).not.toContain("page-token");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "integration.connected",
      payload: expect.not.objectContaining({ token: expect.anything() })
    }));
  });

  it("fails closed for cross-territory revoke and invalidates secret material on revoke", async () => {
    const repository = createMemoryProviderConnectionRepository();
    const secretRepository = createMemorySecretRepository();
    const secretStore = createEncryptedSecretStore({
      repository: secretRepository,
      encryptionKey: randomBytes(32).toString("base64"),
      keyVersion: "v1"
    });
    const audit = { record: vi.fn(async () => undefined) };
    const connection = await completeProviderConnection({
      context,
      permissions,
      repository,
      secretStore,
      audit,
      provider: "meta",
      connectionType: "facebook_page",
      externalAccountId: "page_1",
      externalAccountDisplayName: "Raring2go Sutton Coldfield",
      grantedScopes: [],
      token: "page-token"
    });

    await expect(revokeProviderConnection({
      context: { ...context, territoryId: fixtureIds.territories.solihull },
      permissions,
      repository,
      secretStore,
      audit,
      connectionId: connection.id
    })).rejects.toThrow("outside the active territory");

    await revokeProviderConnection({ context, permissions, repository, secretStore, audit, connectionId: connection.id });

    await expect(secretStore.get({
      secretRef: connection.secretRef!,
      additionalAuthenticatedData: connection.id
    })).rejects.toThrow("unavailable");
  });
});
