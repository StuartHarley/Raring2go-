import { randomUUID } from "node:crypto";
import type { Advertiser360, CatalogueView } from "@raring2go/advertising";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { formatDate } from "../../../../../lib/format";
import { EmptyState, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
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
        <Panel eyebrow="Selling" title="New proposal">
          {sellable.length === 0 ? (
            <EmptyState title="Nothing to sell here yet">No products have a price for this area. Prices are set in the catalogue.</EmptyState>
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
              <button type="submit" className="r2-button r2-button--primary">Create draft proposal</button>
              <small>Prices come from the price book. Discounts below the approval line need someone who can manage pricing.</small>
            </form>
          )}
        </Panel>
      ) : null}

      {view.proposals.length > 0 ? (
        <Panel eyebrow="Selling" title="Proposals">
          <RecordList>
            {view.proposals.map((proposal) => (
              <RecordCard
                key={proposal.id}
                title={proposal.title}
                status={proposal.status}
                lines={[`${money(proposal.totalValueMinor)} · Valid until ${formatDate(proposal.validUntil, "not set")}`]}
              >
                {access.proposalCreate && proposal.status === "draft" ? (
                  <form action={sendProposalAction.bind(null, request, advertiserId, proposal.id)}>
                    <button type="submit" className="r2-button r2-button--secondary">Send to advertiser</button>
                  </form>
                ) : null}
                {access.bookingAccept && proposal.status === "sent" && !bookedProposalIds.has(proposal.id) ? (
                  <form action={bookProposalAction.bind(null, request, advertiserId, proposal.id)}>
                    <button type="submit" className="r2-button r2-button--secondary">Record acceptance and book</button>
                    <small>Use when they agreed by phone or on paper. Reserves the slots and starts artwork.</small>
                  </form>
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        </Panel>
      ) : null}

      {access.invoiceCreate && view.bookings.some((booking) => !invoicedBookingIds.has(booking.id)) ? (
        <Panel eyebrow="Billing" title="Bookings to invoice">
          <RecordList>
            {view.bookings.filter((booking) => !invoicedBookingIds.has(booking.id)).map((booking) => (
              <RecordCard key={booking.id} title={`Booked ${formatDate(booking.bookedOn)}`} lines={[money(booking.totalValueMinor)]}>
                <form action={createInvoiceAction.bind(null, request, advertiserId, booking.id)} className="franchise-form">
                  <label>Payment terms (days)<input name="dueInDays" type="number" min="0" max="120" defaultValue="30" /></label>
                  <button type="submit" className="r2-button r2-button--secondary">Create draft invoice</button>
                </form>
              </RecordCard>
            ))}
          </RecordList>
        </Panel>
      ) : null}

      {access.invoiceIssue && view.invoices.some((invoice) => invoice.status === "draft") ? (
        <Panel eyebrow="Billing" title="Draft invoices">
          <RecordList>
            {view.invoices.filter((invoice) => invoice.status === "draft").map((invoice) => (
              <RecordCard key={invoice.id} title={`${money(invoice.totalMinor)} including tax`} status={invoice.status} lines={[`Due ${formatDate(invoice.dueDate, "not set")}`]}>
                <form action={issueInvoiceAction.bind(null, request, advertiserId, invoice.id)}>
                  <button type="submit" className="r2-button r2-button--secondary">Issue invoice</button>
                  <small>Issuing gives it its number and locks its contents.</small>
                </form>
              </RecordCard>
            ))}
          </RecordList>
        </Panel>
      ) : null}

      {access.paymentRecord ? (
        <Panel eyebrow="Billing" title="Record a payment">
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
            <button type="submit" className="r2-button r2-button--primary">Record payment</button>
          </form>
        </Panel>
      ) : null}

      {access.paymentAllocate && unallocated.length > 0 && openInvoices.length > 0 ? (
        <Panel eyebrow="Billing" title="Apply a payment to an invoice">
          <form action={allocatePaymentAction.bind(null, request, advertiserId)} className="franchise-form">
            <label>
              Payment
              <select name="paymentId" required>
                {unallocated.map((payment) => <option key={payment.id} value={payment.id}>{formatDate(payment.receivedDate)} - {money(payment.unallocatedMinor)} unapplied</option>)}
              </select>
            </label>
            <label>
              Invoice
              <select name="invoiceId" required>
                {openInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} - {money(invoice.balanceMinor)} outstanding</option>)}
              </select>
            </label>
            <label>Amount to apply (£)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <button type="submit" className="r2-button r2-button--primary">Apply payment</button>
          </form>
        </Panel>
      ) : null}
    </>
  );
}
