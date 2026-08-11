import {
  advertiserActivityEvents,
  advertiserContacts,
  advertiserDomainEvents,
  advertiserCreditNoteLines,
  advertiserCreditNotes,
  advertiserInvoiceLines,
  advertiserInvoiceSequences,
  advertiserInvoices,
  advertiserMetricSnapshots,
  advertiserPaymentAllocations,
  advertiserPayments,
  advertiserProposalAcceptances,
  advertiserProviderSyncReferences,
  advertiserTerms,
  advertisers,
  artworkRequirements,
  artworkVersions,
  campaignFulfilments,
  commercialBookingItems,
  commercialBookings,
  commercialPackages,
  commercialProducts,
  commercialProductionRequests,
  commercialProposalItems,
  commercialProposals,
  inventoryReservations,
  inventorySlots,
  organisations,
  opportunities,
  pipelineStages,
  proofPacks,
  priceBookItems,
  priceBooks,
  renewalPrompts,
  territories
} from "@raring2go/db";
import type { AdvertisingData } from "./types";

type DrizzleDb = {
  select(): {
    from(table: unknown): Promise<Array<Record<string, unknown>>>;
  };
};

export async function loadAdvertisingData(db: DrizzleDb): Promise<AdvertisingData> {
  const [
    advertiserRows,
    contactRows,
    activityRows,
    metricRows,
    stageRows,
    opportunityRows,
    productRows,
    packageRows,
    priceBookRows,
    priceBookItemRows,
    inventorySlotRows,
    inventoryReservationRows,
    proposalRows,
    proposalItemRows,
    bookingRows,
    bookingItemRows,
    productionRequestRows,
    termsRows,
    acceptanceRows,
    domainEventRows,
    invoiceSequenceRows,
    invoiceRows,
    invoiceLineRows,
    creditNoteRows,
    creditNoteLineRows,
    paymentRows,
    paymentAllocationRows,
    providerSyncRows,
    artworkRequirementRows,
    artworkVersionRows,
    campaignFulfilmentRows,
    proofPackRows,
    renewalPromptRows,
    organisationRows,
    territoryRows
  ] = await Promise.all([
    db.select().from(advertisers),
    db.select().from(advertiserContacts),
    db.select().from(advertiserActivityEvents),
    db.select().from(advertiserMetricSnapshots),
    db.select().from(pipelineStages),
    db.select().from(opportunities),
    db.select().from(commercialProducts),
    db.select().from(commercialPackages),
    db.select().from(priceBooks),
    db.select().from(priceBookItems),
    db.select().from(inventorySlots),
    db.select().from(inventoryReservations),
    db.select().from(commercialProposals),
    db.select().from(commercialProposalItems),
    db.select().from(commercialBookings),
    db.select().from(commercialBookingItems),
    db.select().from(commercialProductionRequests),
    db.select().from(advertiserTerms),
    db.select().from(advertiserProposalAcceptances),
    db.select().from(advertiserDomainEvents),
    db.select().from(advertiserInvoiceSequences),
    db.select().from(advertiserInvoices),
    db.select().from(advertiserInvoiceLines),
    db.select().from(advertiserCreditNotes),
    db.select().from(advertiserCreditNoteLines),
    db.select().from(advertiserPayments),
    db.select().from(advertiserPaymentAllocations),
    db.select().from(advertiserProviderSyncReferences),
    db.select().from(artworkRequirements),
    db.select().from(artworkVersions),
    db.select().from(campaignFulfilments),
    db.select().from(proofPacks),
    db.select().from(renewalPrompts),
    db.select().from(organisations),
    db.select().from(territories)
  ]);

  return {
    advertisers: advertiserRows.map((row) => ({
      ...row,
      firstBookedOn: dateString(row.firstBookedOn),
      lastBookedOn: dateString(row.lastBookedOn),
      lapsedOn: dateString(row.lapsedOn)
    })) as AdvertisingData["advertisers"],
    contacts: contactRows as AdvertisingData["contacts"],
    activityEvents: activityRows as AdvertisingData["activityEvents"],
    metricSnapshots: metricRows as AdvertisingData["metricSnapshots"],
    pipelineStages: stageRows as AdvertisingData["pipelineStages"],
    opportunities: opportunityRows.map((row) => ({
      ...row,
      expectedCloseDate: dateString(row.expectedCloseDate),
      nextActionDate: dateString(row.nextActionDate),
      closedAt: dateString(row.closedAt)
    })) as AdvertisingData["opportunities"],
    products: productRows as AdvertisingData["products"],
    packages: packageRows as AdvertisingData["packages"],
    priceBooks: priceBookRows.map((row) => ({
      ...row,
      effectiveFrom: dateString(row.effectiveFrom),
      effectiveTo: dateString(row.effectiveTo)
    })) as AdvertisingData["priceBooks"],
    priceBookItems: priceBookItemRows as AdvertisingData["priceBookItems"],
    inventorySlots: inventorySlotRows as AdvertisingData["inventorySlots"],
    inventoryReservations: inventoryReservationRows.map((row) => ({
      ...row,
      expiresOn: dateString(row.expiresOn)
    })) as AdvertisingData["inventoryReservations"],
    proposals: proposalRows.map((row) => ({
      ...row,
      validUntil: dateString(row.validUntil),
      sentOn: dateString(row.sentOn),
      acceptedOn: dateString(row.acceptedOn)
    })) as AdvertisingData["proposals"],
    proposalItems: proposalItemRows as AdvertisingData["proposalItems"],
    bookings: bookingRows.map((row) => ({
      ...row,
      bookedOn: dateString(row.bookedOn)
    })) as AdvertisingData["bookings"],
    bookingItems: bookingItemRows as AdvertisingData["bookingItems"],
    productionRequests: productionRequestRows.map((row) => ({
      ...row,
      dueOn: dateString(row.dueOn)
    })) as AdvertisingData["productionRequests"],
    terms: termsRows.map((row) => ({
      ...row,
      approvedAt: dateString(row.approvedAt)
    })) as AdvertisingData["terms"],
    acceptances: acceptanceRows.map((row) => ({
      ...row,
      acceptedAt: dateString(row.acceptedAt),
      rejectedAt: dateString(row.rejectedAt)
    })) as AdvertisingData["acceptances"],
    domainEvents: domainEventRows.map((row) => ({
      ...row,
      processedAt: dateString(row.processedAt)
    })) as AdvertisingData["domainEvents"],
    invoiceSequences: invoiceSequenceRows as AdvertisingData["invoiceSequences"],
    invoices: invoiceRows.map((row) => ({
      ...row,
      issueDate: dateString(row.issueDate),
      dueDate: dateString(row.dueDate),
      voidedAt: dateString(row.voidedAt)
    })) as AdvertisingData["invoices"],
    invoiceLines: invoiceLineRows as AdvertisingData["invoiceLines"],
    creditNotes: creditNoteRows.map((row) => ({
      ...row,
      issuedDate: dateString(row.issuedDate)
    })) as AdvertisingData["creditNotes"],
    creditNoteLines: creditNoteLineRows as AdvertisingData["creditNoteLines"],
    payments: paymentRows.map((row) => ({
      ...row,
      receivedDate: dateString(row.receivedDate)
    })) as AdvertisingData["payments"],
    paymentAllocations: paymentAllocationRows.map((row) => ({
      ...row,
      allocatedAt: dateString(row.allocatedAt)
    })) as AdvertisingData["paymentAllocations"],
    providerSyncReferences: providerSyncRows.map((row) => ({
      ...row,
      lastSyncedAt: dateString(row.lastSyncedAt)
    })) as AdvertisingData["providerSyncReferences"],
    artworkRequirements: artworkRequirementRows.map((row) => ({
      ...row,
      deadline: dateString(row.deadline),
      advertiserApprovedAt: dateString(row.advertiserApprovedAt),
      productionApprovedAt: dateString(row.productionApprovedAt)
    })) as AdvertisingData["artworkRequirements"],
    artworkVersions: artworkVersionRows.map((row) => ({
      ...row,
      submittedAt: dateString(row.submittedAt)
    })) as AdvertisingData["artworkVersions"],
    campaignFulfilments: campaignFulfilmentRows.map((row) => ({
      ...row,
      scheduledOn: dateString(row.scheduledOn),
      fulfilledOn: dateString(row.fulfilledOn)
    })) as AdvertisingData["campaignFulfilments"],
    proofPacks: proofPackRows.map((row) => ({
      ...row,
      issuedAt: dateString(row.issuedAt),
      deliveredAt: dateString(row.deliveredAt)
    })) as AdvertisingData["proofPacks"],
    renewalPrompts: renewalPromptRows.map((row) => ({
      ...row,
      dueOn: dateString(row.dueOn)
    })) as AdvertisingData["renewalPrompts"],
    organisations: organisationRows as AdvertisingData["organisations"],
    territories: territoryRows as AdvertisingData["territories"]
  };
}

function dateString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return (value ?? null) as string | null;
}
