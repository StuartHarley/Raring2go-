import { deterministicAccountingProvider } from "@raring2go/finance";
import type { AccountingProvider } from "@raring2go/finance";

/**
 * The accounting system issued invoices and credit notes are pushed to. Which one is your decision, so the
 * domain only knows the neutral `AccountingProvider` port. Development and tests use the deterministic provider;
 * production fails closed: with nothing configured every push fails visibly and stays queued, so nothing is ever
 * shown as synced that was not.
 */
export class AccountingNotConfiguredError extends Error {
  constructor() {
    super("No accounting provider is configured.");
  }
}

export function accountingProvider(): AccountingProvider {
  if (process.env.NODE_ENV !== "production") return deterministicAccountingProvider;
  return {
    async pushInvoice() {
      throw new AccountingNotConfiguredError();
    },
    async pushCreditNote() {
      throw new AccountingNotConfiguredError();
    }
  };
}
