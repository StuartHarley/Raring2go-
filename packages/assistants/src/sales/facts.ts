import { moneyFromMinor } from "../sanitise";

/** Everything the sales assistant knows about one advertiser: plain facts from CRM records, nothing inferred. */
export type SalesFacts = {
  advertiserName: string;
  relationshipState: string;
  territoryName: string | null;
  firstBookedOn: string | null;
  lastBookedOn: string | null;
  annualValueMinor: number;
  averageSaleValueMinor: number;
  contacts: number;
  lastActivityOn: string | null;
  openOpportunities: Array<{ id: string; title: string; stage: string; valueMinor: number; probability: number; nextAction: string | null; nextActionOn: string | null; expectedCloseOn: string | null }>;
  proposals: Array<{ id: string; title: string; status: string; totalMinor: number; validUntil: string | null; sentOn: string | null }>;
  bookings: Array<{ id: string; status: string; totalMinor: number; bookedOn: string }>;
  finance: { outstandingMinor: number; overdueMinor: number; unallocatedMinor: number };
  openRenewalPrompts: Array<{ id: string; dueOn: string | null }>;
  fulfilments: { upcoming: number; fulfilled: number };
  /** Names of packages this advertiser has bought before. */
  packagesBought: string[];
};

export type CataloguePackage = { key: string; name: string; priceMinor?: number | null };

export type RenewalRisk = { level: "low" | "medium" | "high"; score: number; reasons: string[] };
export type NextAction = { priority: 1 | 2 | 3 | 4; action: string; reason: string };
export type PackageIdea = { key: string; name: string; reason: string };

const DAY = 86_400_000;

const dayDiff = (from: string, now: Date) => Math.floor((startOfDay(now) - new Date(`${from}T00:00:00Z`).getTime()) / DAY);
const startOfDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

/**
 * How likely this advertiser is to lapse, from rules anyone can read. Every point of the score has a stated
 * reason, so the number can always be explained and argued with. A model may describe it but never changes it.
 */
export function assessRenewalRisk(facts: SalesFacts, now: Date = new Date()): RenewalRisk {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    if (reasons.length < 8) reasons.push(reason);
  };

  if (facts.relationshipState === "lapsed") add(40, "They are already marked as lapsed.");
  if (facts.finance.overdueMinor > 0) add(30, `They have ${moneyFromMinor(facts.finance.overdueMinor)} overdue, which can sour a renewal conversation.`);

  if (!facts.lastActivityOn) add(15, "There is no recorded contact with them.");
  else {
    const quiet = dayDiff(facts.lastActivityOn, now);
    if (quiet >= 60) add(20, `No recorded contact for ${quiet} days.`);
    else if (quiet >= 30) add(10, `No recorded contact for ${quiet} days.`);
  }

  const hasLiveWork = facts.openOpportunities.length > 0 || facts.proposals.some((proposal) => proposal.status === "sent" || proposal.status === "accepted");
  if (facts.lastBookedOn) {
    const sinceBooking = dayDiff(facts.lastBookedOn, now);
    if (sinceBooking >= 300 && !hasLiveWork) add(25, `Their last booking was ${sinceBooking} days ago and nothing is in progress for the next one.`);
    if (sinceBooking <= 90) {
      score -= 15;
      reasons.push(`They booked ${sinceBooking} days ago, which is a good sign.`);
    }
  }

  for (const prompt of facts.openRenewalPrompts) {
    if (!prompt.dueOn) continue;
    const until = -dayDiff(prompt.dueOn, now);
    if (until < 0) add(25, `A renewal prompt was due ${-until} days ago and is still open.`);
    else if (until <= 45 && facts.openOpportunities.length === 0) add(20, `A renewal is due in ${until} days with no opportunity open for it.`);
  }

  const expired = facts.proposals.filter((proposal) => proposal.status === "sent" && proposal.validUntil && dayDiff(proposal.validUntil, now) > 0);
  if (expired.length > 0) add(10, `${expired.length} proposal${expired.length === 1 ? " has" : "s have"} expired without an answer.`);

  const nextSteps = facts.openOpportunities.filter((opportunity) => opportunity.nextActionOn && dayDiff(opportunity.nextActionOn, now) <= 0);
  if (facts.openOpportunities.length > 0 && nextSteps.length === facts.openOpportunities.length) {
    score -= 10;
    reasons.push("Every open opportunity has a next step scheduled.");
  }

  score = Math.max(0, Math.min(100, score));
  const level: RenewalRisk["level"] = score >= 55 ? "high" : score >= 25 ? "medium" : "low";
  return { level, score, reasons: reasons.length ? reasons : ["Nothing in their record points to a risk."] };
}

/** The most useful next moves, in order, each with the record that justifies it. */
export function nextBestActions(facts: SalesFacts, now: Date = new Date()): NextAction[] {
  const actions: NextAction[] = [];

  for (const opportunity of facts.openOpportunities) {
    if (opportunity.nextActionOn && dayDiff(opportunity.nextActionOn, now) > 0) {
      actions.push({ priority: 1, action: `Follow up on "${opportunity.title}"`, reason: `The next step${opportunity.nextAction ? ` ("${opportunity.nextAction}")` : ""} was due ${dayDiff(opportunity.nextActionOn, now)} days ago.` });
    }
  }

  for (const proposal of facts.proposals) {
    if (proposal.status !== "sent" || !proposal.validUntil) continue;
    const left = -dayDiff(proposal.validUntil, now);
    if (left >= 0 && left <= 7) actions.push({ priority: 2, action: `Chase the proposal "${proposal.title}"`, reason: `It is worth ${moneyFromMinor(proposal.totalMinor)} and expires in ${left} day${left === 1 ? "" : "s"}.` });
  }

  if (facts.finance.overdueMinor > 0) {
    actions.push({ priority: 2, action: "Get the overdue invoice resolved before pitching new work", reason: `${moneyFromMinor(facts.finance.overdueMinor)} is overdue.` });
  }

  for (const prompt of facts.openRenewalPrompts) {
    actions.push({ priority: 3, action: "Open the renewal conversation", reason: prompt.dueOn ? `A renewal prompt is open and due ${prompt.dueOn}.` : "A renewal prompt is open." });
  }

  if (facts.lastActivityOn && dayDiff(facts.lastActivityOn, now) >= 30) {
    actions.push({ priority: 4, action: "Reconnect with a quick, useful message", reason: `No recorded contact for ${dayDiff(facts.lastActivityOn, now)} days.` });
  }

  for (const opportunity of facts.openOpportunities) {
    if (!opportunity.nextActionOn) actions.push({ priority: 4, action: `Set a next step on "${opportunity.title}"`, reason: "The opportunity is open but has no scheduled next step." });
  }

  if (facts.openOpportunities.length === 0 && facts.proposals.every((proposal) => proposal.status !== "sent")) {
    actions.push({ priority: 4, action: "Create a new opportunity", reason: "There is nothing in progress with this advertiser." });
  }

  return actions.sort((a, b) => a.priority - b.priority).slice(0, 5);
}

/** Packages they have not bought that fit what they typically spend. */
export function packageIdeas(facts: SalesFacts, catalogue: CataloguePackage[]): PackageIdea[] {
  const bought = new Set(facts.packagesBought.map((name) => name.toLowerCase()));
  const candidates = catalogue.filter((entry) => !bought.has(entry.name.toLowerCase()));
  const average = facts.averageSaleValueMinor;

  if (average > 0) {
    return candidates
      .filter((entry) => entry.priceMinor != null && entry.priceMinor >= average * 0.5 && entry.priceMinor <= average * 1.5)
      .sort((a, b) => Math.abs((a.priceMinor ?? 0) - average) - Math.abs((b.priceMinor ?? 0) - average))
      .slice(0, 3)
      .map((entry) => ({ key: entry.key, name: entry.name, reason: `Priced at ${moneyFromMinor(entry.priceMinor ?? 0)}, close to their usual spend of ${moneyFromMinor(average)}.` }));
  }
  return candidates
    .filter((entry) => entry.priceMinor != null)
    .sort((a, b) => (a.priceMinor ?? 0) - (b.priceMinor ?? 0))
    .slice(0, 3)
    .map((entry) => ({ key: entry.key, name: entry.name, reason: `An accessible starting point at ${moneyFromMinor(entry.priceMinor ?? 0)}; they have no booking history to compare against.` }));
}

/** Compact, labelled text for a prompt: only facts, with money formatted so the model never reformats it. */
export function renderFacts(facts: SalesFacts, now: Date = new Date()): string {
  const lines = [
    `Advertiser: ${facts.advertiserName}${facts.territoryName ? ` (${facts.territoryName})` : ""}`,
    `Relationship: ${facts.relationshipState}; ${facts.contacts} contact${facts.contacts === 1 ? "" : "s"}`,
    `First booked: ${facts.firstBookedOn ?? "never"}; last booked: ${facts.lastBookedOn ?? "never"}; average sale ${moneyFromMinor(facts.averageSaleValueMinor)}; annual value ${moneyFromMinor(facts.annualValueMinor)}`,
    `Last recorded contact: ${facts.lastActivityOn ?? "none"}${facts.lastActivityOn ? ` (${dayDiff(facts.lastActivityOn, now)} days ago)` : ""}`,
    `Finance: ${moneyFromMinor(facts.finance.outstandingMinor)} outstanding, ${moneyFromMinor(facts.finance.overdueMinor)} overdue`,
    `Open opportunities: ${facts.openOpportunities.length ? facts.openOpportunities.map((o) => `"${o.title}" (${o.stage}, ${moneyFromMinor(o.valueMinor)}, next step ${o.nextActionOn ?? "not set"})`).join("; ") : "none"}`,
    `Proposals: ${facts.proposals.length ? facts.proposals.map((p) => `"${p.title}" ${p.status} ${moneyFromMinor(p.totalMinor)}${p.validUntil ? ` until ${p.validUntil}` : ""}`).join("; ") : "none"}`,
    `Packages bought before: ${facts.packagesBought.length ? facts.packagesBought.join(", ") : "none recorded"}`
  ];
  return lines.join("\n");
}

/** Every money amount that appears in the facts, as it would be written, so a draft can be checked against it. */
export function allowedAmounts(facts: SalesFacts, extra: number[] = []): Set<string> {
  const amounts = [
    facts.annualValueMinor,
    facts.averageSaleValueMinor,
    facts.finance.outstandingMinor,
    facts.finance.overdueMinor,
    facts.finance.unallocatedMinor,
    ...facts.openOpportunities.map((o) => o.valueMinor),
    ...facts.proposals.map((p) => p.totalMinor),
    ...facts.bookings.map((b) => b.totalMinor),
    ...extra
  ];
  return new Set(amounts.map((minor) => moneyFromMinor(minor)));
}
