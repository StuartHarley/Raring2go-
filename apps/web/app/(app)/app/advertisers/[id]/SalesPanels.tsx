import { randomUUID } from "node:crypto";
import type { Advertiser360, CatalogueView } from "@raring2go/advertising";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import {
  allocatePaymentAction,
  bookProposalAction,
  createInvoiceAction,
  createProposalAction,
  issueInvoiceAction,
  recordPaymentAction,
  sendProposalAction
} from "../actions";

export type SalesAccess = {
  proposalCreate: boolean;
  bookingAccept: boolean;
  invoiceCreate: boolean;
  invoiceIssue: boolean;
  paymentRecord: boolean;
  paymentAllocate: boolean;
};

const money = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);

/**
 * Selling and billing controls for one advertiser. A control is shown only if the user holds the
 * permission, but that is convenience: every action re-checks permission, area and pricing rules.
 */
export function SalesPanels({
  request,
  view,
  catalogue,
  access
}: {
  request: RequestedShellContext;
  view: Advertiser360;
  catalogue?: CatalogueView;
  access: SalesAccess;
}) {
  const advertiserId = view.advertiser.id;
  const listPrice = (productId: string) => catalogue?.priceBookItems.find((item) => item.productId === productId)?.standardPriceMinor;
  const sellable = catalogue?.products.filter((product) => listPrice(product.id) !== undefined) ?? [];
  const openSlots = catalogue?.inventorySlots.filter((slot) => slot.status === "available") ?? [];
  const bookedProposalIds = new Set(view.bookings.map((booking) => booking.proposalId));
  const invoicedBookingIds = new Set(view.invoices.filter((invoice) => invoice.status !== "void").map((invoice) => invoice.bookingId));
  const openInvoices = view.invoices.filter((invoice) => ["issued", "part_paid"].includes(invoice.status) && invoice.balanceMinor > 0);
  const unallocated = view.payments.filter((payment) => payment.unallocatedMinor > 0);
  const paymentToken = randomUUID();

  return (
    <>
      {access.proposalCreate ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Selling</p>
          <h2>New proposal</h2>
          {sellable.length === 0 ? (
            <p>No products have a price for this area yet.</p>
          ) : (
            <form action={createProposalAction.bind(null, request, advertiserId)} className="franchise-form">
              <label>Title<input name="title" required maxLength={160} /></label>
              <label>
                Product
                <select name="productId" required>
                  {sellable.map((product) => (
                    <option key={product.id} value={product.id}>{product.name} - list {money(listPrice(product.id)!)}</option>
                  ))}
                </select>
              </label>
              <label>Quantity<input name="quantity" type="number" min="1" max="100" defaultValue="1" required /></label>
              <label>
                Edition slot (for print products)
                <select name="inventorySlotId" defaultValue="">
                  <option value="">None</option>
                  {openSlots.map((slot) => <option key={slot.id} value={slot.id}>{slot.slotKey}</option>)}
                </select>
              </label>
              <label>
                Price each, if different from list (£)
                <input name="unitPrice" type="number" min="0" step="0.01" placeholder="List price" />
              </label>
              {view.opportunities.length > 0 ? (
                <label>
                  Opportunity
                  <select name="opportunityId" defaultValue="">
                    <option value="">None</option>
                    {view.opportunities.map((item) => <option key={item.opportunity.id} value={item.opportunity.id}>{item.opportunity.title}</option>)}
                  </select>
                </label>
              ) : null}
              <label>Valid until<input name="validUntil" type="date" required /></label>
              <button type="submit">Create draft proposal</button>
              <small>Prices come from the price book. Discounts below the approval line need someone who can manage pricing.</small>
            </form>
          )}
        </section>
      ) : null}

      {view.proposals.length > 0 ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Selling</p>
          <h2>Proposals</h2>
          <div className="franchise-list">
            {view.proposals.map((proposal) => (
              <div key={proposal.id}>
                <strong>{proposal.title}</strong>
                <span>{proposal.status} - {money(proposal.totalValueMinor)} - valid until {proposal.validUntil ?? "not set"}</span>
                {access.proposalCreate && proposal.status === "draft" ? (
                  <form action={sendProposalAction.bind(null, request, advertiserId, proposal.id)}><button type="submit">Send to advertiser</button></form>
                ) : null}
                {access.bookingAccept && proposal.status === "sent" && !bookedProposalIds.has(proposal.id) ? (
                  <form action={bookProposalAction.bind(null, request, advertiserId, proposal.id)}>
                    <button type="submit">Record acceptance and book</button>
                    <small>Use when they agreed by phone or on paper. Reserves the slots and starts artwork.</small>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {access.invoiceCreate && view.bookings.some((booking) => !invoicedBookingIds.has(booking.id)) ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Billing</p>
          <h2>Bookings to invoice</h2>
          <div className="franchise-list">
            {view.bookings.filter((booking) => !invoicedBookingIds.has(booking.id)).map((booking) => (
              <div key={booking.id}>
                <strong>Booked {booking.bookedOn} - {money(booking.totalValueMinor)}</strong>
                <form action={createInvoiceAction.bind(null, request, advertiserId, booking.id)} className="franchise-form">
                  <label>Payment terms (days)<input name="dueInDays" type="number" min="0" max="120" defaultValue="30" /></label>
                  <button type="submit">Create draft invoice</button>
                </form>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {access.invoiceIssue && view.invoices.some((invoice) => invoice.status === "draft") ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Billing</p>
          <h2>Draft invoices</h2>
          <div className="franchise-list">
            {view.invoices.filter((invoice) => invoice.status === "draft").map((invoice) => (
              <div key={invoice.id}>
                <strong>Draft - {money(invoice.totalMinor)} including tax</strong>
                <span>Due {invoice.dueDate ?? "not set"}</span>
                <form action={issueInvoiceAction.bind(null, request, advertiserId, invoice.id)}>
                  <button type="submit">Issue invoice</button>
                  <small>Issuing gives it its number and locks its contents.</small>
                </form>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {access.paymentRecord ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Billing</p>
          <h2>Record a payment</h2>
          <form action={recordPaymentAction.bind(null, request, advertiserId)} className="franchise-form">
            <input type="hidden" name="token" value={paymentToken} />
            <label>Amount received (£)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Date received<input name="receivedDate" type="date" required /></label>
            <label>
              Method
              <select name="method" defaultValue="bank_transfer">
                <option value="bank_transfer">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
                <option value="card_manual">Card (taken manually)</option>
              </select>
            </label>
            <label>Reference<input name="reference" maxLength={120} /></label>
            <button type="submit">Record payment</button>
          </form>
        </section>
      ) : null}

      {access.paymentAllocate && unallocated.length > 0 && openInvoices.length > 0 ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Billing</p>
          <h2>Apply a payment to an invoice</h2>
          <form action={allocatePaymentAction.bind(null, request, advertiserId)} className="franchise-form">
            <label>
              Payment
              <select name="paymentId" required>
                {unallocated.map((payment) => <option key={payment.id} value={payment.id}>{payment.receivedDate} - {money(payment.unallocatedMinor)} unapplied</option>)}
              </select>
            </label>
            <label>
              Invoice
              <select name="invoiceId" required>
                {openInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} - {money(invoice.balanceMinor)} outstanding</option>)}
              </select>
            </label>
            <label>Amount to apply (£)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <button type="submit">Apply payment</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
