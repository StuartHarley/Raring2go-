import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { displayName, formatCount, formatDate } from "../../../../../lib/format";
import { listOnboardingOverview } from "../../../../../lib/franchise-runtime";
import { EmptyState, Metrics, PageHeader, Panel, RecordLink, RecordList } from "../../../../../lib/page-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Onboarding overview" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FranchiseOnboardingPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadOnboardingOverview(request);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const launching = result.rows.filter((row) => row.riskStatus !== "launched").length;
  const atRisk = result.rows.filter((row) => row.riskStatus === "at_risk").length;
  const blocked = result.rows.filter((row) => row.riskStatus === "blocked").length;
  const overdue = result.rows.reduce((total, row) => total + row.overdueTasks, 0);

  return (
    <AppShell request={request}>
      <PageHeader
        eyebrow="Franchise"
        title="Onboarding"
        intro="Every franchise launch in progress: how far along each one is, its target date, and which ones are slipping or stuck."
      />

      <Panel>
        <Metrics
          items={[
            { label: "Launches in progress", value: launching, detail: formatCount(result.rows.length - launching, "franchise launched") },
            { label: "At risk", value: atRisk, tone: atRisk > 0 ? "warning" : "success" },
            { label: "Blocked", value: blocked, tone: blocked > 0 ? "danger" : "success" },
            { label: "Overdue tasks", value: overdue, tone: overdue > 0 ? "danger" : "success" }
          ]}
        />
      </Panel>

      <Panel eyebrow="Network" title="Launch readiness">
        {result.rows.length === 0 ? (
          <EmptyState title="No onboarding programmes in this context">A programme appears here once a franchise starts its launch plan.</EmptyState>
        ) : (
          <RecordList>
            {result.rows.map((row) => (
              <RecordLink
                key={row.franchise.id}
                href={`/app/franchisees/${row.franchise.id}#onboarding` as Route}
                title={displayName(row.territory?.name, "Territory not named yet")}
                status={row.riskStatus}
                tone={row.riskStatus === "blocked" ? "danger" : row.riskStatus === "at_risk" ? "warning" : row.riskStatus === "on_track" ? "info" : undefined}
                lines={[
                  `${row.progress}% complete · ${row.currentPhase ?? "No active phase"}`,
                  `Target launch ${formatDate(row.targetLaunchDate)}`,
                  `${formatCount(row.overdueTasks, "overdue task")} · ${formatCount(row.blockedTasks, "blocked task")}`
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>
    </AppShell>
  );
}

async function loadOnboardingOverview(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "franchise.onboarding",
      action: "manage"
    });
    const rows = await listOnboardingOverview({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { rows };
  } catch (error) {
    return { error };
  }
}
