import type { AiUsage } from "./gateway";

// USD cents per million tokens. NOT verified against Anthropic's current published
// pricing: confirm before relying on this for real budget decisions. DEFAULT_PRICING is
// deliberately high so an unrecognised model under-permits spend rather than over-permits it.
const MODEL_PRICING_CENTS_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 100, output: 500 },
  "claude-sonnet-5": { input: 300, output: 1500 },
  "claude-opus-5": { input: 1500, output: 7500 }
};
const DEFAULT_PRICING = { input: 1500, output: 7500 };

/** Pure pricing arithmetic, rounded up to whole cents so cost is never under-reported. */
export function estimateCostMinor(modelReference: string, usage: AiUsage): number {
  const pricing = MODEL_PRICING_CENTS_PER_MILLION_TOKENS[modelReference] ?? DEFAULT_PRICING;
  return Math.ceil((usage.inputTokens * pricing.input + usage.outputTokens * pricing.output) / 1_000_000);
}
