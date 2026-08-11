import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { readJourneyOverview } from "../../../../lib/marketing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function JourneysPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadJourneys(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Marketing automation</p>
        <h2>Journeys</h2>
        <p>
          Consent-aware automated journeys for parents and local audiences,
          with approved versions, execution state and failure visibility.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Journeys</span>
            <strong>{result.journeys.length}</strong>
          </article>
          <article>
            <span>Audience entries</span>
            <strong>{result.journeys.reduce((total, journey) => total + journey.entries, 0)}</strong>
          </article>
          <article>
            <span>Active runs</span>
            <strong>{result.journeys.reduce((total, journey) => total + journey.activeExecutions, 0)}</strong>
          </article>
          <article>
            <span>Failed runs</span>
            <strong>{result.totals.failedExecutions}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Configured journeys</p>
        <h2>Execution health</h2>
        <div className="franchise-list">
          {result.journeys.length === 0 ? (
            <div>
              <strong>No journeys configured</strong>
              <span>Approved journeys will appear here once automation is configured.</span>
            </div>
          ) : (
            result.journeys.map((journey) => (
              <div key={journey.journey.id}>
                <strong>{journey.journey.name}</strong>
                <span>
                  {journey.journey.status} - version{" "}
                  {journey.activeVersion?.versionNumber ?? "not approved"}
                </span>
                <span>
                  {journey.entries} entries - {journey.activeExecutions} active -{" "}
                  {journey.failedExecutions} failed
                </span>
                <span>{journey.journey.description ?? "No journey description provided."}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}

async function loadJourneys(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.journey",
      action: "view"
    });
    const journeys = await readJourneyOverview({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return journeys;
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
