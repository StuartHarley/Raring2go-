import { describe, expect, it, vi } from "vitest";
import type { ResolvedShell } from "./app-shell";
import { buildMyToday } from "./my-today";

vi.mock("./advertising-runtime", () => ({
  readMyOpenTasks: vi.fn(async () => []),
  listAdvertiser360Rows: vi.fn(async () => [
    {
      financeSummary: {
        outstandingMinor: 125000
      }
    }
  ]),
  readPipeline: vi.fn(async () => ({
    overdueFollowUps: [
      {
        opportunity: {
          id: "opportunity_1",
          title: "Spring edition package",
          nextActionDate: "2026-08-12"
        },
        organisation: {
          name: "Acme Family Fun"
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
      territory: {
        name: "Sutton Coldfield"
      },
      status: "expired",
      completeCount: 7,
      totalCount: 9,
      openActions: 2
    }
  ]),
  listOnboardingOverview: vi.fn(async () => [
    {
      blockedTasks: 1
    }
  ])
}));

vi.mock("./marketing-runtime", () => ({
  readJourneyOverview: vi.fn(async () => ({
    totals: {
      active: 3,
      failedExecutions: 1
    }
  })),
  readMarketingCommandCentre: vi.fn(async () => ({
    actionItems: [
      {
        id: "marketing_1",
        severity: "warning",
        title: "Newsletter segment needs review"
      }
    ]
  })),
  readNewsletterFactoryOverview: vi.fn(async () => ({
    totals: {
      ready: 8,
      blocked: 1,
      needsReview: 2,
      editions: 11
    }
  }))
}));

vi.mock("./publishing-runtime", () => ({
  listEditionFactoryRows: vi.fn(async () => [
    {
      territoryEdition: {
        id: "edition_1",
        title: "Spring Sutton Coldfield"
      },
      territory: {
        name: "Sutton Coldfield"
      },
      riskStatus: "blocked",
      blockedPages: 2,
      nextDeadline: "2026-08-15"
    }
  ]),
  readSocialQueue: vi.fn(async () => ({
    queue: [
      {
        publication: {
          id: "social_1"
        },
        content: {
          title: "Weekend guide"
        },
        job: {
          status: "failed",
          lastError: "Provider unavailable"
        }
      }
    ]
  }))
}));

describe("buildMyToday tasks", () => {
  it("lists the user's due and overdue advertiser tasks, and not future ones", async () => {
    const { readMyOpenTasks } = await import("./advertising-runtime");
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    vi.mocked(readMyOpenTasks).mockResolvedValueOnce([
      { task: { id: "t1", advertiserId: "a1", title: "Chase artwork", dueOn: day(-2) }, advertiserName: "Cafe One" },
      { task: { id: "t2", advertiserId: "a1", title: "Ring about page 5", dueOn: day(0) }, advertiserName: "Cafe One" },
      { task: { id: "t3", advertiserId: "a2", title: "Next quarter", dueOn: day(30) }, advertiserName: "Cafe Two" },
      { task: { id: "t4", advertiserId: "a2", title: "Undated", dueOn: null }, advertiserName: "Cafe Two" }
    ] as never);
    const today = await buildMyToday(shellWithNavigation(["advertisers"]));
    const tasks = today.attention.filter((item) => item.id.startsWith("task-"));
    expect(tasks.map((item) => [item.title, item.priority])).toEqual([["Chase artwork", "warning"], ["Ring about page 5", "info"]]);
    expect(tasks[0]!.detail).toContain("overdue since");
    expect(tasks[0]!.href).toBe("/app/advertisers/a1#tasks");
  });
});

describe("buildMyToday", () => {
  it("builds an attention queue from visible capability areas", async () => {
    const today = await buildMyToday(shellWithNavigation(["franchisees", "advertisers", "editions"]));

    expect(today.metrics.map((metric) => metric.label)).toEqual([
      "Compliance actions",
      "Advertisers",
      "Editions at risk"
    ]);
    expect(today.attention.map((item) => item.area)).toEqual([
      "Franchise",
      "Publishing",
      "Commercial"
    ]);
    expect(today.workflows.map((workflow) => workflow.label)).toEqual([
      "Action Centre",
      "Global Search",
      "Franchisee 360",
      "Advertiser workflow",
      "Edition Factory"
    ]);
  });

  it("does not surface module summaries for hidden navigation capabilities", async () => {
    const today = await buildMyToday(shellWithNavigation(["franchisees"]));

    expect(today.metrics.map((metric) => metric.label)).toEqual(["Compliance actions"]);
    expect(today.attention).toHaveLength(1);
    expect(today.workflows.map((workflow) => workflow.label)).toEqual([
      "Action Centre",
      "Global Search",
      "Franchisee 360"
    ]);
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
