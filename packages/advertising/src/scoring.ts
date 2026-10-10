import type { AdvertiserActivityEvent, AdvertiserTask, Opportunity, OpportunityScore, PipelineStage, ScoreFactor } from "./types";

/**
 * Opportunity scoring: a 0 to 100 number built from a handful of plain signals, every one explained. It is computed
 * when read, never stored, so it always reflects today. The definition is versioned (docs/ADVERTISER_CRM.md); change
 * the weights and the version together.
 *
 * Open opportunities only: a won or lost one has no score.
 */
export const SCORING_VERSION = "2026.10.1";

export type ScoreSignals = {
  /** When the advertiser last had any recorded activity (call, note, proposal, booking). */
  lastActivityAt: Date | null;
  /** A proposal has been sent to this advertiser and not yet closed out. */
  openProposal: boolean;
  /** The advertiser has booked before. */
  previousBookings: number;
  /** Open tasks on this advertiser that are past due. */
  overdueTasks: number;
};

const DAY_MS = 86_400_000;

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

function dayOf(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

export function scoreOpportunity(opportunity: Opportunity, stage: PipelineStage, signals: ScoreSignals, now: Date = new Date()): OpportunityScore | null {
  if (stage.isClosed) return null;
  const factors: ScoreFactor[] = [];
  const add = (key: string, label: string, points: number, detail: string) => factors.push({ key, label, points, detail });

  // How far along: the stage's own probability, up to 35 points.
  const progress = Math.round(Math.max(0, Math.min(100, opportunity.probability)) * 0.35);
  add("stage", "Stage", progress, `${stage.name}, ${opportunity.probability}% likely`);

  // Size of the deal, up to 15 points.
  const pounds = opportunity.estimatedValueMinor / 100;
  const valuePoints = pounds >= 5000 ? 15 : pounds >= 2000 ? 10 : pounds >= 500 ? 5 : 0;
  add("value", "Value", valuePoints, `About £${Math.round(pounds).toLocaleString("en-GB")}`);

  // How recently anyone spoke to them, from -15 to +15.
  if (!signals.lastActivityAt) {
    add("recency", "Recent contact", -15, "No contact recorded");
  } else {
    const days = daysBetween(now, signals.lastActivityAt);
    const points = days <= 7 ? 15 : days <= 14 ? 8 : days <= 30 ? 0 : -10;
    add("recency", "Recent contact", points, days <= 0 ? "Contact today" : `Last contact ${days} day${days === 1 ? "" : "s"} ago`);
  }

  // Whether the next step is planned and on time, from -10 to +10.
  const nextAction = dayOf(opportunity.nextActionDate);
  if (!nextAction) add("next_action", "Next step", -5, "No next step planned");
  else if (nextAction.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) add("next_action", "Next step", -10, "Next step is overdue");
  else add("next_action", "Next step", 10, `Planned for ${opportunity.nextActionDate}`);

  // Expected close, from -5 to +10.
  const close = dayOf(opportunity.expectedCloseDate);
  if (close) {
    const days = daysBetween(close, now);
    add("close", "Expected close", days < 0 ? -5 : days <= 30 ? 10 : days <= 90 ? 5 : 0, days < 0 ? "Expected close date has passed" : `Expected in ${days} day${days === 1 ? "" : "s"}`);
  }

  // A proposal in front of them, up to 10.
  if (signals.openProposal) add("proposal", "Proposal out", 10, "A proposal has been sent");

  // They have bought before, up to 10.
  if (signals.previousBookings > 0) add("history", "Existing customer", 10, `${signals.previousBookings} previous booking${signals.previousBookings === 1 ? "" : "s"}`);

  // Work owed and late, up to -10.
  if (signals.overdueTasks > 0) add("tasks", "Overdue tasks", -Math.min(10, signals.overdueTasks * 5), `${signals.overdueTasks} overdue task${signals.overdueTasks === 1 ? "" : "s"}`);

  const score = Math.max(0, Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0)));
  return { version: SCORING_VERSION, score, band: score >= 70 ? "hot" : score >= 40 ? "warm" : "cold", factors };
}

/** The signals for one opportunity, taken from the advertiser's records. */
export function signalsFor(
  advertiserId: string,
  data: { activityEvents: AdvertiserActivityEvent[]; proposals: Array<{ advertiserId: string; status: string; deletedAt?: Date | null }>; bookings: Array<{ advertiserId: string; deletedAt?: Date | null }>; tasks: AdvertiserTask[] },
  now: Date = new Date()
): ScoreSignals {
  const dates = data.activityEvents
    .filter((event) => event.advertiserId === advertiserId && !event.deletedAt && event.createdAt)
    .map((event) => new Date(event.createdAt as string | Date).getTime())
    .filter((time) => Number.isFinite(time));
  const today = now.toISOString().slice(0, 10);
  return {
    lastActivityAt: dates.length > 0 ? new Date(Math.max(...dates)) : null,
    openProposal: data.proposals.some((proposal) => proposal.advertiserId === advertiserId && !proposal.deletedAt && proposal.status === "sent"),
    previousBookings: data.bookings.filter((booking) => booking.advertiserId === advertiserId && !booking.deletedAt).length,
    overdueTasks: data.tasks.filter((task) => task.advertiserId === advertiserId && !task.deletedAt && task.status === "open" && task.dueOn && task.dueOn < today).length
  };
}
