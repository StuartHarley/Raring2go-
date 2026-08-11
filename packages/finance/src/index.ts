export type AccountingProviderInvoice = {
  id: string;
  invoiceNumber: string;
  issuerOrganisationId: string;
  customerOrganisationId: string;
  totalMinor: number;
  currency: string;
};

export type AccountingProviderCreditNote = {
  id: string;
  creditNoteNumber: string;
  sourceInvoiceId: string;
  totalMinor: number;
  currency: string;
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
