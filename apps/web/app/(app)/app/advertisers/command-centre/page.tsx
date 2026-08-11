import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readCommercialCommandCentre } from "../../../../../lib/advertising-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommercialCommandCentrePage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadCommandCentre(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { commandCentre } = result;

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Commercial command centre</p>
        <h2>{commandCentre.scope === "network" ? "Network commercial health" : "Territory commercial health"}</h2>
        <p>
          Capability-scoped advertiser, pipeline, booking, finance, artwork,
          fulfilment and renewal benchmarks.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Advertisers</span>
            <strong>{commandCentre.totals.advertisers}</strong>
          </article>
          <article>
            <span>Pipeline</span>
            <strong>{formatMoney(commandCentre.totals.pipelineValueMinor)}</strong>
          </article>
          <article>
            <span>Booked</span>
            <strong>{formatMoney(commandCentre.totals.bookedValueMinor)}</strong>
          </article>
          <article>
            <span>Invoiced</span>
            <strong>{formatMoney(commandCentre.totals.invoicedMinor)}</strong>
          </article>
          <article>
            <span>Paid</span>
            <strong>{formatMoney(commandCentre.totals.paidMinor)}</strong>
          </article>
          <article>
            <span>Overdue debt</span>
            <strong>{formatMoney(commandCentre.totals.overdueDebtMinor)}</strong>
          </article>
          <article>
            <span>Artwork</span>
            <strong>{commandCentre.totals.openArtwork}</strong>
          </article>
          <article>
            <span>Renewals</span>
            <strong>{commandCentre.totals.openRenewals}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Benchmarking</p>
        <h2>Territory performance</h2>
        <div className="franchise-list">
          {commandCentre.territoryBenchmarks.map((territory) => (
            <div key={territory.territoryId}>
              <strong>{territory.territoryName ?? territory.territoryId}</strong>
              <span>
                {territory.advertisers} advertisers - {formatMoney(territory.bookedValueMinor)} booked - {territory.retentionRate}% retained
              </span>
              <span>
                ASV {formatMoney(territory.averageSaleValueMinor)} - overdue {formatMoney(territory.overdueDebtMinor)} - renewals {territory.openRenewals}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Attention</p>
        <h2>Commercial exceptions</h2>
        <div className="franchise-facts">
          <div>
            <dt>Overdue debt</dt>
            <dd>{commandCentre.attention.overdueDebtAdvertiserIds.length}</dd>
          </div>
          <div>
            <dt>Artwork outstanding</dt>
            <dd>{commandCentre.attention.artworkAdvertiserIds.length}</dd>
          </div>
          <div>
            <dt>Fulfilment outstanding</dt>
            <dd>{commandCentre.attention.fulfilmentAdvertiserIds.length}</dd>
          </div>
          <div>
            <dt>Renewal follow-up</dt>
            <dd>{commandCentre.attention.renewalAdvertiserIds.length}</dd>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

async function loadCommandCentre(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "advertiser.analytics",
      action: "view"
    });
    const commandCentre = await readCommercialCommandCentre({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { commandCentre };
  } catch (error) {
    return { error };
  }
}

function formatMoney(valueMinor: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(valueMinor / 100);
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
