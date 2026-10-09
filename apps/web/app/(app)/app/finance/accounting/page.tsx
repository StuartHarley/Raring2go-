import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readFinanceConfig } from "../../../../../lib/finance-config-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { retryAccountingSyncAction, setTaxRateAction } from "./actions";
import type { AccountingResult } from "./actions";

export const metadata = { title: "Accounting" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const banners: Record<AccountingResult, string> = {
  rate_saved: "The new rate is saved. It applies to invoices from its start date; the rate it replaces now ends the day before.",
  rate_invalid: "That rate was not saved. Use a lower-case code, a rate from 0 to 100, and a start date after the current rate's start.",
  rate_not_allowed: "You do not have permission to change tax rates.",
  retry_queued: "Queued to be sent to the accounting system again.",
  not_found: "That item was not found."
};

export default async function AccountingPage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const banner = resultCode && resultCode in banners ? banners[resultCode as AccountingResult] : null;
  const result = await load(request);
  if ("error" in result) {
    if (result.error instanceof ShellAccessError) return <AppShell request={request}><section className="app-panel"><h2>Not available</h2><p>You do not have access to finance configuration.</p></section></AppShell>;
    throw result.error;
  }

  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  const queryString = query.size > 0 ? `?${query.toString()}` : "";

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Finance</p>
        <h2>Tax rates and accounting</h2>
        <p>Invoices are priced with the rate in force on their issue date. Rates already used are never rewritten: a change starts a new rate.</p>
        <Link href={`/app/finance${queryString}` as Route} className="app-link-button">Back to finance</Link>
        {banner ? <p role="status" className="app-banner">{banner}</p> : null}
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Tax rates</p>
        <h2>Rates by code</h2>
        <div className="franchise-list">
          {result.rates.map((rate) => (
            <div key={rate.id}>
              <strong>{rate.code}</strong>
              <span>{(rate.rateBps / 100).toFixed(2)}% from {rate.effectiveFrom}{rate.effectiveTo ? ` to ${rate.effectiveTo}` : " (current)"} - {rate.description}</span>
            </div>
          ))}
        </div>
        <form action={setTaxRateAction.bind(null, request)} className="franchise-form">
          <label>Code<input name="code" required maxLength={40} pattern="[a-z][a-z0-9_]{1,40}" placeholder="standard_vat" /></label>
          <label>Description<input name="description" maxLength={120} /></label>
          <label>Rate (%)<input name="ratePercent" type="number" step="0.01" min="0" max="100" required /></label>
          <label>Starts<input name="effectiveFrom" type="date" required /></label>
          <button type="submit">Add a new rate</button>
        </form>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Accounting hand-off</p>
        <h2>{result.counts.synced} synced - {result.counts.pending} waiting - {result.counts.failed} need attention</h2>
        <p>Every issued invoice and credit note is sent to the accounting system in the background. Waiting items retry on their own; items that keep failing stop and appear here.</p>
        {result.attention.length === 0 ? <p>Nothing is waiting.</p> : null}
        <div className="franchise-list">
          {result.attention.map((item) => (
            <div key={item.id}>
              <strong>{item.entityType === "advertiser_invoice" ? "Invoice" : "Credit note"} - {item.status}</strong>
              <span>{item.attempts} attempt{item.attempts === 1 ? "" : "s"}{item.lastError ? ` - ${item.lastError}` : ""}{item.waitingFor ? ` - Waiting: ${item.waitingFor}` : ""}</span>
              <form action={retryAccountingSyncAction.bind(null, request, item.id)}><button type="submit">Retry now</button></form>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "advertiser.tax_rate", action: "manage" });
    return await readFinanceConfig({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
  } catch (error) {
    return { error };
  }
}
