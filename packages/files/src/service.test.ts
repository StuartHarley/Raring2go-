import { describe, expect, it, vi } from "vitest";
import { fixtureIds, foundationSeed } from "@raring2go/db";
import type { PermissionData } from "@raring2go/permissions";
import { createDevelopmentStorageProvider, createMemoryScannerProvider } from "@raring2go/storage";
import type { FileReference, StorageProvider } from "@raring2go/storage";
import { completeFileUpload, filesCapabilities, requireFilesPermission } from "./index";

const permissions: PermissionData = {
  roleAssignments: [
    {
      id: "assignment_franchisee",
      roleId: fixtureIds.roles.franchisee,
      userId: fixtureIds.users.franchisee,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield
    }
  ],
  rolePermissions: [
    {
      roleId: fixtureIds.roles.franchisee,
      permission: { id: fixtureIds.permissions.filesUpload, ...filesCapabilities.upload },
      scope: "own_territory",
      constraints: {}
    }
  ],
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

describe("requireFilesPermission", () => {
  it("allows a franchisee with the files.upload grant", () => {
    expect(() => requireFilesPermission(context, permissions, "upload")).not.toThrow();
  });

  it("denies a user with no matching role assignment", () => {
    const stranger = { userId: "unknown_user", organisationId: null, territoryId: null };
    expect(() => requireFilesPermission(stranger, permissions, "upload")).toThrow();
  });
});

describe("completeFileUpload", () => {
  function memoryStorage(): StorageProvider {
    const uploaded = new Map<string, Uint8Array>();
    return {
      key: "memory-test",
      async createUploadIntent(reference) {
        return {
          reference,
          uploadUrl: `https://storage.test/upload/${reference.storageKey}`,
          headers: {},
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        };
      },
      async createDownloadIntent(reference) {
        return {
          reference,
          downloadUrl: `https://storage.test/download/${reference.storageKey}`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          disposition: "inline"
        };
      }
    } satisfies StorageProvider;
  }

  it("uploads bytes to the storage provider and scans the result clean", async () => {
    const storage = memoryStorage();
    const scanner = createMemoryScannerProvider();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

    const reference = await completeFileUpload(
      context,
      permissions,
      { storage, scanner, fetch: fetchMock },
      {
        id: "file_1",
        storageKey: "newsletters/sutton/file_1.png",
        fileName: "half-term.png",
        contentType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
        accessScope: "territory"
      }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.test/upload/newsletters/sutton/file_1.png",
      expect.objectContaining({ method: "PUT" })
    );
    expect(reference.virusScanStatus).toBe("clean");
    expect(reference.territoryId).toBe(fixtureIds.territories.suttonColdfield);
    expect(reference.ownerUserId).toBe(fixtureIds.users.franchisee);
  });

  it("throws when the upload PUT fails", async () => {
    const storage = memoryStorage();
    const scanner = createMemoryScannerProvider();
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));

    await expect(
      completeFileUpload(
        context,
        permissions,
        { storage, scanner, fetch: fetchMock },
        {
          id: "file_2",
          storageKey: "newsletters/sutton/file_2.png",
          fileName: "broken.png",
          contentType: "image/png",
          bytes: new Uint8Array([1]),
          accessScope: "territory"
        }
      )
    ).rejects.toThrow("File upload failed");
  });

  it("propagates an infected scan result rather than silently accepting the file", async () => {
    const storage = memoryStorage();
    const scanner = createMemoryScannerProvider({ status: "infected" });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

    const reference = await completeFileUpload(
      context,
      permissions,
      { storage, scanner, fetch: fetchMock },
      {
        id: "file_3",
        storageKey: "newsletters/sutton/file_3.png",
        fileName: "infected.png",
        contentType: "image/png",
        bytes: new Uint8Array([1]),
        accessScope: "territory"
      }
    );

    expect(reference.virusScanStatus).toBe("infected");
  });

  it("denies the upload outright when the actor lacks the files.upload permission", async () => {
    const storage = memoryStorage();
    const scanner = createMemoryScannerProvider();
    const stranger = { userId: "unknown_user", organisationId: null, territoryId: null };

    await expect(
      completeFileUpload(
        stranger,
        permissions,
        { storage, scanner },
        {
          id: "file_4",
          storageKey: "newsletters/x/file_4.png",
          fileName: "x.png",
          contentType: "image/png",
          bytes: new Uint8Array([1]),
          accessScope: "territory"
        }
      )
    ).rejects.toThrow();
  });
});

describe("real storage-provider development wiring sanity check", () => {
  it("createDevelopmentStorageProvider produces an upload URL matching the /api/files/development route shape", async () => {
    const storage = createDevelopmentStorageProvider();
    const reference: FileReference = {
      id: "file_5",
      providerKey: "development",
      storageKey: "newsletters/sutton/file_5.png",
      fileName: "x.png",
      contentType: "image/png",
      byteSize: 10,
      checksum: null,
      accessScope: "territory",
      organisationId: null,
      territoryId: null,
      ownerUserId: null,
      version: 1,
      virusScanStatus: "pending",
      metadata: {},
      createdAt: new Date().toISOString(),
      lockedAt: null,
      deletedAt: null
    };
    const intent = await storage.createUploadIntent(reference);
    expect(intent.uploadUrl).toBe("http://localhost:3000/api/files/development/upload/newsletters%2Fsutton%2Ffile_5.png");
  });
});
