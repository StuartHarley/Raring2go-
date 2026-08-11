import type { Route } from "next";
import type { ResolvedShell } from "./app-shell";
import { listAdvertiser360Rows, readPipeline } from "./advertising-runtime";
import { listComplianceOverview, listOnboardingOverview } from "./franchise-runtime";
import {
  readJourneyOverview,
  readMarketingCommandCentre,
  readNewsletterFactoryOverview
} from "./marketing-runtime";
import { listEditionFactoryRows, readSocialQueue } from "./publishing-runtime";

export type TodayPriority = "critical" | "warning" | "info";

export type TodayItem = {
  id: string;
  priority: TodayPriority;
  area: string;
  title: string;
  detail: string;
  href: Route;
};

export type TodayMetric = {
  label: string;
  value: string;
  detail: string;
};

export type TodayWorkflow = {
  label: string;
  href: Route;
  status: string;
};

export type MyTodayView = {
  metrics: TodayMetric[];
  attention: TodayItem[];
  workflows: TodayWorkflow[];
};

type ShellContext = {
  userId: string;
  organisationId: string;
  territoryId?: string;
};

export async function buildMyToday(shell: ResolvedShell): Promise<MyTodayView> {
  const context: ShellContext = {
    userId: shell.userId,
    organisationId: shell.activeContext.organisationId,
    territoryId: shell.activeContext.territoryId
  };
  const visible = new Set(shell.navigation.map((item) => item.id));
  const metrics: TodayMetric[] = [];
  const attention: TodayItem[] = [];
  const workflows: TodayWorkflow[] = [];

  if (visible.has("franchisees")) {
    const [compliance, onboarding] = await Promise.all([
      listComplianceOverview(context).catch(() => []),
      listOnboardingOverview(context).catch(() => [])
    ]);
    const openCompliance = compliance.reduce((total, row) => total + row.openActions, 0);
    const blockedOnboarding = onboarding.filter((row) => row.blockedTasks > 0).length;

    metrics.push({
      label: "Compliance actions",
      value: String(openCompliance),
      detail: `${compliance.length} franchise record${compliance.length === 1 ? "" : "s"} in scope`
    });
    workflows.push({
      label: "Franchisee 360",
      href: "/app/franchisees" as Route,
      status:
        blockedOnboarding > 0
          ? `${blockedOnboarding} onboarding blocker${blockedOnboarding === 1 ? "" : "s"}`
          : "Operating records ready"
    });

    for (const row of compliance.filter((candidate) => candidate.openActions > 0).slice(0, 3)) {
      attention.push({
        id: `compliance-${row.franchise.id}`,
        priority: row.status === "expired" ? "critical" : "warning",
        area: "Franchise",
        title: `${row.territory?.name ?? "Territory"} compliance needs action`,
        detail: `${row.completeCount}/${row.totalCount} requirements complete; ${row.openActions} open action${row.openActions === 1 ? "" : "s"}`,
        href: `/app/franchisees/${row.franchise.id}` as Route
      });
    }
  }

  if (visible.has("advertisers")) {
    const [advertisers, pipeline] = await Promise.all([
      listAdvertiser360Rows(context).catch(() => []),
      readPipeline(context).catch(() => undefined)
    ]);
    const outstandingMinor = advertisers.reduce(
      (total, row) => total + row.financeSummary.outstandingMinor,
      0
    );

    metrics.push({
      label: "Advertisers",
      value: String(advertisers.length),
      detail: `${formatMoney(outstandingMinor)} outstanding`
    });
    workflows.push({
      label: "Advertiser workflow",
      href: "/app/advertisers" as Route,
      status: `${pipeline?.overdueFollowUps.length ?? 0} overdue follow-up${pipeline?.overdueFollowUps.length === 1 ? "" : "s"}`
    });

    for (const row of pipeline?.overdueFollowUps.slice(0, 3) ?? []) {
      attention.push({
        id: `pipeline-${row.opportunity.id}`,
        priority: "warning",
        area: "Commercial",
        title: row.opportunity.title,
        detail: `${row.organisation.name}; next action ${row.opportunity.nextActionDate ?? "not set"}`,
        href: "/app/advertisers/pipeline" as Route
      });
    }
  }

  if (visible.has("editions")) {
    const editions = await listEditionFactoryRows(context).catch(() => []);
    const blocked = editions.filter((row) => row.riskStatus === "blocked");
    const watch = editions.filter((row) => row.riskStatus === "watch");

    metrics.push({
      label: "Editions at risk",
      value: String(blocked.length + watch.length),
      detail: `${blocked.length} blocked; ${watch.length} need watch`
    });
    workflows.push({
      label: "Edition Factory",
      href: "/app/editions" as Route,
      status: `${editions.length} territory edition${editions.length === 1 ? "" : "s"}`
    });

    for (const row of blocked.slice(0, 3)) {
      attention.push({
        id: `edition-${row.territoryEdition.id}`,
        priority: "critical",
        area: "Publishing",
        title: `${row.territory?.name ?? row.territoryEdition.title} edition blocked`,
        detail: `${row.blockedPages} blocked page${row.blockedPages === 1 ? "" : "s"}; next deadline ${row.nextDeadline ?? "not set"}`,
        href: `/app/editions/${row.territoryEdition.id}` as Route
      });
    }
  }

  if (visible.has("newsletters")) {
    const newsletter = await readNewsletterFactoryOverview(context).catch(() => undefined);
    if (newsletter) {
      metrics.push({
        label: "Newsletter readiness",
        value: String(newsletter.totals.ready),
        detail: `${newsletter.totals.blocked} blocked; ${newsletter.totals.needsReview} need review`
      });
      workflows.push({
        label: "Newsletter Factory",
        href: "/app/newsletters" as Route,
        status: `${newsletter.totals.editions} editions`
      });
    }
  }

  if (visible.has("social")) {
    const social = await readSocialQueue(context).catch(() => undefined);
    const failed = social?.queue.filter((item) => item.job?.status === "failed").length ?? 0;
    if (social) {
      workflows.push({
        label: "Social Queue",
        href: "/app/social" as Route,
        status:
          failed > 0
            ? `${failed} failed publication${failed === 1 ? "" : "s"}`
            : `${social.queue.length} queued publication${social.queue.length === 1 ? "" : "s"}`
      });
      for (const item of social.queue
        .filter((candidate) => candidate.job?.status === "failed")
        .slice(0, 2)) {
        attention.push({
          id: `social-${item.publication.id}`,
          priority: "warning",
          area: "Marketing",
          title: item.content?.title ?? "Social publication failed",
          detail: item.job?.lastError ?? "Provider returned a failed publishing job.",
          href: "/app/social" as Route
        });
      }
    }
  }

  if (visible.has("journeys")) {
    const journeys = await readJourneyOverview(context).catch(() => undefined);
    if (journeys) {
      metrics.push({
        label: "Journey failures",
        value: String(journeys.totals.failedExecutions),
        detail: `${journeys.totals.active} active journey${journeys.totals.active === 1 ? "" : "s"}`
      });
      workflows.push({
        label: "Journeys",
        href: "/app/journeys" as Route,
        status: `${journeys.totals.failedExecutions} failed execution${journeys.totals.failedExecutions === 1 ? "" : "s"}`
      });
    }
  }

  if (visible.has("marketing-command")) {
    const command = await readMarketingCommandCentre(context).catch(() => undefined);
    for (const item of command?.actionItems.slice(0, 3) ?? []) {
      attention.push({
        id: `marketing-${item.id}`,
        priority: item.severity,
        area: "Marketing",
        title: item.title,
        detail: item.territoryId ? `Territory ${item.territoryId}` : "Network-wide",
        href: "/app/marketing-command" as Route
      });
    }
  }

  return {
    metrics,
    attention: attention.sort(comparePriority).slice(0, 8),
    workflows
  };
}

function comparePriority(left: TodayItem, right: TodayItem) {
  const order: Record<TodayPriority, number> = {
    critical: 0,
    warning: 1,
    info: 2
  };

  return order[left.priority] - order[right.priority];
}

function formatMoney(valueMinor: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(valueMinor / 100);
}
