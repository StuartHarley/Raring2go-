import { describe, expect, it } from "vitest";
import { fixtureIds, foundationSeed } from "./fixtures";

describe("foundation fixtures", () => {
  it("uses deterministic ids for repeatable seeds", () => {
    expect(fixtureIds.organisations.hq).toBe(
      "00000000-0000-4000-8000-000000000001"
    );
    expect(foundationSeed.organisations).toHaveLength(3);
  });

  it("keeps seed permissions intentionally minimal", () => {
    expect(foundationSeed.permissions.map((permission) => permission.module)).toEqual([
      "system",
      "territory",
      "roles",
      "franchise",
      "franchise",
      "franchise"
    ]);
  });

  it("includes a deterministic franchise relationship fixture", () => {
    expect(fixtureIds.franchises.suttonColdfield).toBe(
      "00000000-0000-4000-8000-000000000901"
    );
    expect(foundationSeed.franchises[0]?.franchiseOrganisationId).toBe(
      fixtureIds.organisations.franchise
    );
    expect(foundationSeed.franchises[0]?.primaryTerritoryId).toBe(
      fixtureIds.territories.suttonColdfield
    );
  });

  it("includes a deterministic invitation fixture for IAM-001", () => {
    expect(fixtureIds.invitations.franchiseStaff).toBe(
      "00000000-0000-4000-8000-000000000801"
    );
  });
});
