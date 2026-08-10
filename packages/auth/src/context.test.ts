import { describe, expect, it } from "vitest";
import { resolveWorkingContext } from "./context";
import { createMemoryAuthRepository } from "./test-helpers";

const activeSession = {
  id: "session_1",
  userId: "user_1",
  sessionTokenHash: "hash",
  assuranceLevel: "standard" as const,
  expiresAt: new Date("2026-08-11T00:00:00.000Z")
};

describe("resolveWorkingContext", () => {
  it("resolves multiple organisation memberships without storing active context on the session", async () => {
    const repository = createMemoryAuthRepository({
      memberships: [
        {
          id: "membership_1",
          userId: "user_1",
          organisationId: "org_hq",
          status: "active"
        },
        {
          id: "membership_2",
          userId: "user_1",
          organisationId: "org_franchise",
          status: "active"
        }
      ],
      territories: [
        {
          id: "territory_1",
          franchiseOrganisationId: "org_franchise",
          code: "SUT",
          name: "Sutton Coldfield",
          status: "active"
        }
      ]
    });

    await expect(
      resolveWorkingContext(repository, {
        session: activeSession,
        organisationId: "org_hq",
        now: new Date("2026-08-10T00:00:00.000Z")
      })
    ).resolves.toEqual({
      userId: "user_1",
      organisationId: "org_hq",
      assuranceLevel: "standard"
    });

    await expect(
      resolveWorkingContext(repository, {
        session: activeSession,
        organisationId: "org_franchise",
        territoryId: "territory_1",
        now: new Date("2026-08-10T00:00:00.000Z")
      })
    ).resolves.toMatchObject({
      organisationId: "org_franchise",
      territoryId: "territory_1"
    });
  });

  it("rejects cross-tenant organisation and territory context", async () => {
    const repository = createMemoryAuthRepository({
      memberships: [
        {
          id: "membership_1",
          userId: "user_1",
          organisationId: "org_franchise",
          status: "active"
        }
      ],
      territories: [
        {
          id: "territory_other",
          franchiseOrganisationId: "org_other",
          code: "OTH",
          name: "Other",
          status: "active"
        }
      ]
    });

    await expect(
      resolveWorkingContext(repository, {
        session: activeSession,
        organisationId: "org_hq",
        now: new Date("2026-08-10T00:00:00.000Z")
      })
    ).rejects.toThrow("not a member");

    await expect(
      resolveWorkingContext(repository, {
        session: activeSession,
        organisationId: "org_franchise",
        territoryId: "territory_other",
        now: new Date("2026-08-10T00:00:00.000Z")
      })
    ).rejects.toThrow("outside the organisation context");
  });

  it("requires elevated assurance for future MFA-sensitive actions", async () => {
    const repository = createMemoryAuthRepository({
      memberships: [
        {
          id: "membership_1",
          userId: "user_1",
          organisationId: "org_hq",
          status: "active"
        }
      ]
    });

    await expect(
      resolveWorkingContext(repository, {
        session: activeSession,
        organisationId: "org_hq",
        requiredAssuranceLevel: "mfa",
        now: new Date("2026-08-10T00:00:00.000Z")
      })
    ).rejects.toThrow("Higher authentication assurance");
  });
});
