export type AccountingCustomer = { name: string; email?: string | null };

/** A document line as the books need it: money in minor units, the tax code to translate, never a rate guess. */
export type AccountingLine = { description: string; quantity: number; netMinor: number; taxMinor: number; taxCode: string };

export type AccountingProviderInvoice = {
  id: string;
  invoiceNumber: string;
  issuerOrganisationId: string;
  customerOrganisationId: string;
  totalMinor: number;
  currency: string;
  subtotalMinor?: number;
  taxMinor?: number;
  issueDate?: string;
  dueDate?: string | null;
  /** Stable per document, so a provider that sees the same push twice records it once. */
  idempotencyKey?: string;
  customer?: AccountingCustomer;
  lines?: AccountingLine[];
};

export type AccountingProviderCreditNote = {
  id: string;
  creditNoteNumber: string;
  sourceInvoiceId: string;
  totalMinor: number;
  currency: string;
  issuedDate?: string;
  idempotencyKey?: string;
  customerOrganisationId?: string;
  customer?: AccountingCustomer;
  lines?: AccountingLine[];
  sourceInvoiceNumber?: string;
  /** The accounting system's own id for the invoice being credited, when it has been synced. */
  sourceInvoiceProviderId?: string | null;
};

export type AccountingSyncResult = {
  providerKey: string;
  providerEntityId: string;
  status: "pending" | "synced" | "failed";
  metadata?: Record<string, unknown>;
};

export type AccountingProvider = {
  pushInvoice(invoice: AccountingProviderInvoice): Promise<AccountingSyncResult>;
  pushCreditNote(creditNote: AccountingProviderCreditNote): Promise<AccountingSyncResult>;
};

export type PaymentProviderEvent = {
  providerKey: string;
  providerEventId: string;
  paymentReference: string;
  amountMinor: number;
  currency: string;
  status: string;
  receivedOn?: string;
  metadata?: Record<string, unknown>;
};

export type PaymentProvider = {
  createPaymentRequest(input: {
    invoiceId: string;
    amountMinor: number;
    currency: string;
  }): Promise<{ providerKey: string; providerRequestId: string; metadata?: Record<string, unknown> }>;
  mapPaymentEvent(event: PaymentProviderEvent): Promise<PaymentProviderEvent>;
};

export type BankReconciliationProvider = {
  listUnreconciledTransactions(input: {
    issuerOrganisationId: string;
    since?: string;
  }): Promise<Array<Record<string, unknown>>>;
};

export const deterministicAccountingProvider: AccountingProvider = {
  async pushInvoice(invoice) {
    return {
      providerKey: "deterministic-accounting",
      providerEntityId: `invoice:${invoice.invoiceNumber}`,
      status: "synced"
    };
  },
  async pushCreditNote(creditNote) {
    return {
      providerKey: "deterministic-accounting",
      providerEntityId: `credit:${creditNote.creditNoteNumber}`,
      status: "synced"
    };
  }
};
