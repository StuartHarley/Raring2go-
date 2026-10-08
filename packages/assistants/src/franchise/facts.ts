/** Everything the franchise assistant knows about one franchise: plain facts from its records. */
export type FranchiseFacts = {
  franchiseName: string;
  territoryName: string;
  lifecycleStage: string;
  status: string;
  launchDate: string | null;
  renewalDate: string | null;
  onboarding: {
    status: string | null;
    progressPercent: number;
    targetLaunchOn: string | null;
    launchReady: boolean;
    openBlockers: Array<{ title: string; notes: string | null }>;
    /** Tasks not yet done, with the titles of any unfinished tasks they depend on. */
    tasks: Array<{ id: string; title: string; phase: string; ownerType: string; dueOn: string | null; required: boolean; status: string; waitingOn: string[] }>;
  };
  compliance: {
    complete: number;
    total: number;
    missing: string[];
    expiring: Array<{ name: string; expiresOn: string; withinDays: number }>;
    openActions: Array<{ id: string; title: string; severity: string; dueOn: string | null }>;
  };
  insurance: { policies: Array<{ provider: string; endsOn: string; verification: string }> };
  agreement: { status: string | null; version: string | null };
  health: { score: number | null; band: string; configVersion: number; weakest: Array<{ metric: string; label: string; normalised: number; raw: number | null }>; strongest: Array<{ metric: string; label: string; normalised: number }> } | null;
};

export type GuidanceStep = { priority: 1 | 2 | 3 | 4; title: string; reason: string };
export type AttentionItem = { severity: "high" | "medium" | "low"; area: "onboarding" | "compliance" | "insurance" | "agreement"; message: string };

const DAY = 86_400_000;
const startOfDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
/** Days from today until the date (negative if it has passed). */
export const daysUntil = (date: string, now: Date) => Math.round((new Date(`${date}T00:00:00Z`).getTime() - startOfDay(now)) / DAY);

/**
 * What to do next on the way to launch, in order, each with the record behind it. Blockers and overdue work come
 * first, then tasks that are due soon and whose dependencies are met. Tasks still waiting on another task are
 * never suggested: the guide would be telling someone to do something they cannot yet do.
 */
export function onboardingGuidance(facts: FranchiseFacts, now: Date = new Date()): GuidanceStep[] {
  const steps: GuidanceStep[] = [];

  for (const blocker of facts.onboarding.openBlockers) {
    steps.push({ priority: 1, title: `Resolve the blocker: ${blocker.title}`, reason: blocker.notes ? `Raised with the note "${blocker.notes}".` : "It is holding up onboarding." });
  }

  const actionable = facts.onboarding.tasks.filter((task) => task.waitingOn.length === 0 && task.status !== "completed" && task.status !== "blocked");
  for (const task of actionable) {
    if (!task.dueOn) continue;
    const until = daysUntil(task.dueOn, now);
    if (until < 0) steps.push({ priority: 1, title: task.title, reason: `It was due ${-until} day${-until === 1 ? "" : "s"} ago (${task.phase}, owned by ${task.ownerType}).` });
    else if (until <= 14) steps.push({ priority: 2, title: task.title, reason: `Due in ${until} day${until === 1 ? "" : "s"} (${task.phase}, owned by ${task.ownerType}).` });
  }

  const requiredLeft = facts.onboarding.tasks.filter((task) => task.required && task.status !== "completed").length;
  if (!facts.onboarding.launchReady && requiredLeft > 0) {
    const target = facts.onboarding.targetLaunchOn;
    const days = target ? daysUntil(target, now) : null;
    steps.push({ priority: 3, title: `Finish the ${requiredLeft} required task${requiredLeft === 1 ? "" : "s"} before launch`, reason: target ? `Launch is targeted for ${target}${days !== null ? ` (${days >= 0 ? `in ${days} days` : `${-days} days ago`})` : ""} and ${facts.onboarding.progressPercent}% is done.` : `${facts.onboarding.progressPercent}% of onboarding is done and no launch date is set.` });
  }

  const waiting = facts.onboarding.tasks.filter((task) => task.waitingOn.length > 0 && task.required).length;
  if (waiting > 0) steps.push({ priority: 4, title: `${waiting} task${waiting === 1 ? " is" : "s are"} waiting on earlier tasks`, reason: "Completing the tasks above will unblock them." });

  return steps.sort((a, b) => a.priority - b.priority).slice(0, 6);
}

/** What needs attention across compliance, insurance and the agreement, ranked. */
export function attentionItems(facts: FranchiseFacts, now: Date = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const requirement of facts.compliance.missing) items.push({ severity: "high", area: "compliance", message: `${requirement} has not been provided.` });
  for (const expiring of facts.compliance.expiring) {
    items.push({ severity: expiring.withinDays < 0 ? "high" : expiring.withinDays <= 14 ? "high" : "medium", area: "compliance", message: expiring.withinDays < 0 ? `${expiring.name} expired ${-expiring.withinDays} days ago.` : `${expiring.name} expires in ${expiring.withinDays} days (${expiring.expiresOn}).` });
  }
  for (const action of facts.compliance.openActions) {
    const overdue = action.dueOn ? daysUntil(action.dueOn, now) < 0 : false;
    items.push({ severity: action.severity === "high" || overdue ? "high" : "medium", area: "compliance", message: `${action.title}${overdue ? ` (overdue since ${action.dueOn})` : action.dueOn ? ` (due ${action.dueOn})` : ""}.` });
  }

  for (const policy of facts.insurance.policies) {
    const until = daysUntil(policy.endsOn, now);
    if (until < 0) items.push({ severity: "high", area: "insurance", message: `${policy.provider} cover ended ${-until} days ago.` });
    else if (until <= 45) items.push({ severity: until <= 14 ? "high" : "medium", area: "insurance", message: `${policy.provider} cover ends in ${until} days (${policy.endsOn}).` });
    if (policy.verification !== "verified") items.push({ severity: "medium", area: "insurance", message: `${policy.provider} cover has not been verified (${policy.verification}).` });
  }
  if (facts.insurance.policies.length === 0) items.push({ severity: "medium", area: "insurance", message: "No insurance policy is recorded." });

  if (facts.renewalDate) {
    const until = daysUntil(facts.renewalDate, now);
    if (until >= 0 && until <= 120) items.push({ severity: until <= 45 ? "high" : "medium", area: "agreement", message: `The franchise is due for renewal in ${until} days (${facts.renewalDate}).` });
  }
  if (facts.agreement.status && !["executed", "signed", "completed"].includes(facts.agreement.status)) items.push({ severity: "medium", area: "agreement", message: `The agreement is ${facts.agreement.status.replaceAll("_", " ")}, not yet signed.` });

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 12);
}

const HEALTH_ADVICE: Record<string, string> = {
  "commercial.bookings_value_30d": "Bookings are low: review the pipeline and follow up open proposals.",
  "commercial.overdue_share": "A large share of invoices is overdue: chase the oldest first.",
  "audience.subscribers": "The subscriber base is small: promote the newsletter locally.",
  "audience.subscriber_growth_30d": "Subscriber growth has slowed: look at signup prompts and local partnerships.",
  "audience.newsletters_sent_30d": "Few newsletters have gone out: schedule the next issue.",
  "publishing.edition_approval_share": "Few editions are approved: check what is holding approval up.",
  "franchise.overdue_compliance_actions": "Compliance actions are overdue: clear them.",
  "operations.tasks_overdue": "Tasks are overdue: work through the oldest first."
};

export type HealthInsight = { summary: string; weaknesses: Array<{ label: string; score: number; advice: string }>; strengths: Array<{ label: string; score: number }> };

/** The health score's weakest and strongest factors, with a fixed suggestion for each weakness. */
export function healthInsight(health: NonNullable<FranchiseFacts["health"]>): HealthInsight {
  const weaknesses = health.weakest.filter((factor) => factor.normalised < 60).map((factor) => ({ label: factor.label, score: Math.round(factor.normalised), advice: HEALTH_ADVICE[factor.metric] ?? "Review this measure with the franchisee." }));
  const strengths = health.strongest.filter((factor) => factor.normalised >= 70).map((factor) => ({ label: factor.label, score: Math.round(factor.normalised) }));
  const summary =
    health.score == null
      ? "There is not yet enough data to score this franchise."
      : `Franchise health is ${Math.round(health.score)} out of 100 (${health.band}).${weaknesses[0] ? ` The weakest measure is ${weaknesses[0].label.toLowerCase()}.` : ""}`;
  return { summary, weaknesses, strengths };
}
