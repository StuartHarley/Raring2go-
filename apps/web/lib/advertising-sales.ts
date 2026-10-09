import { randomUUID } from "node:crypto";
import { advertiserInvoiceSequences, advertiserInvoices } from "@raring2go/db";
import {
  acceptProposalAsBooking,
  allocatePayment,
  createInvoiceFromBooking,
  createPricedProposal,
  deriveAdvertiserMetrics,
  issueInvoice,
  recordPayment,
  sendProposal
} from "@raring2go/advertising";
import type { AdvertisingActorContext, AdvertisingData, ProposalLineInput } from "@raring2go/advertising";
import { eq } from "drizzle-orm";
import { mutate } from "./advertising-mutations";

/**
 * Staff selling and billing (ADV-003, 004, 006): price and send proposals, book them, invoice,
 * record and allocate payments. Same shape as the CRM writes: one transaction, domain checks
 * permission and territory, audit rows commit with the change.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Invoices and payments are issued by the franchise that owns the advertiser's territory. */
function issuerFor(data: AdvertisingData, advertiserId: string) {
  const advertiser = data.advertisers.find((candidate) => candidate.id === advertiserId && !candidate.deletedAt);
  if (!advertiser) throw new Error("Advertiser was not found.");
  const territory = data.territories.find((candidate) => candidate.id === advertiser.owningTerritoryId);
  if (!territory?.franchiseOrganisationId) throw new Error("This advertiser's area has no franchise to issue invoices.");
  return { advertiser, issuerOrganisationId: territory.franchiseOrganisationId };
}

export async function createProposalRecord(
  context: AdvertisingActorContext,
  input: { advertiserId: string; opportunityId?: string | null; title: string; validUntil: string; lines: ProposalLineInput[] }
) {
  return mutate((_tx, data, audit, permissions) =>
    createPricedProposal(context, permissions, audit, data, { proposalId: randomUUID(), ...input, newId: randomUUID })
  );
}

export async function sendProposalRecord(context: AdvertisingActorContext, proposalId: string) {
  return mutate((_tx, data, audit, permissions) => sendProposal(context, permissions, audit, data, proposalId));
}

/**
 * Records an acceptance taken outside the portal (a phone call, a signed form) as a booking: reserves
 * the slots and raises the production requests. Booking is idempotent per proposal.
 */
export async function bookProposalRecord(context: AdvertisingActorContext, proposalId: string) {
  return mutate(async (_tx, data, audit, permissions) => {
    const booking = await acceptProposalAsBooking(context, permissions, audit, data, {
      proposalId,
      bookingId: randomUUID(),
      bookingItemIdPrefix: "unused",
      reservationIdPrefix: "unused",
      productionRequestIdPrefix: "unused",
      acceptedOn: todayIso(),
      newId: randomUUID
    });
    // A new booking changes the advertiser's value and state. These are derived, so they are recomputed, not typed.
    const advertiser = data.advertisers.find((candidate) => candidate.id === booking.advertiserId);
    if (advertiser) Object.assign(advertiser, deriveAdvertiserMetrics(data, advertiser.id));
    return booking;
  });
}

export async function createInvoiceRecord(context: AdvertisingActorContext, bookingId: string, input: { dueInDays: number }) {
  if (!Number.isInteger(input.dueInDays) || input.dueInDays < 0 || input.dueInDays > 120) throw new Error("Payment terms must be 0 to 120 days.");

  return mutate((_tx, data, audit, permissions) => {
    const booking = data.bookings.find((candidate) => candidate.id === bookingId && !candidate.deletedAt);
    if (!booking) throw new Error("Booking was not found.");
    if (data.invoices.some((invoice) => invoice.bookingId === bookingId && !invoice.deletedAt && invoice.status !== "void")) {
      throw new Error("This booking already has an invoice.");
    }
    const { advertiser, issuerOrganisationId } = issuerFor(data, booking.advertiserId);
    const organisation = data.organisations.find((candidate) => candidate.id === advertiser.advertiserOrganisationId);
    const primary = data.contacts.find((contact) => contact.advertiserId === advertiser.id && contact.isPrimary && !contact.deletedAt);

    return createInvoiceFromBooking(context, permissions, audit, data, {
      invoiceId: randomUUID(),
      lineIdPrefix: "unused",
      bookingId,
      issuerOrganisationId,
      dueDate: addDays(todayIso(), input.dueInDays),
      billingSnapshot: { name: organisation?.name ?? null, email: primary?.email ?? null },
      paymentTermsSnapshot: { days: input.dueInDays },
      domainEventId: randomUUID(),
      newId: randomUUID
    });
  });
}

/**
 * Issuing takes the next number from the issuer's sequence. The sequence row is locked first, so two
 * people issuing at once get consecutive numbers rather than racing for the same one.
 */
export async function issueInvoiceRecord(context: AdvertisingActorContext, invoiceId: string) {
  return mutate(
    (_tx, data, audit, permissions) => issueInvoice(context, permissions, audit, data, { invoiceId, issuedOn: todayIso(), domainEventId: randomUUID() }),
    async (tx) => {
      const [invoice] = await tx.select({ issuer: advertiserInvoices.issuerOrganisationId }).from(advertiserInvoices).where(eq(advertiserInvoices.id, invoiceId));
      if (!invoice) return;
      await tx.select().from(advertiserInvoiceSequences).where(eq(advertiserInvoiceSequences.issuerOrganisationId, invoice.issuer)).for("update");
    }
  );
}

/**
 * Records money received. The idempotency key comes from the form, so a double click or a retried
 * request records one payment; the database also enforces it with a unique index.
 */
export async function recordPaymentRecord(
  context: AdvertisingActorContext,
  input: { advertiserId: string; amountMinor: number; receivedDate: string; method: string; reference?: string; idempotencyKey: string }
) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter an amount greater than zero.");
  if (input.receivedDate > todayIso()) throw new Error("A payment cannot be received in the future.");
  if (!input.idempotencyKey) throw new Error("Missing form token.");

  return mutate((_tx, data, audit, permissions) => {
    const { advertiser, issuerOrganisationId } = issuerFor(data, input.advertiserId);
    return recordPayment(
      context,
      permissions,
      audit,
      data,
      {
        id: randomUUID(),
        issuerOrganisationId,
        advertiserId: advertiser.id,
        payerOrganisationId: advertiser.advertiserOrganisationId,
        amountMinor: input.amountMinor,
        allocatedMinor: 0,
        unallocatedMinor: input.amountMinor,
        currency: advertiser.currency,
        receivedDate: input.receivedDate,
        method: input.method,
        providerKey: "manual",
        externalReference: input.reference?.trim() || null,
        providerEventId: input.idempotencyKey,
        status: "received",
        metadata: { source: "staff" }
      },
      randomUUID()
    );
  });
}

export async function allocatePaymentRecord(context: AdvertisingActorContext, input: { paymentId: string; invoiceId: string; amountMinor: number }) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter an amount greater than zero.");

  return mutate((_tx, data, audit, permissions) =>
    allocatePayment(
      context,
      permissions,
      audit,
      data,
      { id: randomUUID(), paymentId: input.paymentId, invoiceId: input.invoiceId, amountMinor: input.amountMinor, allocatedAt: todayIso(), status: "applied", metadata: { source: "staff", allocatedByUserId: context.userId } },
      randomUUID(),
      { newId: randomUUID }
    )
  );
}

