import { moneyFromMinor } from "../sanitise";

export type DebtInvoice = {
  id: string;
  invoiceNumber: string;
  customerKey: string;
  customerName: string;
  balanceMinor: number;
  dueDate: string | null;
};

/** How a customer has paid in the past: counts of paid invoices settled on time and late. */
export type PaymentHistory = { paidOnTime: number; paidLate: number };

export type DebtBucket = "1-30" | "31-60" | "61-90" | "90+";
export type RankedDebt = {
  invoiceId: string;
  invoiceNumber: string;
  customerKey: string;
  customerName: string;
  balanceMinor: number;
  daysOverdue: number;
  bucket: DebtBucket;
  score: number;
  history: "reliable" | "mixed" | "slow" | "unknown";
  reasons: string[];
};

const DAY = 86_400_000;
const startOfDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

export function bucketFor(daysOverdue: number): DebtBucket {
  return daysOverdue <= 30 ? "1-30" : daysOverdue <= 60 ? "31-60" : daysOverdue <= 90 ? "61-90" : "90+";
}

function describeHistory(history: PaymentHistory | undefined): RankedDebt["history"] {
  if (!history) return "unknown";
  const total = history.paidOnTime + history.paidLate;
  if (total < 2) return "unknown";
  const lateShare = history.paidLate / total;
  return lateShare >= 0.6 ? "slow" : lateShare >= 0.25 ? "mixed" : "reliable";
}

/**
 * Who to chase first. Overdue invoices only, scored from how late, how much, and how the customer has paid
 * before: transparent arithmetic, with the reasons written next to the number. Nothing here sends anything.
 */
export function rankAgedDebt(invoices: DebtInvoice[], history: Record<string, PaymentHistory | undefined>, now: Date = new Date(), limit = 20): RankedDebt[] {
  const today = startOfDay(now);
  const ranked: RankedDebt[] = [];

  for (const invoice of invoices) {
    if (!invoice.dueDate || invoice.balanceMinor <= 0) continue;
    const daysOverdue = Math.floor((today - new Date(`${invoice.dueDate}T00:00:00Z`).getTime()) / DAY);
    if (daysOverdue < 1) continue;

    const customerHistory = describeHistory(history[invoice.customerKey]);
    const lateness = Math.min(60, daysOverdue * 0.6);
    const size = Math.min(30, Math.log10(invoice.balanceMinor / 100 + 1) * 10);
    const habit = customerHistory === "slow" ? 10 : customerHistory === "mixed" ? 5 : 0;

    const reasons = [`${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue.`, `${moneyFromMinor(invoice.balanceMinor)} outstanding.`];
    const past = history[invoice.customerKey];
    if (customerHistory === "slow" && past) reasons.push(`They have paid ${past.paidLate} of their last ${past.paidOnTime + past.paidLate} invoices late.`);
    else if (customerHistory === "reliable") reasons.push("They normally pay on time, so a gentle reminder may be enough.");

    ranked.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerKey: invoice.customerKey,
      customerName: invoice.customerName,
      balanceMinor: invoice.balanceMinor,
      daysOverdue,
      bucket: bucketFor(daysOverdue),
      score: Math.round(lateness + size + habit),
      history: customerHistory,
      reasons
    });
  }

  return ranked.sort((a, b) => b.score - a.score || b.balanceMinor - a.balanceMinor).slice(0, limit);
}

export function agedDebtTotals(ranked: Array<Pick<RankedDebt, "bucket" | "balanceMinor">>): Record<DebtBucket, { count: number; balanceMinor: number }> {
  const totals: Record<DebtBucket, { count: number; balanceMinor: number }> = { "1-30": { count: 0, balanceMinor: 0 }, "31-60": { count: 0, balanceMinor: 0 }, "61-90": { count: 0, balanceMinor: 0 }, "90+": { count: 0, balanceMinor: 0 } };
  for (const item of ranked) {
    totals[item.bucket].count += 1;
    totals[item.bucket].balanceMinor += item.balanceMinor;
  }
  return totals;
}

export type ChaseTone = "friendly" | "firm" | "final";

/** The firmest tone appropriate for how late it is. Wording can be gentler than this, never harsher. */
export function maxToneFor(daysOverdue: number): ChaseTone {
  return daysOverdue <= 30 ? "friendly" : daysOverdue <= 60 ? "firm" : "final";
}
