import { describe, expect, it } from "vitest";
import { benchmarkMetric, MIN_PEER_COHORT } from "./benchmark";
import { DEFINITIONS_VERSION, metricByKey, metricCatalogue } from "./catalogue";
import { bandFor, computeHealth, defaultHealthConfig, normaliseValue, validateHealthConfig } from "./health";
import type { HealthConfig } from "./health";

describe("catalogue", () => {
  it("defines every metric once, with a plain-English description, formula, source and valid components", () => {
    const keys = metricCatalogue.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const definition of metricCatalogue) {
      expect(definition.description.length).toBeGreaterThan(20);
      expect(definition.formula.length).toBeGreaterThan(10);
      expect(definition.source).toBeTruthy();
      expect(definition.key).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
      expect(definition.key.startsWith(`${definition.domain}.`)).toBe(true);
      if (definition.kind === "derived") for (const component of definition.components) expect(metricByKey.has(component)).toBe(true);
    }
    expect(DEFINITIONS_VERSION).toMatch(/^\d{4}\.\d{2}\.\d+$/);
  });

  it("derives overdue share from its components, and reports no data when nothing is outstanding", () => {
    const share = metricByKey.get("commercial.overdue_share")!;
    if (share.kind !== "derived") throw new Error("expected derived");
    expect(share.derive({ "commercial.receivables_overdue": 25, "commercial.receivables_outstanding": 200 })).toBe(12.5);
    expect(share.derive({ "commercial.receivables_overdue": 0, "commercial.receivables_outstanding": 0 })).toBeNull();
    expect(share.derive({})).toBeNull();
  });
});

describe("normaliseValue", () => {
  it("scales linearly between the anchors, clamped, in either direction", () => {
    expect(normaliseValue(250, { bad: 0, good: 500 })).toBe(50);
    expect(normaliseValue(-10, { bad: 0, good: 500 })).toBe(0);
    expect(normaliseValue(900, { bad: 0, good: 500 })).toBe(100);
    // Lower is better: 0 overdue is perfect, 5+ is worst.
    expect(normaliseValue(0, { bad: 5, good: 0 })).toBe(100);
    expect(normaliseValue(5, { bad: 5, good: 0 })).toBe(0);
    expect(normaliseValue(1, { bad: 5, good: 0 })).toBe(80);
  });
});

describe("computeHealth", () => {
  const config: HealthConfig = {
    thresholds: { green: 75, amber: 50 },
    factors: [
      { metric: "commercial.bookings_value_30d", weight: 60, bad: 0, good: 1000 },
      { metric: "operations.tasks_overdue", weight: 40, bad: 10, good: 0 }
    ]
  };

  it("weights normalised factors and explains every line", () => {
    const result = computeHealth(config, { "commercial.bookings_value_30d": 500, "operations.tasks_overdue": 0 });
    expect(result.score).toBe(70); // 50*0.6 + 100*0.4
    expect(result.band).toBe("amber");
    expect(result.factors).toEqual([
      expect.objectContaining({ metric: "commercial.bookings_value_30d", raw: 500, normalised: 50, effectiveWeight: 60, contribution: 30, state: "scored" }),
      expect.objectContaining({ metric: "operations.tasks_overdue", raw: 0, normalised: 100, effectiveWeight: 40, contribution: 40, state: "scored" })
    ]);
  });

  it("re-normalises over factors with data instead of punishing a metric that does not apply", () => {
    const result = computeHealth(config, { "commercial.bookings_value_30d": 1000, "operations.tasks_overdue": null });
    expect(result.score).toBe(100);
    expect(result.factors[1]).toMatchObject({ state: "no_data", effectiveWeight: 0, contribution: 0, normalised: null });
    expect(result.factors[0]).toMatchObject({ effectiveWeight: 100 });
  });

  it("is unrated when there is no data at all", () => {
    expect(computeHealth(config, {})).toMatchObject({ score: null, band: "unrated" });
  });

  it("scores the default configuration to the same total as its contributions", () => {
    const result = computeHealth(defaultHealthConfig, Object.fromEntries(defaultHealthConfig.factors.map((factor) => [factor.metric, factor.good])));
    expect(result.score).toBe(100);
    expect(result.band).toBe("green");
    expect(result.factors.reduce((total, factor) => total + factor.contribution, 0)).toBeCloseTo(100, 1);
    const worst = computeHealth(defaultHealthConfig, Object.fromEntries(defaultHealthConfig.factors.map((factor) => [factor.metric, factor.bad])));
    expect(worst).toMatchObject({ score: 0, band: "red" });
  });

  it("bands against configurable thresholds", () => {
    expect(bandFor(75, { green: 75, amber: 50 })).toBe("green");
    expect(bandFor(74.99, { green: 75, amber: 50 })).toBe("amber");
    expect(bandFor(49, { green: 75, amber: 50 })).toBe("red");
    expect(bandFor(60, { green: 90, amber: 60 })).toBe("amber");
    expect(bandFor(null, { green: 75, amber: 50 })).toBe("unrated");
  });
});

describe("validateHealthConfig", () => {
  it("accepts the default configuration", () => {
    expect(validateHealthConfig(defaultHealthConfig)).toMatchObject({ ok: true });
    expect(defaultHealthConfig.factors.reduce((total, factor) => total + factor.weight, 0)).toBe(100);
  });

  it("reports every problem at once", () => {
    const result = validateHealthConfig({
      thresholds: { green: 50, amber: 60 },
      factors: [
        { metric: "nope.metric", weight: 50, bad: 0, good: 1 },
        { metric: "operations.ai_spend_30d", weight: 20, bad: 0, good: 1 },
        { metric: "audience.subscribers", weight: 0, bad: 0, good: 1 },
        { metric: "operations.tasks_overdue", weight: 20, bad: 0, good: 10 },
        { metric: "audience.newsletters_sent_30d", weight: 20, bad: 4, good: 4 }
      ]
    });
    expect(result.ok).toBe(false);
    const text = result.ok ? "" : result.errors.join(" | ");
    for (const expected of ["unknown metric", "informational", "weight must be", "lower-is-better", "must differ", "Thresholds need"]) expect(text).toContain(expected);
  });

  it("requires weights to add up to 100 and rejects duplicates and empties", () => {
    const base = { thresholds: { green: 75, amber: 50 } };
    expect(validateHealthConfig({ ...base, factors: [{ metric: "audience.subscribers", weight: 60, bad: 0, good: 100 }] })).toMatchObject({ ok: false });
    const dup = validateHealthConfig({ ...base, factors: [{ metric: "audience.subscribers", weight: 50, bad: 0, good: 100 }, { metric: "audience.subscribers", weight: 50, bad: 0, good: 100 }] });
    expect(dup.ok ? "" : dup.errors.join(" ")).toContain("used twice");
    expect(validateHealthConfig({ ...base, factors: [] })).toMatchObject({ ok: false });
    expect(() => validateHealthConfig(null)).not.toThrow();
  });
});

describe("benchmarkMetric", () => {
  const territories = (own: number, peers: number[]) => ({
    own: { "audience.subscribers": own, "operations.tasks_overdue": own },
    ...Object.fromEntries(peers.map((value, index) => [`peer${index}`, { "audience.subscribers": value, "operations.tasks_overdue": value }]))
  });

  it("withholds comparisons below the minimum cohort, so no individual peer can be inferred", () => {
    const result = benchmarkMetric(territories(100, [10, 20, 30, 40]), "own", "audience.subscribers");
    expect(result).toEqual({ metric: "audience.subscribers", suppressed: true, reason: "not_enough_peers", peerCount: 4 });
    expect(MIN_PEER_COHORT).toBe(5);
  });

  it("returns only aggregates (median and quartiles) and never any peer's value or id", () => {
    const result = benchmarkMetric(territories(100, [10, 20, 30, 40, 50, 60]), "own", "audience.subscribers");
    expect(result).toMatchObject({ suppressed: false, own: 100, peerCount: 6, median: 35, lowerQuartile: 22.5, upperQuartile: 47.5, band: "top_quarter" });
    const json = JSON.stringify(result);
    expect(json).not.toContain("peer0");
    expect(Object.keys(result).sort()).toEqual(["band", "lowerQuartile", "median", "metric", "own", "peerCount", "suppressed", "upperQuartile"]);
  });

  it("orients the band by direction: for a lower-is-better metric, a low value is top quarter", () => {
    const low = benchmarkMetric(territories(0, [5, 6, 7, 8, 9, 10]), "own", "operations.tasks_overdue");
    expect(low).toMatchObject({ suppressed: false, band: "top_quarter" });
    const high = benchmarkMetric(territories(50, [5, 6, 7, 8, 9, 10]), "own", "operations.tasks_overdue");
    expect(high).toMatchObject({ suppressed: false, band: "bottom_quarter" });
  });

  it("ignores peers without data, and refuses informational metrics and territories without data", () => {
    const peers = { own: { "audience.subscribers": 5 }, a: { "audience.subscribers": null }, b: { "audience.subscribers": 1 } } as never;
    expect(benchmarkMetric(peers, "own", "audience.subscribers")).toMatchObject({ suppressed: true, peerCount: 1 });
    expect(benchmarkMetric({ own: { "operations.ai_spend_30d": 5 } } as never, "own", "operations.ai_spend_30d")).toMatchObject({ suppressed: true, reason: "not_comparable" });
    expect(benchmarkMetric({ own: { "audience.subscribers": null } } as never, "own", "audience.subscribers")).toMatchObject({ suppressed: true, reason: "no_own_data" });
    expect(benchmarkMetric({}, "own", "audience.subscribers")).toMatchObject({ suppressed: true, reason: "no_own_data" });
  });

  it("reports in_line when peers have no spread", () => {
    expect(benchmarkMetric(territories(10, [10, 10, 10, 10, 10]), "own", "audience.subscribers")).toMatchObject({ band: "in_line" });
  });
});
