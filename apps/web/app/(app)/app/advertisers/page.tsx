import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { listAdvertiser360Rows } from "../../../../lib/advertising-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdvertisersPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadAdvertisers(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const retained = result.advertisers.filter((row) => row.advertiser.relationshipState === "retained").length;
  const annualValue = result.advertisers.reduce(
    (total, row) => total + row.advertiser.annualAdvertiserValueMinor,
    0
  );

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Advertiser CRM</p>
        <h2>Advertisers</h2>
        <p>
          Territory-scoped advertiser relationships, contacts and commercial
          health foundations before pipeline, booking and invoicing workflows.
        </p>
        <Link href={"/app/advertisers/pipeline" as Route} className="app-link-button">
          Open pipeline
        </Link>
        <Link href={"/app/advertisers/catalogue" as Route} className="app-link-button">
          View catalogue
        </Link>
        <div className="franchise-metrics">
          <article>
            <span>Advertisers</span>
            <strong>{result.advertisers.length}</strong>
          </article>
          <article>
            <span>Retained</span>
            <strong>{retained}</strong>
          </article>
          <article>
            <span>Annual value</span>
            <strong>{formatMoney(annualValue)}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Accounts</p>
        <h2>Advertiser 360 list</h2>
        <div className="franchise-list">
          {result.advertisers.map((row) => (
            <Link key={row.advertiser.id} href={`/app/advertisers/${row.advertiser.id}` as Route}>
              <strong>{row.organisation.name}</strong>
              <span>{row.territory?.name ?? row.advertiser.owningTerritoryId} - {row.advertiser.relationshipState}</span>
              <span>
                ASV {formatMoney(row.advertiser.averageSaleValueMinor)} - AAV {formatMoney(row.advertiser.annualAdvertiserValueMinor)}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function loadAdvertisers(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "advertiser",
      action: "view"
    });
    const advertisers = await listAdvertiser360Rows({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { advertisers };
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
