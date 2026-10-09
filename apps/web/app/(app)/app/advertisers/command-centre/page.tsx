import { requireShellPermission } from "../../../../../lib/app-shell";
import { readCommercialCommandCentre } from "../../../../../lib/advertising-runtime";
import { readDebtPanel } from "../../../../../lib/assistants-finance";
import { DebtAssistantPanel } from "./DebtAssistantPanel";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Commercial command centre" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommercialCommandCentrePage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const result = await loadCommandCentre(request);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const { commandCentre, debt } = result;

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
        <p className="eyebrow">Retention and mix</p>
        <h2>Churn and what is being sold</h2>
        <div className="franchise-metrics">
          <article>
            <span>Churn (12 months)</span>
            <strong>{commandCentre.churn.ratePercent == null ? "No data" : `${commandCentre.churn.ratePercent}%`}</strong>
            <small>{commandCentre.churn.lost} of {commandCentre.churn.baseAYearAgo} advertisers lost</small>
          </article>
          <article>
            <span>Package share (90 days)</span>
            <strong>{commandCentre.mix.packageSharePercent == null ? "No data" : `${commandCentre.mix.packageSharePercent}%`}</strong>
            <small>{formatMoney(commandCentre.mix.packageMinor)} of {formatMoney(commandCentre.mix.soldMinor)}</small>
          </article>
          <article>
            <span>Digital share (90 days)</span>
            <strong>{commandCentre.mix.digitalSharePercent == null ? "No data" : `${commandCentre.mix.digitalSharePercent}%`}</strong>
            <small>{formatMoney(commandCentre.mix.digitalMinor)} of {formatMoney(commandCentre.mix.soldMinor)}</small>
          </article>
        </div>
        <p>{commandCentre.definitionsNote}</p>
        <h3>Why deals were lost</h3>
        {commandCentre.lostReasons.length === 0 ? <p>No lost deals recorded.</p> : (
          <div className="franchise-list">
            {commandCentre.lostReasons.map((entry) => (
              <div key={entry.reason}><strong>{entry.reason}</strong><span>{entry.count}</span></div>
            ))}
          </div>
        )}
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
      {debt ? <DebtAssistantPanel request={request} panel={debt} resultCode={resultCode} /> : null}
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

    // The finance assistant never stops the page loading.
    const debt = await readDebtPanel({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }).catch(() => undefined);
    return { commandCentre, debt };
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
