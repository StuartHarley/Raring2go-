import { moneyFromMinor } from "../sanitise";

export type StatementFacts = {
  id: string;
  territoryId: string;
  territoryName: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  calculatedRoyaltyMinor: number;
  adjustmentsMinor: number;
  grossRevenueMinor: number;
};

export type AnomalyKind = "swing" | "zero_after_positive" | "heavy_adjustments" | "duplicate_period" | "missing_period";

export type RoyaltyAnomaly = {
  key: string;
  territoryId: string;
  territoryName: string;
  statementId: string;
  kind: AnomalyKind;
  severity: "medium" | "high";
  detail: string;
};

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY);

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Flag statements that look unusual against the territory's own history. Statistics, not opinions: every flag
 * states the figures behind it, and a flag is a question to ask, never a finding. Voided statements are
 * ignored, and a territory needs at least three earlier statements before a swing can be judged.
 */
export function detectRoyaltyAnomalies(statements: StatementFacts[]): RoyaltyAnomaly[] {
  const flags: RoyaltyAnomaly[] = [];
  const byTerritory = new Map<string, StatementFacts[]>();
  for (const statement of statements) {
    if (statement.status === "void") continue;
    byTerritory.set(statement.territoryId, [...(byTerritory.get(statement.territoryId) ?? []), statement]);
  }

  for (const [territoryId, all] of byTerritory) {
    const ordered = [...all].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    const latest = ordered[ordered.length - 1]!;
    const earlier = ordered.slice(0, -1);
    const name = latest.territoryName;
    const flag = (kind: AnomalyKind, severity: RoyaltyAnomaly["severity"], detail: string) => flags.push({ key: `${territoryId}:${kind}`, territoryId, territoryName: name, statementId: latest.id, kind, severity, detail });

    // The same period twice.
    const seen = new Set<string>();
    for (const statement of ordered) {
      const period = `${statement.periodStart}/${statement.periodEnd}`;
      if (seen.has(period)) {
        flag("duplicate_period", "high", `There is more than one live statement for ${statement.periodStart} to ${statement.periodEnd}.`);
        break;
      }
      seen.add(period);
    }

    if (earlier.length >= 3) {
      const typical = median(earlier.map((statement) => statement.calculatedRoyaltyMinor));
      if (typical > 0) {
        if (latest.calculatedRoyaltyMinor === 0) {
          flag("zero_after_positive", "high", `The latest statement calculates ${moneyFromMinor(0)}; the typical earlier statement is ${moneyFromMinor(typical)}.`);
        } else {
          const change = latest.calculatedRoyaltyMinor / typical - 1;
          if (Math.abs(change) >= 0.5) {
            flag("swing", Math.abs(change) >= 1 ? "high" : "medium", `The latest royalty, ${moneyFromMinor(latest.calculatedRoyaltyMinor)}, is ${Math.abs(Math.round(change * 100))}% ${change > 0 ? "above" : "below"} the typical earlier statement of ${moneyFromMinor(typical)}.`);
          }
        }
      }

      // A missing period: the latest started much later than the usual spacing predicts.
      const gaps = ordered.slice(1).map((statement, index) => days(ordered[index]!.periodStart, statement.periodStart));
      const usual = median(gaps.slice(0, -1).length ? gaps.slice(0, -1) : gaps);
      const lastGap = gaps[gaps.length - 1]!;
      if (usual > 0 && lastGap > usual * 1.5) flag("missing_period", "medium", `The latest statement starts ${lastGap} days after the previous one; they usually start ${Math.round(usual)} days apart, so a period may be missing.`);
    }

    const calculated = Math.max(latest.calculatedRoyaltyMinor, 1);
    const adjustmentShare = Math.abs(latest.adjustmentsMinor) / calculated;
    if (latest.adjustmentsMinor !== 0 && adjustmentShare >= 0.25) {
      flag("heavy_adjustments", adjustmentShare >= 0.5 ? "high" : "medium", `Adjustments of ${moneyFromMinor(latest.adjustmentsMinor)} are ${Math.round(adjustmentShare * 100)}% of the calculated royalty of ${moneyFromMinor(latest.calculatedRoyaltyMinor)}.`);
    }
  }

  return flags.sort((a, b) => (a.severity === b.severity ? a.territoryName.localeCompare(b.territoryName) : a.severity === "high" ? -1 : 1));
}
