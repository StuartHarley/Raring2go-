import { metricByKey } from "./catalogue";
import type { MetricValues } from "./catalogue";

export type HealthFactor = {
  metric: string;
  /** Relative importance. Weights are normalised over the factors that have data. */
  weight: number;
  /** The raw value that scores 0. */
  bad: number;
  /** The raw value that scores 100. May be lower than `bad` for lower-is-better metrics. */
  good: number;
};

export type HealthThresholds = { green: number; amber: number };

export type HealthConfig = { factors: HealthFactor[]; thresholds: HealthThresholds };

export type HealthBand = "green" | "amber" | "red" | "unrated";

export type HealthFactorResult = {
  metric: string;
  label: string;
  raw: number | null;
  /** 0-100, or null when the territory has no data for this factor. */
  normalised: number | null;
  weight: number;
  /** Share of the final score this factor carries, after re-normalising over factors with data. */
  effectiveWeight: number;
  /** Points this factor contributed to the score. */
  contribution: number;
  state: "scored" | "no_data";
};

export type HealthResult = { score: number | null; band: HealthBand; factors: HealthFactorResult[] };

/**
 * Default factors for the first version. These are starting points, not truths: Head Office
 * should tune the weights and the bad/good anchors from what "healthy" means for the network.
 * Weights sum to 100.
 */
export const defaultHealthConfig: HealthConfig = {
  thresholds: { green: 75, amber: 50 },
  factors: [
    { metric: "commercial.bookings_value_30d", weight: 25, bad: 0, good: 500_000 },
    { metric: "commercial.overdue_share", weight: 15, bad: 50, good: 5 },
    { metric: "audience.subscribers", weight: 15, bad: 0, good: 2_000 },
    { metric: "audience.subscriber_growth_30d", weight: 10, bad: -20, good: 100 },
    { metric: "audience.newsletters_sent_30d", weight: 10, bad: 0, good: 4 },
    { metric: "publishing.edition_approval_share", weight: 10, bad: 0, good: 100 },
    { metric: "franchise.overdue_compliance_actions", weight: 10, bad: 5, good: 0 },
    { metric: "operations.tasks_overdue", weight: 5, bad: 10, good: 0 }
  ]
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Linear 0-100 between the `bad` and `good` anchors, in whichever direction they run. */
export function normaliseValue(raw: number, factor: Pick<HealthFactor, "bad" | "good">): number {
  return round2(clamp((raw - factor.bad) / (factor.good - factor.bad), 0, 1) * 100);
}

export function bandFor(score: number | null, thresholds: HealthThresholds): HealthBand {
  if (score == null) return "unrated";
  return score >= thresholds.green ? "green" : score >= thresholds.amber ? "amber" : "red";
}

/**
 * Scores one territory. A factor with no data (e.g. no invoices yet, so no overdue share) is
 * left out and the remaining weights are re-normalised, so a quiet area is not punished for
 * a metric that does not apply to it; if nothing has data the territory is `unrated`. Every
 * factor, including those without data, is returned so the score can be audited line by line.
 */
export function computeHealth(config: HealthConfig, values: MetricValues): HealthResult {
  const scored = config.factors.filter((factor) => values[factor.metric] != null);
  const totalWeight = scored.reduce((total, factor) => total + factor.weight, 0);

  const factors: HealthFactorResult[] = config.factors.map((factor) => {
    const definition = metricByKey.get(factor.metric);
    const raw = values[factor.metric] ?? null;
    if (raw == null || totalWeight <= 0) {
      return { metric: factor.metric, label: definition?.label ?? factor.metric, raw, normalised: null, weight: factor.weight, effectiveWeight: 0, contribution: 0, state: "no_data" };
    }
    const normalised = normaliseValue(raw, factor);
    const effectiveWeight = round2((factor.weight / totalWeight) * 100);
    return { metric: factor.metric, label: definition?.label ?? factor.metric, raw, normalised, weight: factor.weight, effectiveWeight, contribution: round2((normalised * factor.weight) / totalWeight), state: "scored" };
  });

  if (scored.length === 0 || totalWeight <= 0) return { score: null, band: "unrated", factors };
  const score = round2(factors.reduce((total, factor) => total + factor.contribution, 0));
  return { score, band: bandFor(score, config.thresholds), factors };
}

export type HealthConfigValidation = { ok: true; value: HealthConfig } | { ok: false; errors: string[] };

/** Structural validation: reports every problem so the editor can show them all at once. */
export function validateHealthConfig(input: unknown): HealthConfigValidation {
  const errors: string[] = [];
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawFactors = Array.isArray(record.factors) ? record.factors : [];

  if (rawFactors.length === 0) errors.push("Add at least one factor.");
  if (rawFactors.length > 20) errors.push("Use at most 20 factors.");

  const factors: HealthFactor[] = [];
  const seen = new Set<string>();
  rawFactors.forEach((entry, index) => {
    const factor = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const label = `Factor ${index + 1}`;
    const definition = typeof factor.metric === "string" ? metricByKey.get(factor.metric) : undefined;
    if (!definition) return void errors.push(`${label}: unknown metric.`);
    if (definition.direction === "neutral") return void errors.push(`${label}: ${definition.label} is informational and cannot be scored.`);
    if (seen.has(definition.key)) return void errors.push(`${label}: ${definition.label} is used twice.`);
    seen.add(definition.key);
    const { weight, bad, good } = factor as { weight: unknown; bad: unknown; good: unknown };
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0 || weight > 100) return void errors.push(`${label}: weight must be a number above 0 and up to 100.`);
    if (typeof bad !== "number" || typeof good !== "number" || !Number.isFinite(bad) || !Number.isFinite(good)) return void errors.push(`${label}: the "bad" and "good" values must be numbers.`);
    if (bad === good) return void errors.push(`${label}: "bad" and "good" must differ.`);
    if (definition.direction === "higher" && good < bad) errors.push(`${label}: ${definition.label} is higher-is-better, so "good" must be above "bad".`);
    if (definition.direction === "lower" && good > bad) errors.push(`${label}: ${definition.label} is lower-is-better, so "good" must be below "bad".`);
    factors.push({ metric: definition.key, weight, bad, good });
  });

  const total = factors.reduce((sum, factor) => sum + factor.weight, 0);
  if (factors.length > 0 && Math.abs(total - 100) > 0.01) errors.push(`Weights must add up to 100 (they add up to ${round2(total)}).`);

  const thresholds = (record.thresholds && typeof record.thresholds === "object" ? record.thresholds : {}) as Record<string, unknown>;
  const green = thresholds.green;
  const amber = thresholds.amber;
  if (typeof green !== "number" || typeof amber !== "number" || !(amber > 0 && amber < green && green <= 100)) {
    errors.push("Thresholds need 0 < amber < green <= 100.");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { factors, thresholds: { green: green as number, amber: amber as number } } };
}
