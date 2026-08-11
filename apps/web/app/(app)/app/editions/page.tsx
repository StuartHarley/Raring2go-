import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { listEditionFactoryRows } from "../../../../lib/publishing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditionsPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadEditions(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const blockedCount = result.rows.filter((row) => row.riskStatus === "blocked").length;
  const watchCount = result.rows.filter((row) => row.riskStatus === "watch").length;
  const generatedCount = result.rows.filter(
    (row) => row.printStatus === "generated" || row.digitalStatus === "generated"
  ).length;

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Edition Factory</p>
        <h2>HQ Control Room</h2>
        <p>
          Network-wide production status for seasonal territory editions, built
          from the same canonical edition records that feed print and digital output.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Territory editions</span>
            <strong>{result.rows.length}</strong>
          </article>
          <article>
            <span>Blocked</span>
            <strong>{blockedCount}</strong>
          </article>
          <article>
            <span>Needs watch</span>
            <strong>{watchCount}</strong>
          </article>
          <article>
            <span>Outputs generated</span>
            <strong>{generatedCount}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Live editions</p>
        <h2>Production queue</h2>
        <div className="franchise-list">
          {result.rows.map((row) => (
            <Link key={row.territoryEdition.id} href={`/app/editions/${row.territoryEdition.id}` as Route}>
              <strong>{row.territory?.name ?? row.territoryEdition.title}</strong>
              <span>{row.season.name} - {row.phase} - {row.riskStatus.replace("_", " ")}</span>
              <span>
                {row.pagesReady}/{row.pagesTotal} pages ready - {row.completionPercent}% complete
              </span>
              <span>
                Local actions {row.localActions} - HQ actions {row.hqActions} - next deadline {row.nextDeadline ?? "not set"}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function loadEditions(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "edition",
      action: "view"
    });
    const rows = await listEditionFactoryRows({
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
