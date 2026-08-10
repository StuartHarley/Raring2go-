import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { listFranchiseSummaries } from "../../../../lib/franchise-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FranchiseesPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadFranchisees(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Franchise Hub</p>
        <h2>Franchisees</h2>
        <p>
          Canonical operating relationships linking franchise organisations,
          territory ownership and platform users.
        </p>
        <div className="franchise-list">
          {result.franchises.map((franchise) => (
            <Link key={franchise.id} href={`/app/franchisees/${franchise.id}` as Route}>
              <strong>{franchise.primaryTerritoryId}</strong>
              <span>{franchise.status} - {franchise.lifecycleStage}</span>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function loadFranchisees(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "franchise",
      action: "view"
    });
    const franchises = listFranchiseSummaries({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { franchises };
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
