import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readPaymentsOverview } from "../../../../../lib/payments-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { createPaymentLinkAction, emailPaymentLinkAction } from "./actions";
import type { PaymentsResult } from "./actions";

export const metadata = { title: "Payments" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const banners: Record<PaymentsResult, string> = {
  rate_limited: "Too many payment link requests. Please wait a few minutes.",
  link_created: "Payment link created. It is listed under the invoice below.",
  link_reused: "That invoice already has a live link for this balance, so it was reused.",
  emailed: "The billing contact has been emailed the payment link.",
  email_failed: "The link was created but the email could not be sent. Copy the link below instead.",
  no_contact: "The link was created, but this advertiser has no billing email. Copy the link below.",
  not_available: "That way of paying is not set up for this franchise. Connect it under Settings, Connections.",
  not_allowed: "You do not have permission to create payment links here.",
  invalid: "That invoice cannot be paid online right now."
};

const money = (minor: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
const label = (provider: string) => (provider === "stripe" ? "Stripe" : provider === "gocardless" ? "GoCardless" : provider);

export default async function PaymentsPage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  const banner = code && code in banners ? banners[code as PaymentsResult] : null;

  let overview;
  try {
    const shell = await requireShellPermission(request, { module: "advertiser.finance", action: "view" });
    overview = await readPaymentsOverview({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
  } catch (error) {
    if (error instanceof ShellAccessError) return <AppShell request={request}><section className="app-panel"><h2>Not available</h2><p>You do not have access to payments.</p></section></AppShell>;
    throw error;
  }
  const carried = new URLSearchParams();
  if (request.sessionKey) carried.set("session", request.sessionKey);
  const queryString = carried.size > 0 ? `?${carried.toString()}` : "";

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Finance</p>
        <h2>Online payments</h2>
        <p>Create a secure payment link for an issued invoice, or email it to the billing contact. Payments appear on the invoice automatically once the provider confirms them.</p>
        <Link href={`/app/finance${queryString}` as Route} className="app-link-button">Back to finance</Link>
        {banner ? <p role="status" className="app-banner">{banner}</p> : null}
      </section>

      {overview.attention.length > 0 ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Needs a person</p>
          <h2>Disputes, refunds and payments to review</h2>
          <p>Nothing here is reversed automatically. For a refund, raise a credit note on the invoice first; for a dispute, answer it with the provider.</p>
          <div className="franchise-list">
            {overview.attention.map((item) => <div key={item.id}><strong>Invoice {item.invoiceNumber} - {item.status}</strong><span>{label(item.provider)}{item.reason ? ` - ${item.reason}` : ""}</span></div>)}
          </div>
        </section>
      ) : null}

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Awaiting payment</p>
        <h2>{overview.invoices.length === 0 ? "No invoices are waiting for payment" : `${overview.invoices.length} invoice${overview.invoices.length === 1 ? "" : "s"} with a balance`}</h2>
        <div className="franchise-list">
          {overview.invoices.map((invoice) => (
            <div key={invoice.invoiceId}>
              <strong>{invoice.invoiceNumber} - {money(invoice.balanceMinor, invoice.currency)}</strong>
              {invoice.open.map((link) => <span key={link.url}>{label(link.provider)} link: <a href={link.url} rel="noreferrer noopener">{link.url}</a></span>)}
              {([["stripe", invoice.options.stripe], ["gocardless", invoice.options.gocardless]] as const).filter(([, on]) => on).map(([provider]) => (
                <span key={provider}>
                  <form action={createPaymentLinkAction.bind(null, request, invoice.invoiceId, provider)}><button type="submit">New {label(provider)} link</button></form>
                  <form action={emailPaymentLinkAction.bind(null, request, invoice.invoiceId, provider)}><button type="submit">Email {label(provider)} link</button></form>
                </span>
              ))}
              {!invoice.options.stripe && !invoice.options.gocardless ? <span>No online provider is connected for this franchise.{invoice.options.bank ? " Bank transfer details are shown to the advertiser." : ""}</span> : null}
            </div>
          ))}
        </div>
      </section>

      {overview.unallocated.length > 0 ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Unallocated</p>
          <h2>Online payments held as credit</h2>
          <p>An overpayment, or an invoice settled another way meanwhile. Place it against an invoice from the advertiser&apos;s page.</p>
          <div className="franchise-list">{overview.unallocated.map((payment) => <div key={payment.id}><strong>{money(payment.unallocatedMinor, payment.currency)}</strong><span>{label(String(payment.provider))} - received {String(payment.receivedDate).slice(0, 10)}</span></div>)}</div>
        </section>
      ) : null}

      <section className="app-panel franchise-panel">
        <p className="eyebrow">History</p>
        <h2>Recent payment links</h2>
        <div className="franchise-list">
          {overview.requests.length === 0 ? <div><strong>None yet</strong></div> : overview.requests.slice(0, 25).map((entry) => (
            <div key={entry.id}><strong>{entry.invoiceNumber} - {money(entry.amountMinor, entry.currency)}</strong><span>{label(entry.provider)} - {entry.status}{entry.failureReason ? ` - ${entry.failureReason}` : ""}</span></div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
