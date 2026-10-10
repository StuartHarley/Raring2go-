import { requireShellPermission } from "../../../../lib/app-shell";
import { readPortal } from "../../../../lib/portal-runtime";
import { readPortalPaymentOptions } from "../../../../lib/payments-runtime";
import { formatDate, formatLabel } from "../../../../lib/format";
import { Actions, EmptyState, Metrics, Notice, PageHeader, Panel, RecordCard, RecordList, StatusBadge, Table } from "../../../../lib/page-ui";
import type { Tone } from "../../../../lib/page-ui";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { ArtworkUploadForm } from "./ArtworkUploadForm";
import { payInvoiceAction, respondToProofAction, respondToProposalAction, signProposalAction } from "./actions";
import { advertiserSigningEnabled } from "../../../../lib/advertiser-signing";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "My campaigns" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  awaiting_signature: { tone: "success", text: "Your signing request has been sent. Your booking is confirmed once your signature is complete." },
  signing_returned: { tone: "success", text: "Thank you. We will confirm your booking here as soon as your signature is verified, which can take a few minutes." },
  signing_declined: { tone: "success", text: "You declined to sign, so nothing has been booked." },
  signing_unavailable: { tone: "error", text: "We could not start the signing just now. Please try again in a few minutes, or contact your account manager." },
  payment_unavailable: { tone: "error", text: "That way of paying is not available right now. Please use the bank details or contact your account manager." },
  accepted: { tone: "success", text: "Thank you. Your booking is confirmed and we will be in touch about your artwork." },
  rejected: { tone: "success", text: "We have recorded that you are declining this proposal." },
  change_requested: { tone: "success", text: "We have passed on your request for changes." },
  proof_approved: { tone: "success", text: "Thank you. Your proof is approved." },
  proof_changes: { tone: "success", text: "We have passed on your requested changes." },
  not_found: { tone: "error", text: "We could not find that item on your account." },
  not_possible: { tone: "error", text: "That can no longer be done, for example it has already been answered or has expired. Contact your account manager if you need help." }
};

const money = (minor: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
const figure = (value: number) => new Intl.NumberFormat("en-GB").format(value);

/** The to-do list from the domain carries ISO dates ("Needed by 2026-03-01"); show them as words. */
/** Colour artwork by what the advertiser needs to do: green when done, red when it needs re-sending, amber while it waits. */
function artworkTone(status: string): Tone {
  if (status === "approved" || status === "production_ready") return "success";
  if (status === "changes_requested" || status === "rejected") return "danger";
  return "warning";
}

export default async function PortalPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const result = await load(request);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const { view, paymentOptions } = result;
  const paymentReturn = (Array.isArray(params.payment) ? params.payment[0] : params.payment) as string | undefined;
  const resultParam = Array.isArray(params.result) ? params.result[0] : params.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  const queryString = query.toString() ? `?${query.toString()}` : "";
  const currency = view.invoices[0]?.currency ?? view.proposals[0]?.currency ?? "GBP";

  return (
    <AppShell request={request}>
      <PageHeader eyebrow="Your account" title={view.advertisers[0]?.name ?? "Your campaigns"} intro="Your bookings, artwork, proofs and invoices in one place." />
      {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}

      <Panel>
        <Metrics
          items={[
            { label: "Needs your attention", value: view.needsAction.length, tone: view.needsAction.length > 0 ? "warning" : "success" },
            { label: "Active campaigns", value: view.summary.activeCampaigns },
            { label: "Outstanding", value: money(view.summary.outstandingMinor, currency), tone: view.summary.outstandingMinor > 0 ? "warning" : "neutral" },
            { label: "Overdue", value: money(view.summary.overdueMinor, currency), tone: view.summary.overdueMinor > 0 ? "danger" : "success" }
          ]}
        />
      </Panel>

      <Panel eyebrow="To do" title="Needs your attention" id="to-do">
        {view.needsAction.length === 0 ? (
          <EmptyState title="You are all caught up">Anything that needs a reply from you, such as a proposal, artwork or a proof, will appear here.</EmptyState>
        ) : (
          <RecordList>
            {view.needsAction.map((item) => (
              <RecordCard key={`${item.kind}:${item.recordId}`} title={item.title} lines={[item.detail]} />
            ))}
          </RecordList>
        )}
      </Panel>

      {view.proposals.length > 0 ? (
        <Panel eyebrow="Proposals" title="Your proposals" id="proposals">
          <RecordList>
            {view.proposals.map((proposal) => (
              <RecordCard
                key={proposal.id}
                title={proposal.title}
                status={proposal.status}
                lines={[
                  `${money(proposal.totalValueMinor, proposal.currency)}${proposal.validUntil ? ` · valid until ${formatDate(proposal.validUntil)}` : ""}`,
                  ...proposal.items.map((item) => `${item.quantity} × ${item.description} (${money(item.totalPriceMinor, proposal.currency)})`),
                  proposal.awaitingSignature ? "You have accepted. Your booking is confirmed once your signature is complete." : null,
                  !proposal.canRespond && !proposal.awaitingSignature && proposal.response ? `Your response: ${formatLabel(proposal.response)}` : null
                ]}
              >
                {proposal.canRespond ? (
                  <Actions>
                    <form action={respondToProposalAction.bind(null, request, proposal.id, "accepted")}>
                      <button type="submit" className="r2-button r2-button--primary">{advertiserSigningEnabled() ? "Accept and sign" : "Accept and book"}</button>
                    </form>
                    <form action={respondToProposalAction.bind(null, request, proposal.id, "change_requested")}>
                      <button type="submit" className="r2-button r2-button--secondary">Ask for changes</button>
                    </form>
                    <form action={respondToProposalAction.bind(null, request, proposal.id, "rejected")}>
                      <button type="submit" className="r2-button r2-button--secondary">Decline</button>
                    </form>
                  </Actions>
                ) : proposal.awaitingSignature ? (
                  <Actions>
                    <form action={signProposalAction.bind(null, request, proposal.id)}>
                      <button type="submit" className="r2-button r2-button--primary">Continue to sign</button>
                    </form>
                  </Actions>
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        </Panel>
      ) : null}

      <Panel eyebrow="Campaigns" title="Your campaigns" id="campaigns">
        {view.campaigns.length === 0 ? (
          <EmptyState title="No campaigns yet">Once you accept a proposal your booking appears here.</EmptyState>
        ) : (
          <RecordList>
            {view.campaigns.map((campaign) => (
              <RecordCard
                key={campaign.bookingId}
                title={`Booked ${formatDate(campaign.bookedOn)} · ${money(campaign.totalValueMinor, campaign.currency)}`}
                status={campaign.status}
                lines={[
                  ...campaign.items.map((item) => `${item.quantity} × ${item.description}${item.channel ? ` (${formatLabel(item.channel)})` : ""}`),
                  ...campaign.fulfilments.map(
                    (fulfilment) =>
                      `${formatLabel(fulfilment.channel)}: ${formatLabel(fulfilment.status)}${fulfilment.scheduledOn ? ` · scheduled ${formatDate(fulfilment.scheduledOn)}` : ""}${fulfilment.fulfilledOn ? ` · delivered ${formatDate(fulfilment.fulfilledOn)}` : ""}`
                  ),
                  ...campaign.proofPacks.map(
                    (pack) =>
                      `Results (${formatLabel(pack.status)}, ${formatDate(pack.issuedAt)}): ${
                        Object.entries(pack.metrics)
                          .map(([key, value]) => `${formatLabel(key)} ${figure(value)}`)
                          .join(" · ") || "no figures yet"
                      }`
                  )
                ]}
              >
                {campaign.artwork.map((artwork) => (
                  <RecordCard
                    key={artwork.requirementId}
                    title="Your artwork"
                    status={artwork.status}
                    tone={artworkTone(artwork.status)}
                    lines={[
                      artwork.deadline ? `Needed by ${formatDate(artwork.deadline)}` : null,
                      ...artwork.versions.map(
                        (version) => `Version ${version.versionNumber}: ${version.fileName ?? "file"} · ${formatLabel(version.status)}${version.notes ? ` · ${version.notes}` : ""}`
                      )
                    ]}
                  >
                    {artwork.canSubmit ? <ArtworkUploadForm requirementId={artwork.requirementId} queryString={queryString} /> : null}
                    {artwork.awaitingProofApproval ? (
                      <Actions>
                        <form action={respondToProofAction.bind(null, request, artwork.requirementId, "approved")}>
                          <button type="submit" className="r2-button r2-button--primary">Approve proof</button>
                        </form>
                        <form action={respondToProofAction.bind(null, request, artwork.requirementId, "changes_requested")}>
                          <button type="submit" className="r2-button r2-button--secondary">Request changes</button>
                        </form>
                      </Actions>
                    ) : null}
                  </RecordCard>
                ))}
              </RecordCard>
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Invoices" title="Your invoices" intro="Payments are made on your provider's own secure page. Quote the invoice number if you contact us." id="invoices">
        {paymentReturn === "returned" ? (
          <Notice tone="success">Thank you. We will show your payment here as soon as your bank or card provider confirms it, which can take a few minutes.</Notice>
        ) : null}
        {paymentReturn === "cancelled" ? <Notice tone="info">The payment was not completed. You have not been charged.</Notice> : null}
        {view.invoices.length === 0 ? (
          <EmptyState title="No invoices yet">Invoices for your bookings appear here with how to pay them.</EmptyState>
        ) : (
          <Table caption="Your invoices">
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Issued</th>
                <th scope="col">Due</th>
                <th scope="col">Total</th>
                <th scope="col">Paid</th>
                <th scope="col">Balance</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {view.invoices.map((invoice) => {
                const options = paymentOptions[invoice.id];
                return (
                  <tr key={invoice.id}>
                    <th scope="row">
                      {invoice.invoiceNumber}
                      {invoice.payments.map((payment, index) => (
                        <small key={index}>
                          <br />
                          Paid {money(payment.amountMinor, invoice.currency)} on {formatDate(payment.receivedDate)} ({formatLabel(payment.method)})
                        </small>
                      ))}
                    </th>
                    <td>{formatDate(invoice.issueDate)}</td>
                    <td>{formatDate(invoice.dueDate)}</td>
                    <td>{money(invoice.totalMinor, invoice.currency)}</td>
                    <td>{money(invoice.amountPaidMinor, invoice.currency)}</td>
                    <td>{money(invoice.balanceMinor, invoice.currency)}</td>
                    <td>
                      <StatusBadge status={invoice.overdue ? "overdue" : invoice.status} tone={invoice.overdue ? "danger" : invoice.status === "paid" ? "success" : "warning"} />
                      {options && invoice.balanceMinor > 0 ? (
                        <Actions>
                          {options.stripe ? (
                            <form action={payInvoiceAction.bind(null, request, invoice.id, "stripe")}>
                              <button type="submit" className="r2-button r2-button--primary">Pay {money(invoice.balanceMinor, invoice.currency)} by card or bank</button>
                            </form>
                          ) : null}
                          {options.gocardless ? (
                            <form action={payInvoiceAction.bind(null, request, invoice.id, "gocardless")}>
                              <button type="submit" className="r2-button r2-button--secondary">Pay by bank or Direct Debit</button>
                            </form>
                          ) : null}
                          {options.bank ? (
                            <small>
                              Or bank transfer to {options.bank.accountName}, sort code {options.bank.sortCode}, account {options.bank.accountNumber}, reference {invoice.invoiceNumber}.
                            </small>
                          ) : null}
                        </Actions>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      {view.renewals.length > 0 ? (
        <Panel eyebrow="Renewals" title="Coming up for renewal" id="renewals">
          <RecordList>
            {view.renewals.map((renewal) => (
              <RecordCard key={renewal.id} title={renewal.summary ?? "Renewal"} status={renewal.status} lines={[`Due ${formatDate(renewal.dueOn)}. Your account manager will be in touch.`]} />
            ))}
          </RecordList>
        </Panel>
      ) : null}
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "portal.advertiser", action: "view" });
    const context = { userId: shell.userId, organisationId: shell.activeContext.organisationId };
    return { ...(await readPortal(context)), paymentOptions: await readPortalPaymentOptions(context) };
  } catch (error) {
    return { error };
  }
}
