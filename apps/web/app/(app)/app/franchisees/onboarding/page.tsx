import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { listOnboardingOverview } from "../../../../../lib/franchise-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FranchiseOnboardingPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadOnboardingOverview(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">HQ onboarding overview</p>
        <h2>Launch readiness across the network</h2>
        <p>
          Live onboarding programmes, risk signals and current launch phases for permitted franchise records.
        </p>
        <div className="franchise-list">
          {result.rows.length > 0 ? (
            result.rows.map((row) => (
              <Link key={row.franchise.id} href={`/app/franchisees/${row.franchise.id}#onboarding` as Route}>
                <strong>{row.territory?.name ?? row.franchise.primaryTerritoryId}</strong>
                <span>{row.riskStatus} - {row.progress}% complete</span>
                <span>
                  {row.currentPhase ?? "No active phase"}; target {row.targetLaunchDate ?? "not set"}
                </span>
                <span>
                  {row.overdueTasks} overdue, {row.blockedTasks} blocked
                </span>
              </Link>
            ))
          ) : (
            <p>No onboarding programmes are available in the current context.</p>
          )}
        </div>
      </section>
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

function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return (
      <main className={`app-outcome app-outcome-${error.kind}`}>
        <section>
          <p className="eyebrow">{error.kind.replace("_", " ")}</p>
          <h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1>
          <p>{error.message}</p>
        </section>
      </main>
    );
  }

  throw error;
}
