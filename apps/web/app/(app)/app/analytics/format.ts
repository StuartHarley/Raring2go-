import type { MetricUnit } from "@raring2go/analytics";

export function formatMetric(value: number | null, unit: MetricUnit): string {
  if (value == null) return "No data";
  if (unit === "minor_currency") return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value / 100);
  if (unit === "percent") return `${Math.round(value * 10) / 10}%`;
  return new Intl.NumberFormat("en-GB").format(Math.round(value * 100) / 100);
}

export function formatChange(current: number | null, previous: number | null, unit: MetricUnit): string | undefined {
  if (current == null || previous == null) return undefined;
  const delta = current - previous;
  if (delta === 0) return "No change in 30 days";
  return `${delta > 0 ? "+" : "−"}${formatMetric(Math.abs(delta), unit)} vs 30 days ago`;
}

export const bandLabels = { green: "Healthy", amber: "Watch", red: "At risk", unrated: "Not rated" } as const;

export const benchmarkLabels = {
  top_quarter: "Top quarter of peers",
  above_average: "Better than the median",
  in_line: "In line with peers",
  below_average: "Below the median",
  bottom_quarter: "Bottom quarter of peers"
} as const;
