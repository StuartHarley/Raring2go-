import { describe, expect, it, vi } from "vitest";
import type { ResolvedShell } from "./app-shell";
import { globalSearch } from "./global-search";

vi.mock("./advertising-runtime", () => ({
  listAdvertiser360Rows: vi.fn(async () => [
    {
      advertiser: {
        id: "advertiser_1",
        relationshipState: "retained"
      },
      organisation: {
        name: "Acme Family Fun"
      },
      territory: {
        name: "Sutton Coldfield"
      }
    }
  ]),
  readPipeline: vi.fn(async () => ({
    myPipeline: [
      {
        opportunity: {
          id: "opportunity_1",
          title: "Spring magazine package"
        },
        organisation: {
          name: "Acme Family Fun"
        },
        stage: {
          name: "Proposal"
        }
      }
    ]
  }))
}));

vi.mock("./franchise-runtime", () => ({
  listComplianceOverview: vi.fn(async () => [
    {
      franchise: {
        id: "franchise_1"
      },
      organisation: {
        name: "Raring2go Sutton"
      },
      territory: {
        name: "Sutton Coldfield"
      },
      completeCount: 8,
      totalCount: 9,
      openActions: 1
    }
  ])
}));

vi.mock("./publishing-runtime", () => ({
  listContentLibraryItems: vi.fn(async () => [
    {
      item: {
        id: "content_1",
        title: "Half-term days out",
        contentType: "article",
        status: "approved"
      },
      health: []
    }
  ]),
  listEditionFactoryRows: vi.fn(async () => [
    {
      territoryEdition: {
        id: "edition_1",
        title: "Spring Sutton Coldfield"
      },
      territory: {
        name: "Sutton Coldfield"
      },
      phase: "flatplan",
      riskStatus: "watch"
    }
  ])
}));

describe("globalSearch", () => {
  it("searches only visible module records", async () => {
    const results = await globalSearch(shellWithNavigation(["advertisers", "content"]), "acme");

    expect(results.map((result) => result.type)).toEqual(["advertiser", "opportunity"]);
    expect(results.every((result) => result.href.startsWith("/app/"))).toBe(true);
  });

  it("does not return results for hidden capabilities", async () => {
    await expect(globalSearch(shellWithNavigation(["franchisees"]), "acme")).resolves.toEqual([]);
  });

  it("requires at least two search characters", async () => {
    await expect(globalSearch(shellWithNavigation(["advertisers"]), "a")).resolves.toEqual([]);
  });
});

function shellWithNavigation(ids: string[]): ResolvedShell {
  return {
    kind: "authenticated",
    userId: "user_1",
    displayName: "Stuart Harley",
    activeContext: {
      organisationId: "organisation_1",
      organisationName: "Raring2go HQ",
      territoryId: "territory_1",
      territoryName: "Sutton Coldfield"
    },
    availableContexts: [],
    decisions: {},
    navigation: ids.map((id) => ({
      id,
      label: id,
      href: `/app/${id}`,
      capability: {
        module: id,
        action: "view"
      },
      contextLevel: "territory",
      group: "today"
    }))
  };
}
