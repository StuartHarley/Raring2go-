import { PortalAccessError } from "@raring2go/advertising";
import { requireShellPermission } from "../../../../lib/app-shell";
import { readPortal } from "../../../../lib/portal-runtime";
import { readPortalPaymentOptions } from "../../../../lib/payments-runtime";
import { StatusBadge } from "../../../../lib/workflow-ui";
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
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB") : "-");

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
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Your account</p>
        <h2>{view.advertisers[0]?.name ?? "Your campaigns"}</h2>
        <p>Your campaigns, artwork, proofs and invoices in one place.</p>
        <div className="franchise-metrics">
          <article>
            <span>Needs your attention</span>
            <strong>{view.needsAction.length}</strong>
          </article>
          <article>
            <span>Active campaigns</span>
            <strong>{view.summary.activeCampaigns}</strong>
          </article>
          <article>
            <span>Outstanding</span>
            <strong>{money(view.summary.outstandingMinor, currency)}</strong>
          </article>
          <article>
            <span>Overdue</span>
            <strong>{money(view.summary.overdueMinor, currency)}</strong>
          </article>
        </div>
        {banner ? <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>{banner.text}</p> : null}
      </section>

      <section className="app-panel franchise-panel" aria-label="Needs your attention">
        <p className="eyebrow">To do</p>
        <h2>Needs your attention</h2>
        <div className="franchise-list">
          {view.needsAction.length === 0 ? (
            <div>
              <strong>You are all caught up.</strong>
            </div>
          ) : (
            view.needsAction.map((item) => (
              <div key={`${item.kind}:${item.recordId}`}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {view.proposals.length > 0 ? (
        <section className="app-panel franchise-panel" aria-label="Proposals">
          <p className="eyebrow">Proposals</p>
          <h2>Your proposals</h2>
          <div className="franchise-list">
            {view.proposals.map((proposal) => (
              <div key={proposal.id}>
                <strong>{proposal.title}</strong>
                <span>
                  {money(proposal.totalValueMinor, proposal.currency)} · {proposal.status.replace("_", " ")}
                  {proposal.validUntil ? ` · valid until ${day(proposal.validUntil)}` : ""}
                </span>
                {proposal.items.map((item, index) => (
                  <span key={index}>{item.quantity} × {item.description} ({money(item.totalPriceMinor, proposal.currency)})</span>
                ))}
                {proposal.canRespond ? (
                  <div className="franchise-actions">
                    <form action={respondToProposalAction.bind(null, request, proposal.id, "accepted")}><button type="submit">{advertiserSigningEnabled() ? "Accept and sign" : "Accept and book"}</button></form>
                    <form action={respondToProposalAction.bind(null, request, proposal.id, "change_requested")}><button type="submit">Ask for changes</button></form>
                    <form action={respondToProposalAction.bind(null, request, proposal.id, "rejected")}><button type="submit">Decline</button></form>
                  </div>
                ) : proposal.awaitingSignature ? (
                  <div className="franchise-actions">
                    <span>You have accepted. Your booking is confirmed once your signature is complete.</span>
                    <form action={signProposalAction.bind(null, request, proposal.id)}><button type="submit">Continue to sign</button></form>
                  </div>
                ) : proposal.response ? (
                  <span>Your response: {proposal.response.replace("_", " ")}</span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="app-panel franchise-panel" aria-label="Campaigns">
        <p className="eyebrow">Campaigns</p>
        <h2>Your campaigns</h2>
        <div className="franchise-list">
          {view.campaigns.length === 0 ? (
            <div>
              <strong>No campaigns yet.</strong>
              <span>Once you accept a proposal your booking appears here.</span>
            </div>
          ) : (
            view.campaigns.map((campaign) => (
              <div key={campaign.bookingId}>
                <strong>Booked {day(campaign.bookedOn)} · {money(campaign.totalValueMinor, campaign.currency)}</strong>
                {campaign.items.map((item) => (
                  <span key={item.id}>{item.quantity} × {item.description}{item.channel ? ` (${item.channel})` : ""}</span>
                ))}
                {campaign.fulfilments.map((fulfilment) => (
                  <span key={fulfilment.id}>
                    {fulfilment.channel}: {fulfilment.status.replace("_", " ")}{fulfilment.scheduledOn ? ` · scheduled ${day(fulfilment.scheduledOn)}` : ""}{fulfilment.fulfilledOn ? ` · delivered ${day(fulfilment.fulfilledOn)}` : ""}
                  </span>
                ))}
                {campaign.artwork.map((artwork) => (
                  <div key={artwork.requirementId} aria-label="Artwork">
                    <strong>Artwork</strong> <StatusBadge status={artwork.status === "approved" || artwork.status === "production_ready" ? "completed" : artwork.status === "changes_requested" || artwork.status === "rejected" ? "failed" : "paused"} />
                    <span>{artwork.status.replace("_", " ")}{artwork.deadline ? ` · needed by ${day(artwork.deadline)}` : ""}</span>
                    {artwork.versions.map((version) => (
                      <span key={version.id}>v{version.versionNumber}: {version.fileName ?? "file"} · {version.status.replace("_", " ")}{version.notes ? ` · ${version.notes}` : ""}</span>
                    ))}
                    {artwork.canSubmit ? <ArtworkUploadForm requirementId={artwork.requirementId} queryString={queryString} /> : null}
                    {artwork.awaitingProofApproval ? (
                      <div className="franchise-actions">
                        <form action={respondToProofAction.bind(null, request, artwork.requirementId, "approved")}><button type="submit">Approve proof</button></form>
                        <form action={respondToProofAction.bind(null, request, artwork.requirementId, "changes_requested")}><button type="submit">Request changes</button></form>
                      </div>
                    ) : null}
                  </div>
                ))}
                {campaign.proofPacks.map((pack) => (
                  <span key={pack.id}>
                    Results ({pack.status}, {day(pack.issuedAt)}): {Object.entries(pack.metrics).map(([key, value]) => `${key} ${value.toLocaleString("en-GB")}`).join(" · ") || "no figures yet"}
                  </span>
                ))}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="app-panel audit-table" aria-label="Invoices">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {view.invoices.length === 0 ? (
                <tr>
                  <td colSpan={7}>No invoices yet.</td>
                </tr>
              ) : (
                view.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      {invoice.invoiceNumber}
                      {invoice.payments.map((payment, index) => (
                        <small key={index}><br />Paid {money(payment.amountMinor, invoice.currency)} on {day(payment.receivedDate)} ({payment.method.replace("_", " ")})</small>
                      ))}
                    </td>
                    <td>{day(invoice.issueDate)}</td>
                    <td>{day(invoice.dueDate)}</td>
                    <td>{money(invoice.totalMinor, invoice.currency)}</td>
                    <td>{money(invoice.amountPaidMinor, invoice.currency)}</td>
                    <td>{money(invoice.balanceMinor, invoice.currency)}</td>
                    <td>
                      <StatusBadge status={invoice.status === "paid" ? "completed" : invoice.overdue ? "failed" : "paused"} /> {invoice.overdue ? "Overdue" : invoice.status.replace("_", " ")}
                      {paymentOptions[invoice.id] && invoice.balanceMinor > 0 ? (
                        <div>
                          {paymentOptions[invoice.id]!.stripe ? <form action={payInvoiceAction.bind(null, request, invoice.id, "stripe")}><button type="submit">Pay {money(invoice.balanceMinor, invoice.currency)} by card or bank</button></form> : null}
                          {paymentOptions[invoice.id]!.gocardless ? <form action={payInvoiceAction.bind(null, request, invoice.id, "gocardless")}><button type="submit">Pay by bank or Direct Debit</button></form> : null}
                          {paymentOptions[invoice.id]!.bank ? <small>Or bank transfer to {paymentOptions[invoice.id]!.bank!.accountName}, sort code {paymentOptions[invoice.id]!.bank!.sortCode}, account {paymentOptions[invoice.id]!.bank!.accountNumber}, reference {invoice.invoiceNumber}.</small> : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {paymentReturn === "returned" ? <p role="status" className="app-banner">Thank you. We will show your payment here as soon as your bank or card provider confirms it, which can take a few minutes.</p> : null}
        {paymentReturn === "cancelled" ? <p role="status" className="app-banner">The payment was not completed. You have not been charged.</p> : null}
        <p className="journey-builder-step-note">Payments are made on your provider&apos;s own secure page. Quote the invoice number if you contact us.</p>
      </section>

      {view.renewals.length > 0 ? (
        <section className="app-panel franchise-panel" aria-label="Renewals">
          <p className="eyebrow">Renewals</p>
          <h2>Coming up for renewal</h2>
          <div className="franchise-list">
            {view.renewals.map((renewal) => (
              <div key={renewal.id}>
                <strong>{renewal.summary ?? "Renewal"}</strong>
                <span>Due {day(renewal.dueOn)}. Your account manager will be in touch.</span>
              </div>
            ))}
          </div>
        </section>
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
