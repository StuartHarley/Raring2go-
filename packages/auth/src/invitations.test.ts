import { auditActions } from "@raring2go/audit";
import { describe, expect, it } from "vitest";
import { acceptInvitation } from "./invitations";
import { createMemoryAuditRecorder, createMemoryAuthRepository } from "./test-helpers";
import { hashToken } from "./tokens";

describe("acceptInvitation", () => {
  it("creates membership and audits accepted invitations", async () => {
    const repository = createMemoryAuthRepository({
      invitations: [
        {
          id: "invite_1",
          email: "franchisee@example.com",
          organisationId: "org_franchise",
          territoryId: "territory_1",
          tokenHash: hashToken("invite-token"),
          status: "pending",
          expiresAt: new Date("2026-08-11T00:00:00.000Z")
        }
      ]
    });
    const audit = createMemoryAuditRecorder();

    const result = await acceptInvitation(repository, audit, {
      token: "invite-token",
      email: " Franchisee@Example.com ",
      displayName: "Franchisee",
      now: new Date("2026-08-10T00:00:00.000Z")
    });

    expect(result.user.email).toBe("franchisee@example.com");
    expect(result.membership.organisationId).toBe("org_franchise");
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      action: auditActions.authInviteAccept,
      entity: {
        type: "auth_invitation",
        id: "invite_1"
      },
      scope: {
        organisationId: "org_franchise",
        territoryId: "territory_1"
      }
    });
  });

  it("rejects expired and reused invitations", async () => {
    const repository = createMemoryAuthRepository({
      invitations: [
        {
          id: "expired",
          email: "user@example.com",
          organisationId: "org",
          tokenHash: hashToken("expired"),
          status: "pending",
          expiresAt: new Date("2026-08-09T00:00:00.000Z")
        },
        {
          id: "used",
          email: "user@example.com",
          organisationId: "org",
          tokenHash: hashToken("used"),
          status: "accepted",
          expiresAt: new Date("2026-08-11T00:00:00.000Z"),
          acceptedAt: new Date("2026-08-10T00:00:00.000Z")
        }
      ]
    });
    const audit = createMemoryAuditRecorder();

    await expect(
      acceptInvitation(repository, audit, {
        token: "expired",
        email: "user@example.com",
        now: new Date("2026-08-10T00:00:00.000Z")
      })
    ).rejects.toThrow("no longer valid");

    await expect(
      acceptInvitation(repository, audit, {
        token: "used",
        email: "user@example.com",
        now: new Date("2026-08-10T00:00:00.000Z")
      })
    ).rejects.toThrow("already been used");

    expect(audit.events).toHaveLength(0);
  });

  it("grants the invited role, scoped to the invited organisation and territory, and only once", async () => {
    const repository = createMemoryAuthRepository({
      invitations: [
        { id: "invite_1", email: "staff@example.com", organisationId: "org_franchise", territoryId: "territory_1", roleId: "role_franchisee", tokenHash: hashToken("tok"), status: "pending", expiresAt: new Date("2026-08-11T00:00:00.000Z") }
      ]
    });
    const audit = createMemoryAuditRecorder();
    const now = new Date("2026-08-10T00:00:00.000Z");

    const result = await acceptInvitation(repository, audit, { token: "tok", email: "staff@example.com", now });
    expect(repository.roleGrants).toEqual([{ userId: result.user.id, roleId: "role_franchisee", organisationId: "org_franchise", territoryId: "territory_1" }]);
    expect(audit.events[0]).toMatchObject({ metadata: { roleId: "role_franchisee" } });

    await expect(acceptInvitation(repository, audit, { token: "tok", email: "staff@example.com", now })).rejects.toThrow("already been used");
    expect(repository.roleGrants).toHaveLength(1);
  });

  it("grants no role for a plain membership invitation", async () => {
    const repository = createMemoryAuthRepository({
      invitations: [{ id: "invite_1", email: "a@example.com", organisationId: "org", tokenHash: hashToken("tok"), status: "pending", expiresAt: new Date("2026-08-11T00:00:00.000Z") }]
    });
    await acceptInvitation(repository, createMemoryAuditRecorder(), { token: "tok", email: "a@example.com", now: new Date("2026-08-10T00:00:00.000Z") });
    expect(repository.roleGrants).toEqual([]);
  });

  it("lets only one of two simultaneous accepts through, and refuses a disabled account", async () => {
    const repository = createMemoryAuthRepository({
      users: [{ id: "user_9", email: "gone@example.com", status: "disabled" }],
      invitations: [
        { id: "i1", email: "b@example.com", organisationId: "org", roleId: "role_x", tokenHash: hashToken("race"), status: "pending", expiresAt: new Date("2026-08-11T00:00:00.000Z") },
        { id: "i2", email: "gone@example.com", organisationId: "org", tokenHash: hashToken("disabled"), status: "pending", expiresAt: new Date("2026-08-11T00:00:00.000Z") }
      ]
    });
    const now = new Date("2026-08-10T00:00:00.000Z");
    const attempts = await Promise.allSettled([
      acceptInvitation(repository, createMemoryAuditRecorder(), { token: "race", email: "b@example.com", now }),
      acceptInvitation(repository, createMemoryAuditRecorder(), { token: "race", email: "b@example.com", now })
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(repository.roleGrants).toHaveLength(1);

    await expect(acceptInvitation(repository, createMemoryAuditRecorder(), { token: "disabled", email: "gone@example.com", now })).rejects.toThrow(/cannot accept/);
  });
});
