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
          <span>Pipeline deferred to ADV-002</span>
          <span>Products/inventory deferred to ADV-003</span>
          <span>Bookings deferred to ADV-004</span>
          <span>Invoices deferred to ADV-006</span>
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
