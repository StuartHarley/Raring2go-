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
});
