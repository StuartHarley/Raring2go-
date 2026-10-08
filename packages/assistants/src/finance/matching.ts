import { moneyFromMinor } from "../sanitise";

export type OpenInvoice = { id: string; invoiceNumber: string; customerKey: string; balanceMinor: number; dueDate: string | null };
export type UnallocatedPayment = { id: string; customerKey: string; amountMinor: number; receivedOn: string; reference: string | null };

export type MatchBasis = "reference_and_amount" | "exact_amount" | "reference" | "combination" | "oldest_first_partial";

export type MatchSuggestion = {
  paymentId: string;
  confidence: number;
  basis: MatchBasis;
  allocations: Array<{ invoiceId: string; invoiceNumber: string; amountMinor: number }>;
  reasons: string[];
  leavesUnallocatedMinor: number;
};

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Oldest due first; undated invoices last. */
const byAge = (a: OpenInvoice, b: OpenInvoice) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || a.invoiceNumber.localeCompare(b.invoiceNumber);

/** Subsets of up to three invoices whose balances sum exactly to the amount, oldest-heavy first. */
function exactCombination(invoices: OpenInvoice[], amount: number): OpenInvoice[] | undefined {
  const sorted = [...invoices].sort(byAge).slice(0, 12);
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[i]!.balanceMinor + sorted[j]!.balanceMinor === amount) return [sorted[i]!, sorted[j]!];
      for (let k = j + 1; k < sorted.length; k += 1) {
        if (sorted[i]!.balanceMinor + sorted[j]!.balanceMinor + sorted[k]!.balanceMinor === amount) return [sorted[i]!, sorted[j]!, sorted[k]!];
      }
    }
  }
  return undefined;
}

/**
 * Suggest which invoice(s) each unallocated payment settles. Deterministic rules, strongest evidence first, one
 * suggestion per payment, and an invoice's balance is never promised twice in one run. These are suggestions
 * only: a person with the allocation permission accepts each one, and the normal allocation checks still apply.
 */
export function suggestPaymentMatches(payments: UnallocatedPayment[], invoices: OpenInvoice[]): MatchSuggestion[] {
  const remaining = new Map(invoices.map((invoice) => [invoice.id, invoice.balanceMinor]));
  const suggestions: MatchSuggestion[] = [];

  for (const payment of [...payments].sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.id.localeCompare(b.id))) {
    const open = invoices.filter((invoice) => invoice.customerKey === payment.customerKey && (remaining.get(invoice.id) ?? 0) > 0).sort(byAge);
    if (open.length === 0 || payment.amountMinor <= 0) continue;
    const balance = (invoice: OpenInvoice) => remaining.get(invoice.id) ?? 0;
    const reference = payment.reference ? normalise(payment.reference) : "";

    const referenced = reference ? open.filter((invoice) => reference.includes(normalise(invoice.invoiceNumber))) : [];
    const exact = open.filter((invoice) => balance(invoice) === payment.amountMinor);

    let suggestion: Omit<MatchSuggestion, "paymentId" | "leavesUnallocatedMinor"> | undefined;

    if (referenced.length === 1) {
      const invoice = referenced[0]!;
      const amount = Math.min(balance(invoice), payment.amountMinor);
      const exactToo = balance(invoice) === payment.amountMinor;
      suggestion = {
        confidence: exactToo ? 0.98 : 0.9,
        basis: exactToo ? "reference_and_amount" : "reference",
        allocations: [{ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, amountMinor: amount }],
        reasons: [`The payment reference mentions ${invoice.invoiceNumber}.`, exactToo ? "The amount matches its balance exactly." : `The amount differs from its balance of ${moneyFromMinor(balance(invoice))}.`]
      };
    } else if (exact.length >= 1) {
      const invoice = exact[0]!;
      suggestion = {
        confidence: exact.length === 1 ? 0.95 : 0.8,
        basis: "exact_amount",
        allocations: [{ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, amountMinor: payment.amountMinor }],
        reasons: [`The amount, ${moneyFromMinor(payment.amountMinor)}, matches the balance of ${invoice.invoiceNumber} exactly.`, ...(exact.length > 1 ? [`${exact.length} invoices have that balance; the oldest is suggested.`] : [])]
      };
    } else {
      const combo = exactCombination(open.map((invoice) => ({ ...invoice, balanceMinor: balance(invoice) })), payment.amountMinor);
      if (combo) {
        suggestion = {
          confidence: 0.7,
          basis: "combination",
          allocations: combo.map((invoice) => ({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, amountMinor: invoice.balanceMinor })),
          reasons: [`The amount equals the combined balance of ${combo.map((invoice) => invoice.invoiceNumber).join(", ")}.`]
        };
      } else {
        const oldest = open[0]!;
        const amount = Math.min(balance(oldest), payment.amountMinor);
        suggestion = {
          confidence: 0.4,
          basis: "oldest_first_partial",
          allocations: [{ invoiceId: oldest.id, invoiceNumber: oldest.invoiceNumber, amountMinor: amount }],
          reasons: [`No exact match found, so the oldest open invoice, ${oldest.invoiceNumber}, is suggested as a part-payment.`]
        };
      }
    }

    for (const allocation of suggestion.allocations) remaining.set(allocation.invoiceId, balance({ id: allocation.invoiceId } as OpenInvoice) - allocation.amountMinor);
    const allocated = suggestion.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
    suggestions.push({ paymentId: payment.id, ...suggestion, leavesUnallocatedMinor: payment.amountMinor - allocated });
  }

  return suggestions;
}
