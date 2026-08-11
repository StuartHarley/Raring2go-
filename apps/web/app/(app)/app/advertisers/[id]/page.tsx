import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readAdvertiser360 } from "../../../../../lib/advertising-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Advertiser360Page({ params, searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const { id } = await params;
  const result = await loadAdvertiser(request, id);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Advertiser 360</p>
        <h2>{result.organisation.name}</h2>
        <p>
          Canonical advertiser relationship record for contacts, activity,
          commercial value and future bookings.
        </p>
        <Link href={`/app/advertisers/${result.advertiser.id}/acceptance` as Route} className="app-link-button">
          Review acceptance
        </Link>
        <div className="franchise-metrics">
          <article>
            <span>Relationship</span>
            <strong>{result.advertiser.relationshipState}</strong>
          </article>
          <article>
            <span>Average sale</span>
            <strong>{formatMoney(result.advertiser.averageSaleValueMinor)}</strong>
          </article>
          <article>
            <span>Annual value</span>
            <strong>{formatMoney(result.advertiser.annualAdvertiserValueMinor)}</strong>
          </article>
          <article>
            <span>Debt</span>
            <strong>{formatMoney(result.latestMetrics?.overdueDebtMinor ?? 0)}</strong>
          </article>
          <article>
            <span>Pipeline</span>
            <strong>{formatMoney(result.opportunities.reduce((sum, view) => sum + view.opportunity.estimatedValueMinor, 0))}</strong>
          </article>
          <article>
            <span>Proposals</span>
            <strong>{result.proposals.length}</strong>
          </article>
          <article>
            <span>Bookings</span>
            <strong>{result.bookings.length}</strong>
          </article>
          <article>
            <span>Acceptances</span>
            <strong>{result.acceptances.length}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Contacts</p>
        <h2>People</h2>
        <div className="franchise-list">
          {result.contacts.map((contact) => (
            <div key={contact.id}>
              <strong>{contact.name ?? contact.label}</strong>
              <span>{contact.role} - {contact.email ?? "linked platform user"}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Opportunities</p>
        <h2>Commercial pipeline</h2>
        <div className="franchise-list">
          {result.opportunities.length === 0 ? (
            <div>
              <strong>No open opportunities yet</strong>
              <span>Pipeline management starts in ADV-002.</span>
            </div>
          ) : (
            result.opportunities.map((view) => (
              <div key={view.opportunity.id}>
                <strong>{view.opportunity.title}</strong>
                <span>{view.stage.name} - {formatMoney(view.opportunity.estimatedValueMinor)} - {view.attention.replaceAll("_", " ")}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Proposals and bookings</p>
        <h2>Commercial workflow</h2>
        <div className="franchise-list">
          {result.proposals.length === 0 ? (
            <div>
              <strong>No proposals yet</strong>
              <span>Proposal generation and booking acceptance are introduced in ADV-004.</span>
            </div>
          ) : (
            result.proposals.map((proposal) => (
              <div key={proposal.id}>
                <strong>{proposal.title}</strong>
                <span>{proposal.status} - valid until {proposal.validUntil ?? "not set"}</span>
                <span>{formatMoney(proposal.totalValueMinor)}</span>
              </div>
            ))
          )}
        </div>
        <div className="franchise-facts">
          <div>
            <dt>Commercial acceptances</dt>
            <dd>{result.acceptances.length}</dd>
          </div>
          <div>
            <dt>Accepted bookings</dt>
            <dd>{result.bookings.length}</dd>
          </div>
          <div>
            <dt>Production requests</dt>
            <dd>{result.productionRequests.length}</dd>
          </div>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Commercial foundations</p>
        <h2>Metrics and deferred workflows</h2>
        <div className="franchise-facts">
          <div>
            <dt>Package mix</dt>
            <dd>{JSON.stringify(result.latestMetrics?.packageMix ?? {})}</dd>
          </div>
          <div>
            <dt>Digital mix</dt>
            <dd>{JSON.stringify(result.latestMetrics?.digitalMix ?? {})}</dd>
          </div>
          <div>
            <dt>Conversion</dt>
            <dd>{result.latestMetrics?.conversionState ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Churn risk</dt>
            <dd>{result.latestMetrics?.churnRisk ?? "unknown"}</dd>
          </div>
        </div>
        <div className="franchise-tabs">
          <span>Advertiser acceptance deferred to ADV-005</span>
          <span>Invoices deferred to ADV-006</span>
          <span>Artwork intake deferred to ADV-007</span>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Activity</p>
        <h2>Timeline</h2>
        <ol className="franchise-activity">
          {result.activity.map((event) => (
            <li key={event.id}>
              <strong>{event.title}</strong>
              <span>{event.activityType}</span>
            </li>
          ))}
        </ol>
      </section>
    </AppShell>
  );
}

async function loadAdvertiser(
  request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>,
  advertiserId: string
) {
  try {
    const shell = await requireShellPermission(request, {
      module: "advertiser",
      action: "view"
    });
    return await readAdvertiser360(
      {
        userId: shell.userId,
        organisationId: shell.activeContext.organisationId,
        territoryId: shell.activeContext.territoryId
      },
      advertiserId
    );
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
