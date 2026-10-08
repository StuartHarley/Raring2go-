import { defineAiTask } from "@raring2go/ai";
import { asArray, asRecord, parseJsonObject, plainText } from "../sanitise";
import { diffMergeFields } from "./diff";
import type { ClauseChange } from "./diff";
import { attentionItems, healthInsight, onboardingGuidance } from "./facts";
import type { AttentionItem, FranchiseFacts, GuidanceStep, HealthInsight } from "./facts";

// ---- Franchise briefing ----------------------------------------------------------------------------------

export type FranchiseBriefingInput = { facts: FranchiseFacts; today: string };

export type FranchiseBriefingOutput = {
  summary: string;
  supportNote: string;
  /** Computed from the records, never taken from a model. */
  nextSteps: GuidanceStep[];
  attention: AttentionItem[];
  health: HealthInsight | null;
};

function computeBriefing(input: FranchiseBriefingInput) {
  const now = new Date(`${input.today}T00:00:00Z`);
  return { nextSteps: onboardingGuidance(input.facts, now), attention: attentionItems(input.facts, now), health: input.facts.health ? healthInsight(input.facts.health) : null };
}

function deterministicBriefing(input: FranchiseBriefingInput): FranchiseBriefingOutput {
  const computed = computeBriefing(input);
  const high = computed.attention.filter((item) => item.severity === "high").length;
  const onboarding = input.facts.onboarding.status ? ` Onboarding is ${input.facts.onboarding.progressPercent}% complete.` : "";
  return {
    summary: `${input.facts.franchiseName} (${input.facts.territoryName}) is ${input.facts.lifecycleStage}.${onboarding} ${high} item${high === 1 ? " needs" : "s need"} urgent attention.`.replace("  ", " "),
    supportNote: computed.attention[0] ? `Start with: ${computed.attention[0].message}` : "Nothing needs attention right now.",
    ...computed
  };
}

/** The lists are computed and fixed; the model contributes only the two sentences that introduce them. */
export function mergeFranchiseBriefing(raw: unknown, input: FranchiseBriefingInput): FranchiseBriefingOutput {
  const base = deterministicBriefing(input);
  const record = asRecord(raw, "a franchise briefing");
  return { ...base, summary: plainText(record.summary, 700, "summary") || base.summary, supportNote: plainText(record.supportNote, 400, "support note") || base.supportNote };
}

const factsText = (facts: FranchiseFacts) =>
  [
    `Franchise: ${facts.franchiseName} (${facts.territoryName}); lifecycle ${facts.lifecycleStage}; status ${facts.status}`,
    `Launch date: ${facts.launchDate ?? "not set"}; renewal date: ${facts.renewalDate ?? "not set"}`,
    `Onboarding: ${facts.onboarding.status ?? "none"}, ${facts.onboarding.progressPercent}% complete, launch ready: ${facts.onboarding.launchReady}, target ${facts.onboarding.targetLaunchOn ?? "not set"}`,
    `Compliance: ${facts.compliance.complete} of ${facts.compliance.total} requirements complete`,
    `Agreement: ${facts.agreement.status ?? "none"} ${facts.agreement.version ?? ""}`
  ].join("\n");

export const franchiseBriefingTask = defineAiTask<FranchiseBriefingInput, FranchiseBriefingOutput>({
  key: "franchise.briefing",
  promptVersion: "franchise-briefing.v1",
  purpose: "Brief on a franchise: onboarding guidance, compliance and health",
  risk: "low",
  approval: "none",
  capability: { module: "franchise", action: "ai_assist" },
  maxTokens: 700,
  system:
    "You help Head Office and franchisees at Raring2go!, a UK network of local family magazines, see where a franchise stands. " +
    "You are given its facts, a computed list of next steps, and items needing attention. Write a short, encouraging, factual summary in British English, " +
    "and one sentence saying how Head Office could best support them. Use ONLY the facts given: no invented dates, people, numbers or promises. " +
    "Do not rank or change the lists you are given. " +
    'Respond with ONLY a JSON object of the exact shape {"summary": string, "supportNote": string} (no markdown fences, no preamble). Plain text only.',
  buildUserPrompt: (input) => {
    const computed = computeBriefing(input);
    return (
      `Today: ${input.today}\n${factsText(input.facts)}\n\nNext steps:\n${computed.nextSteps.map((step) => `- ${step.title} (${step.reason})`).join("\n") || "none"}\n\n` +
      `Needs attention:\n${computed.attention.map((item) => `- [${item.severity}] ${item.message}`).join("\n") || "none"}` +
      (computed.health ? `\n\nHealth: ${computed.health.summary}` : "")
    );
  },
  parse: (text, input) => mergeFranchiseBriefing(parseJsonObject(text, "a franchise briefing"), input),
  deterministic: deterministicBriefing,
  summariseInput: (input) => ({ franchise: input.facts.franchiseName, onboardingPercent: input.facts.onboarding.progressPercent, openBlockers: input.facts.onboarding.openBlockers.length }),
  sources: (input) => [{ type: "franchise", label: input.facts.franchiseName }]
});

// ---- Agreement comparison (legal: reviewed by a second person, never a conclusion) --------------------------

export type AgreementComparisonInput = {
  fromLabel: string;
  toLabel: string;
  changes: ClauseChange[];
  truncated: boolean;
  mergeFieldsBefore: string[];
  mergeFieldsAfter: string[];
};

export type AgreementComparisonOutput = {
  summary: string;
  changes: Array<ClauseChange & { whyItMatters: string }>;
  mergeFields: { added: string[]; removed: string[] };
  truncated: boolean;
  notice: string;
};

export const AGREEMENT_NOTICE = "This summarises differences in wording to help a reviewer. It is not legal advice and does not say whether any change is acceptable. The agreement must be reviewed by Head Office legal before it is used.";

function deterministicComparison(input: AgreementComparisonInput): AgreementComparisonOutput {
  const merge = diffMergeFields(input.mergeFieldsBefore, input.mergeFieldsAfter);
  return {
    summary: input.changes.length === 0 && merge.added.length + merge.removed.length === 0 ? `No differences were found between ${input.fromLabel} and ${input.toLabel}.` : `${input.changes.length} difference${input.changes.length === 1 ? "" : "s"} found between ${input.fromLabel} and ${input.toLabel}${input.truncated ? " (the list is truncated)" : ""}.`,
    changes: input.changes.map((change) => ({ ...change, whyItMatters: "A reviewer should read this change in context." })),
    mergeFields: merge,
    truncated: input.truncated,
    notice: AGREEMENT_NOTICE
  };
}

/** The changes, paths and the before/after text always come from the diff; the model only comments on why one might matter. */
export function mergeAgreementComparison(raw: unknown, input: AgreementComparisonInput): AgreementComparisonOutput {
  const base = deterministicComparison(input);
  const record = asRecord(raw, "an agreement comparison");
  const said = new Map<string, Record<string, unknown>>();
  for (const entry of asArray(record.changes, 60)) {
    if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).path === "string") said.set((entry as Record<string, unknown>).path as string, entry as Record<string, unknown>);
  }
  return {
    ...base,
    summary: plainText(record.summary, 700, "summary") || base.summary,
    changes: base.changes.map((change) => ({ ...change, whyItMatters: plainText(said.get(change.path)?.whyItMatters, 300, "comment") || change.whyItMatters }))
  };
}

export const agreementComparisonTask = defineAiTask<AgreementComparisonInput, AgreementComparisonOutput>({
  key: "franchise.agreement_comparison",
  promptVersion: "agreement-comparison.v1",
  purpose: "Summarise the differences between two agreement versions for legal review",
  risk: "high",
  approval: "review",
  capability: { module: "franchise", action: "ai_assist" },
  maxTokens: 1600,
  system:
    "You help a reviewer at Raring2go! compare two versions of a franchise agreement. You are given a list of text differences. " +
    "For each, write one short plain-English comment on what kind of thing it affects (for example money, term, territory, termination, obligations), so the reviewer knows where to look. " +
    "You are NOT a lawyer: never say whether a change is acceptable, favourable, risky, enforceable, compliant or legally effective, and never recommend signing or rejecting. " +
    'Respond with ONLY a JSON object of the exact shape {"summary": string, "changes": [{"path": string, "whyItMatters": string}]} using the path values exactly as given (no markdown fences, no preamble). Plain text only.',
  buildUserPrompt: (input) =>
    `Comparing ${input.fromLabel} with ${input.toLabel}.\nDifferences:\n` +
    input.changes.map((change) => `- path=${change.path} kind=${change.kind}${change.before ? ` before="${change.before.slice(0, 300)}"` : ""}${change.after ? ` after="${change.after.slice(0, 300)}"` : ""}`).join("\n"),
  parse: (text, input) => mergeAgreementComparison(parseJsonObject(text, "an agreement comparison"), input),
  deterministic: deterministicComparison,
  summariseInput: (input) => ({ from: input.fromLabel, to: input.toLabel, differences: input.changes.length, truncated: input.truncated }),
  sources: (input) => [{ type: "agreement_version", label: input.fromLabel }, { type: "agreement_version", label: input.toLabel }]
});
