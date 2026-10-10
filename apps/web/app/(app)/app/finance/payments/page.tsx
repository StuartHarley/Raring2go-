import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readPaymentsOverview } from "../../../../../lib/payments-runtime";
import { formatCount, formatDate, formatLabel } from "../../../../../lib/format";
import { Actions, EmptyState, LinkButton, Notice, PageHeader, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import { createPaymentLinkAction, emailPaymentLinkAction } from "./actions";
import type { PaymentsResult } from "./actions";

export const metadata = { title: "Payments" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const banners: Record<PaymentsResult, { tone: "success" | "warning" | "error"; text: string }> = {
  rate_limited: { tone: "error", text: "Too many payment link requests. Please wait a few minutes." },
  link_created: { tone: "success", text: "Payment link created. It is listed under the invoice below." },
  link_reused: { tone: "success", text: "That invoice already has a live link for this balance, so it was reused." },
  emailed: { tone: "success", text: "The billing contact has been emailed the payment link." },
  email_failed: { tone: "warning", text: "The link was created but the email could not be sent. Copy the link below instead." },
  no_contact: { tone: "warning", text: "The link was created, but this advertiser has no billing email. Copy the link below." },
  not_available: { tone: "error", text: "That way of paying is not set up for this franchise. Connect it under Settings, Connections." },
  not_allowed: { tone: "error", text: "You do not have permission to create payment links here." },
  invalid: { tone: "error", text: "That invoice cannot be paid online right now." }
};

const money = (minor: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
const label = (provider: string) => (provider === "stripe" ? "Stripe" : provider === "gocardless" ? "GoCardless" : formatLabel(provider));

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
    if (error instanceof ShellAccessError) {
      return (
        <>
          <Panel>
            <EmptyState title="Not available">You do not have access to payments.</EmptyState>
          </Panel>
        </>
      );
    }
    throw error;
  }
  const carried = new URLSearchParams();
  if (request.sessionKey) carried.set("session", request.sessionKey);
  const queryString = carried.size > 0 ? `?${carried.toString()}` : "";

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Online payments"
        intro="Create a secure payment link for an issued invoice, or email it to the billing contact. Payments appear on the invoice automatically once the provider confirms them."
        actions={
          <LinkButton href={`/app/finance${queryString}` as Route} variant="secondary">
            Back to finance
          </LinkButton>
        }
      />
      {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}

      {overview.attention.length > 0 ? (
        <Panel
          eyebrow="Needs a person"
          title="Disputes, refunds and payments to review"
          intro="Nothing here is reversed automatically. For a refund, raise a credit note on the invoice first; for a dispute, answer it with the provider."
          id="attention"
        >
          <RecordList>
            {overview.attention.map((item) => (
              <RecordCard key={item.id} title={`Invoice ${item.invoiceNumber}`} status={item.status} lines={[label(item.provider), item.reason]} />
            ))}
          </RecordList>
        </Panel>
      ) : null}

      <Panel
        eyebrow="Awaiting payment"
        title="Invoices with a balance"
        intro={overview.invoices.length === 0 ? undefined : `${formatCount(overview.invoices.length, "invoice")} waiting to be paid.`}
        id="invoices"
      >
        {overview.invoices.length === 0 ? (
          <EmptyState title="No invoices are waiting for payment">Issued invoices with a balance appear here with their payment links.</EmptyState>
        ) : (
          <RecordList>
            {overview.invoices.map((invoice) => {
              const providers = ([["stripe", invoice.options.stripe], ["gocardless", invoice.options.gocardless]] as const).filter(([, on]) => on).map(([provider]) => provider);
              return (
                <RecordCard
                  key={invoice.invoiceId}
                  title={`${invoice.invoiceNumber} · ${money(invoice.balanceMinor, invoice.currency)}`}
                  lines={[
                    ...invoice.open.map((link) => (
                      <span key={link.url}>
                        {label(link.provider)} link:{" "}
                        <a href={link.url} rel="noreferrer noopener">
                          {link.url}
                        </a>
                      </span>
                    )),
                    providers.length === 0 ? `No online provider is connected for this franchise.${invoice.options.bank ? " Bank transfer details are shown to the advertiser." : ""}` : null
                  ]}
                >
                  {providers.length > 0 ? (
                    <Actions>
                      {providers.map((provider) => (
                        <span key={provider} className="franchise-actions">
                          <form action={createPaymentLinkAction.bind(null, request, invoice.invoiceId, provider)}>
                            <button type="submit" className="r2-button r2-button--primary">New {label(provider)} link</button>
                          </form>
                          <form action={emailPaymentLinkAction.bind(null, request, invoice.invoiceId, provider)}>
                            <button type="submit" className="r2-button r2-button--secondary">Email {label(provider)} link</button>
                          </form>
                        </span>
                      ))}
                    </Actions>
                  ) : null}
                </RecordCard>
              );
            })}
          </RecordList>
        )}
      </Panel>

      {overview.unallocated.length > 0 ? (
        <Panel
          eyebrow="Unallocated"
          title="Online payments held as credit"
          intro="An overpayment, or an invoice settled another way meanwhile. Place it against an invoice from the advertiser's page."
          id="unallocated"
        >
          <RecordList>
            {overview.unallocated.map((payment) => (
              <RecordCard key={payment.id} title={money(payment.unallocatedMinor, payment.currency)} lines={[`${label(String(payment.provider))} · received ${formatDate(payment.receivedDate)}`]} />
            ))}
          </RecordList>
        </Panel>
      ) : null}

      <Panel eyebrow="History" title="Recent payment links" id="history">
        {overview.requests.length === 0 ? (
          <EmptyState title="No payment links yet">Links you create or email from an invoice above are listed here with what happened to them.</EmptyState>
        ) : (
          <RecordList>
            {overview.requests.slice(0, 25).map((entry) => (
              <RecordCard
                key={entry.id}
                title={`${entry.invoiceNumber} · ${money(entry.amountMinor, entry.currency)}`}
                status={entry.status}
                lines={[label(entry.provider), entry.failureReason]}
              />
            ))}
          </RecordList>
        )}
      </Panel>
    </>
  );
}
