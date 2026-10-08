import { defineAiTask } from "@raring2go/ai";
import { asArray, asRecord, moneyFromMinor, parseJsonObject, plainText } from "../sanitise";
import { maxToneFor } from "./aged-debt";
import type { ChaseTone, RankedDebt } from "./aged-debt";
import type { RoyaltyAnomaly } from "./royalty";

// ---- Aged debt: chasing notes ----------------------------------------------------------------------------

export type ChaseNotesInput = { debts: RankedDebt[] };
export type ChaseNotesOutput = {
  summary: string;
  accounts: Array<{ invoiceId: string; customerName: string; daysOverdue: number; suggestedAction: string; tone: ChaseTone }>;
};

const toneRank: Record<ChaseTone, number> = { friendly: 0, firm: 1, final: 2 };

const deterministicTone = (debt: RankedDebt): ChaseTone => maxToneFor(debt.daysOverdue);

function deterministicChase(input: ChaseNotesInput): ChaseNotesOutput {
  const total = input.debts.reduce((sum, debt) => sum + debt.balanceMinor, 0);
  return {
    summary: `${input.debts.length} overdue invoice${input.debts.length === 1 ? "" : "s"} worth ${moneyFromMinor(total)}, ranked by lateness, amount and payment history.`,
    accounts: input.debts.map((debt) => ({
      invoiceId: debt.invoiceId,
      customerName: debt.customerName,
      daysOverdue: debt.daysOverdue,
      tone: deterministicTone(debt),
      suggestedAction:
        debt.daysOverdue <= 30
          ? `Send a friendly reminder for ${debt.invoiceNumber} (${moneyFromMinor(debt.balanceMinor)}).`
          : debt.daysOverdue <= 60
            ? `Call ${debt.customerName} about ${debt.invoiceNumber} and agree a payment date.`
            : `Escalate ${debt.invoiceNumber}: ${debt.daysOverdue} days overdue. Agree a payment plan or follow the credit-control policy.`
    }))
  };
}

/** Wording only: the model may soften the tone for an account, never make it firmer than the lateness allows. */
export function mergeChaseNotes(raw: unknown, input: ChaseNotesInput): ChaseNotesOutput {
  const base = deterministicChase(input);
  const record = asRecord(raw, "chasing notes");
  const said = new Map<string, Record<string, unknown>>();
  for (const entry of asArray(record.accounts, 25)) {
    if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).invoiceId === "string") said.set((entry as Record<string, unknown>).invoiceId as string, entry as Record<string, unknown>);
  }
  return {
    summary: plainText(record.summary, 600, "summary") || base.summary,
    accounts: base.accounts.map((account) => {
      const entry = said.get(account.invoiceId);
      if (!entry) return account;
      const proposed = entry.tone === "friendly" || entry.tone === "firm" || entry.tone === "final" ? (entry.tone as ChaseTone) : account.tone;
      return { ...account, tone: toneRank[proposed] <= toneRank[account.tone] ? proposed : account.tone, suggestedAction: plainText(entry.suggestedAction, 320, "suggested action") || account.suggestedAction };
    })
  };
}

export const chaseNotesTask = defineAiTask<ChaseNotesInput, ChaseNotesOutput>({
  key: "finance.chase_notes",
  promptVersion: "chase-notes.v1",
  purpose: "Suggest how to chase the most overdue invoices",
  risk: "low",
  approval: "none",
  capability: { module: "finance", action: "ai_assist" },
  maxTokens: 1400,
  system:
    "You help the finance team at Raring2go!, a UK network of local family magazines, decide how to chase overdue advertiser invoices. " +
    "You are given a ranked list of overdue invoices with facts. For each, suggest one short, practical next action in British English. " +
    "Be courteous and proportionate: friendly for up to 30 days overdue, firm for 31 to 60, and only final beyond 60. " +
    "Use ONLY the facts given; never invent amounts, dates, conversations or policy. You do not send anything or change any record. " +
    'Respond with ONLY a JSON object of the exact shape {"summary": string, "accounts": [{"invoiceId": string, "suggestedAction": string, "tone": "friendly"|"firm"|"final"}]} ' +
    "using the invoiceId values exactly as given (no markdown fences, no preamble). Plain text only.",
  buildUserPrompt: (input) => "Overdue invoices, most urgent first:\n" + input.debts.map((debt) => `- invoiceId=${debt.invoiceId} number=${debt.invoiceNumber} customer="${debt.customerName.slice(0, 80)}" overdue=${debt.daysOverdue}d outstanding=${moneyFromMinor(debt.balanceMinor)} history=${debt.history} reasons="${debt.reasons.join(" ")}"`).join("\n"),
  parse: (text, input) => mergeChaseNotes(parseJsonObject(text, "chasing notes"), input),
  deterministic: deterministicChase,
  summariseInput: (input) => ({ invoices: input.debts.length, totalOverdueMinor: input.debts.reduce((sum, debt) => sum + debt.balanceMinor, 0) }),
  sources: (input) => input.debts.slice(0, 20).map((debt) => ({ type: "advertiser_invoice", id: debt.invoiceId, label: debt.invoiceNumber }))
});

// ---- Royalty anomaly notes (financial: reviewed by a second person) -------------------------------------

export type RoyaltyNotesInput = { flags: RoyaltyAnomaly[] };
export type RoyaltyNotesOutput = {
  summary: string;
  questions: Array<{ key: string; territoryName: string; severity: RoyaltyAnomaly["severity"]; kind: string; observation: string; question: string }>;
  notice: string;
};

export const ROYALTY_NOTICE = "These are questions to ask, not findings. No statement, adjustment or payment has been changed, and nothing here is a financial decision.";

function deterministicRoyalty(input: RoyaltyNotesInput): RoyaltyNotesOutput {
  const q: Record<string, string> = {
    swing: "Is there a known reason for the change, such as a large one-off booking, a lost advertiser or a timing difference?",
    zero_after_positive: "Was anything invoiced or paid in this period? Could revenue have been missed or recorded in the wrong period?",
    heavy_adjustments: "What are the adjustments for, and do they each have a recorded reason and approval?",
    duplicate_period: "Why are there two statements for the same period, and should one be voided?",
    missing_period: "Is a statement missing for the gap, or was the territory dormant?"
  };
  return {
    summary: input.flags.length === 0 ? "No unusual royalty statements were found." : `${input.flags.length} statement${input.flags.length === 1 ? " looks" : "s look"} unusual compared with the territory's own history.`,
    questions: input.flags.map((flag) => ({ key: flag.key, territoryName: flag.territoryName, severity: flag.severity, kind: flag.kind, observation: flag.detail, question: q[flag.kind] ?? "Can the reason for this be confirmed?" })),
    notice: ROYALTY_NOTICE
  };
}

/** The observation (the figures) always comes from the flag; the model only suggests the question to ask. */
export function mergeRoyaltyNotes(raw: unknown, input: RoyaltyNotesInput): RoyaltyNotesOutput {
  const base = deterministicRoyalty(input);
  const record = asRecord(raw, "royalty notes");
  const said = new Map<string, Record<string, unknown>>();
  for (const entry of asArray(record.questions, 30)) {
    if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).key === "string") said.set((entry as Record<string, unknown>).key as string, entry as Record<string, unknown>);
  }
  return {
    summary: plainText(record.summary, 500, "summary") || base.summary,
    questions: base.questions.map((item) => ({ ...item, question: plainText(said.get(item.key)?.question, 400, "question") || item.question })),
    notice: ROYALTY_NOTICE
  };
}

export const royaltyNotesTask = defineAiTask<RoyaltyNotesInput, RoyaltyNotesOutput>({
  key: "finance.royalty_notes",
  promptVersion: "royalty-notes.v1",
  purpose: "Suggest questions to ask about unusual royalty statements",
  risk: "high",
  approval: "review",
  capability: { module: "finance", action: "ai_assist" },
  maxTokens: 1200,
  system:
    "You help Head Office finance review franchise royalty statements. You are given statistical flags with the figures behind them. " +
    "For each flag, suggest ONE short, neutral question a finance colleague could ask the franchisee or check in the records. British English. " +
    "Do not state or imply that anything is wrong, wrongly calculated, owed or should be adjusted; do not name causes; do not give a financial conclusion. " +
    'Respond with ONLY a JSON object of the exact shape {"summary": string, "questions": [{"key": string, "question": string}]} using the key values exactly as given (no markdown fences, no preamble). Plain text only.',
  buildUserPrompt: (input) => "Flags:\n" + input.flags.map((flag) => `- key=${flag.key} territory="${flag.territoryName}" kind=${flag.kind} severity=${flag.severity} figures="${flag.detail}"`).join("\n"),
  parse: (text, input) => mergeRoyaltyNotes(parseJsonObject(text, "royalty notes"), input),
  deterministic: deterministicRoyalty,
  summariseInput: (input) => ({ flags: input.flags.length, high: input.flags.filter((flag) => flag.severity === "high").length }),
  sources: (input) => input.flags.slice(0, 30).map((flag) => ({ type: "royalty_statement", id: flag.statementId, label: flag.territoryName }))
});
