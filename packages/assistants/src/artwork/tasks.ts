import { AiOutputError, defineAiTask } from "@raring2go/ai";
import { asArray, asRecord, parseJsonObject, plainText } from "../sanitise";
import { analysePreflight } from "./preflight";
import type { PreflightAnalysis, PreflightCheckInput, PreflightItem } from "./preflight";

export type PreflightHelpInput = {
  /** What was checked, for the reader: "Page 4, Sutton Coldfield Autumn edition". */
  label: string;
  checks: PreflightCheckInput[];
};

export type PreflightHelpOutput = {
  summary: string;
  readyForPrint: boolean;
  blockers: number;
  items: PreflightItem[];
};

const READY_CLAIM = /\b(print[- ]?ready|print[- ]?safe|ready (for|to) print|good to go|no (remaining )?issues|all clear|passes preflight)\b/i;

/**
 * Merge a model's wording into the engine's verdicts. The model supplies readable text only: codes, severity,
 * fix verdicts and the print-ready flag always come from the preflight engine and the knowledge base, so a
 * model cannot talk a failing file into "print-safe" or an unfixable image into "auto-fixable".
 */
export function mergePreflightHelp(raw: unknown, input: PreflightHelpInput): PreflightHelpOutput {
  const analysis = analysePreflight(input.checks);
  const record = asRecord(raw, "preflight help");
  const byCode = new Map<string, Record<string, unknown>>();
  for (const entry of asArray(record.items, 40)) {
    if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).code === "string") byCode.set((entry as Record<string, unknown>).code as string, entry as Record<string, unknown>);
  }

  const items = analysis.items.map((item): PreflightItem => {
    const said = byCode.get(item.code);
    if (!said) return item;
    const steps = asArray(said.steps, 6)
      .map((step) => plainText(step, 240, "step"))
      .filter(Boolean);
    return {
      ...item,
      explanation: plainText(said.explanation, 400, "explanation") || item.explanation,
      steps: steps.length ? steps : item.steps
    };
  });

  let summary = plainText(record.summary, 500, "summary");
  // A summary that contradicts the verdict is discarded in favour of the computed one.
  if (!summary || (!analysis.readyForPrint && READY_CLAIM.test(summary))) summary = analysis.summary;

  return { summary, readyForPrint: analysis.readyForPrint, blockers: analysis.blockers, items };
}

const deterministicHelp = (input: PreflightHelpInput): PreflightHelpOutput => {
  const analysis: PreflightAnalysis = analysePreflight(input.checks);
  return { summary: analysis.summary, readyForPrint: analysis.readyForPrint, blockers: analysis.blockers, items: analysis.items };
};

/**
 * Explains preflight failures and suggests safe fixes in plain English for the person preparing the artwork.
 * The facts and verdicts are computed; the model only improves the wording. Informational: nothing is changed
 * by this task, and applying a fix remains a separate, permissioned, audited action on a derived copy.
 */
export const preflightHelpTask = defineAiTask<PreflightHelpInput, PreflightHelpOutput>({
  key: "artwork.preflight_help",
  promptVersion: "preflight-help.v1",
  purpose: "Explain print preflight results in plain English",
  risk: "low",
  approval: "none",
  capability: { module: "artwork", action: "ai_assist" },
  maxTokens: 1200,
  system:
    "You help people at Raring2go!, a UK network of local family magazines, understand why artwork failed print preflight. " +
    "You are given the preflight findings. Explain each in plain, friendly British English for someone who is not a print expert, and give short practical steps. " +
    "Do not change, add or remove findings, and never say a file is print-ready, print-safe or fine when any finding has severity \"error\". " +
    "Never suggest enlarging or re-saving a low-resolution image to fix it: that needs new artwork from the advertiser. " +
    "Respond with ONLY a JSON object of the exact shape " +
    '{"summary": string, "items": [{"code": string, "explanation": string, "steps": [string]}]} ' +
    "using the finding codes exactly as given (no markdown fences, no preamble). Plain text only.",
  buildUserPrompt: (input) => {
    const analysis = analysePreflight(input.checks);
    return (
      `Item checked: ${input.label.slice(0, 200)}\n` +
      `Overall: ${analysis.summary}\n` +
      "Findings:\n" +
      analysis.items.map((item) => `- code=${item.code} severity=${item.severity} fixability=${item.fixability} message="${item.engineMessage.slice(0, 200)}"`).join("\n")
    );
  },
  parse: (text, input) => mergePreflightHelp(parseJsonObject(text, "preflight help"), input),
  deterministic: deterministicHelp,
  summariseInput: (input) => ({ label: input.label.slice(0, 200), checkCodes: input.checks.map((check) => check.code).slice(0, 40), errors: input.checks.filter((check) => check.severity === "error").length }),
  sources: (input) => [{ type: "preflight", label: input.label }]
});

export function requireChecks(input: PreflightHelpInput) {
  if (!Array.isArray(input.checks)) throw new AiOutputError("No preflight findings were provided.");
}
