import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readCommercialCommandCentre } from "../../../../../lib/advertising-runtime";
import { readDebtPanel } from "../../../../../lib/assistants-finance";
import { displayName, formatCount } from "../../../../../lib/format";
import { EmptyState, FactList, LinkButton, Metrics, PageHeader, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { DebtAssistantPanel } from "./DebtAssistantPanel";
import { requestFromSearchParamsAndCookies } from "../../page";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Commercial health" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommercialCommandCentrePage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const result = await loadCommandCentre(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { commandCentre, debt } = result;
  const { totals, attention } = commandCentre;
  const percent = (value: number | null | undefined) => (value == null ? "No data" : `${value}%`);

  return (
    <>
      <PageHeader
        eyebrow="Commercial"
        title="Commercial health"
        intro={
          commandCentre.scope === "network"
            ? "How advertising is performing across the network: pipeline, bookings, money in and what needs chasing."
            : "How advertising is performing in your area: pipeline, bookings, money in and what needs chasing."
        }
        actions={
          <>
            <LinkButton href={"/app/advertisers/pipeline" as Route}>Open pipeline</LinkButton>
            <LinkButton href={"/app/advertisers" as Route} variant="secondary">
              All advertisers
            </LinkButton>
          </>
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Advertisers", value: totals.advertisers },
            { label: "Pipeline", value: formatMoney(totals.pipelineValueMinor) },
            { label: "Booked", value: formatMoney(totals.bookedValueMinor) },
            { label: "Invoiced", value: formatMoney(totals.invoicedMinor) },
            { label: "Paid", value: formatMoney(totals.paidMinor) },
            { label: "Overdue debt", value: formatMoney(totals.overdueDebtMinor), tone: totals.overdueDebtMinor > 0 ? "danger" : "success" },
            { label: "Artwork outstanding", value: totals.openArtwork, tone: totals.openArtwork > 0 ? "warning" : "success" },
            { label: "Open renewals", value: totals.openRenewals, tone: totals.openRenewals > 0 ? "warning" : "neutral" }
          ]}
        />
      </Panel>

      <Panel eyebrow="Benchmarking" title="Area performance">
        {commandCentre.territoryBenchmarks.length === 0 ? (
          <EmptyState title="Nothing to compare yet">Area figures appear once advertisers have been booked.</EmptyState>
        ) : (
          <RecordList>
            {commandCentre.territoryBenchmarks.map((territory) => (
              <RecordCard
                key={territory.territoryId}
                title={displayName(territory.territoryName, "Territory not named yet")}
                lines={[
                  `${formatCount(territory.advertisers, "advertiser")} · ${formatMoney(territory.bookedValueMinor)} booked · ${territory.retentionRate}% retained`,
                  `Average sale ${formatMoney(territory.averageSaleValueMinor)} · Overdue ${formatMoney(territory.overdueDebtMinor)} · ${formatCount(territory.openRenewals, "open renewal")}`
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Retention and mix" title="Churn and what is being sold" intro={commandCentre.definitionsNote}>
        <Metrics
          items={[
            {
              label: "Churn (12 months)",
              value: percent(commandCentre.churn.ratePercent),
              detail: `${commandCentre.churn.lost} of ${commandCentre.churn.baseAYearAgo} advertisers lost`,
              tone: commandCentre.churn.lost > 0 ? "warning" : "neutral"
            },
            {
              label: "Package share (90 days)",
              value: percent(commandCentre.mix.packageSharePercent),
              detail: `${formatMoney(commandCentre.mix.packageMinor)} of ${formatMoney(commandCentre.mix.soldMinor)}`
            },
            {
              label: "Digital share (90 days)",
              value: percent(commandCentre.mix.digitalSharePercent),
              detail: `${formatMoney(commandCentre.mix.digitalMinor)} of ${formatMoney(commandCentre.mix.soldMinor)}`
            }
          ]}
        />
      </Panel>

      <Panel eyebrow="Lost deals" title="Why deals were lost">
        {commandCentre.lostReasons.length === 0 ? (
          <EmptyState title="No lost deals recorded">Reasons are captured when an opportunity is moved to a lost stage.</EmptyState>
        ) : (
          <FactList items={commandCentre.lostReasons.map((entry) => ({ label: entry.reason, value: formatCount(entry.count, "deal") }))} />
        )}
      </Panel>

      <Panel eyebrow="Attention" title="Advertisers needing a chase">
        <Metrics
          items={[
            { label: "Overdue debt", value: attention.overdueDebtAdvertiserIds.length, tone: attention.overdueDebtAdvertiserIds.length > 0 ? "danger" : "success" },
            { label: "Artwork outstanding", value: attention.artworkAdvertiserIds.length, tone: attention.artworkAdvertiserIds.length > 0 ? "warning" : "success" },
            { label: "Fulfilment outstanding", value: attention.fulfilmentAdvertiserIds.length, tone: attention.fulfilmentAdvertiserIds.length > 0 ? "warning" : "success" },
            { label: "Renewal follow-up", value: attention.renewalAdvertiserIds.length, tone: attention.renewalAdvertiserIds.length > 0 ? "warning" : "success" }
          ]}
        />
      </Panel>
      {debt ? <DebtAssistantPanel request={request} panel={debt} resultCode={resultCode} /> : null}
    </>
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
