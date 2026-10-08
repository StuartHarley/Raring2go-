import { metricByKey } from "./catalogue";
import type { MetricValues } from "./catalogue";

/** Below this many OTHER territories, a peer comparison could identify an individual, so it is withheld. */
export const MIN_PEER_COHORT = 5;

export type BenchmarkBand = "top_quarter" | "above_average" | "below_average" | "bottom_quarter" | "in_line";

export type Benchmark =
  | { metric: string; suppressed: true; reason: "not_enough_peers" | "no_own_data" | "not_comparable"; peerCount: number }
  | { metric: string; suppressed: false; own: number; peerCount: number; median: number; lowerQuartile: number; upperQuartile: number; band: BenchmarkBand };

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Where one territory sits against its peers on one metric. Only aggregates are returned
 * (median and quartiles) and never any individual peer's value or identity; with fewer than
 * MIN_PEER_COHORT peers nothing is returned at all. The band takes direction into account,
 * so "top quarter" always means best, whether higher or lower is better.
 */
export function benchmarkMetric(all: Record<string, MetricValues>, territoryId: string, metric: string): Benchmark {
  const definition = metricByKey.get(metric);
  if (!definition || definition.direction === "neutral") return { metric, suppressed: true, reason: "not_comparable", peerCount: 0 };

  const own = all[territoryId]?.[metric] ?? null;
  const peers = Object.entries(all)
    .filter(([id]) => id !== territoryId)
    .map(([, values]) => values[metric])
    .filter((value): value is number => value != null);

  if (own == null) return { metric, suppressed: true, reason: "no_own_data", peerCount: peers.length };
  if (peers.length < MIN_PEER_COHORT) return { metric, suppressed: true, reason: "not_enough_peers", peerCount: peers.length };

  const sorted = [...peers].sort((a, b) => a - b);
  const lowerQuartile = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const upperQuartile = quantile(sorted, 0.75);
  // Orient so that "higher" is always better.
  const better = definition.direction === "higher" ? own : -own;
  const low = definition.direction === "higher" ? lowerQuartile : -upperQuartile;
  const mid = definition.direction === "higher" ? median : -median;
  const high = definition.direction === "higher" ? upperQuartile : -lowerQuartile;
  const band: BenchmarkBand = high === low ? "in_line" : better >= high ? "top_quarter" : better > mid ? "above_average" : better <= low ? "bottom_quarter" : better < mid ? "below_average" : "in_line";

  return { metric, suppressed: false, own, peerCount: peers.length, median: round(median), lowerQuartile: round(lowerQuartile), upperQuartile: round(upperQuartile), band };
}
