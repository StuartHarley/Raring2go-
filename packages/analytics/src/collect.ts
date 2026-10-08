import { sql } from "drizzle-orm";
import type { createDb } from "@raring2go/db";
import { DEFINITIONS_VERSION, metricCatalogue } from "./catalogue";
import type { MetricValues } from "./catalogue";

type Db = Pick<ReturnType<typeof createDb>["db"], "execute">;

export type CollectedMetrics = {
  definitionsVersion: string;
  collectedAt: Date;
  /** Every territory that exists, even with no activity (all zero / no data). */
  territories: Record<string, MetricValues>;
  /** The network aggregate: sums of the territories, with derived metrics re-derived from them. */
  network: MetricValues;
};

/**
 * The single path every metric value takes. Territory and network figures come out of the
 * same queries, so a territory view and the HQ view can never disagree: network count/sum
 * metrics are exactly the sum of the territory rows, and derived metrics (ratios) are
 * recomputed from the aggregated components rather than averaged.
 */
export async function collectMetrics(db: Db, now: Date = new Date()): Promise<CollectedMetrics> {
  const context = { now, since: new Date(now.getTime() - 30 * 86_400_000), today: now.toISOString().slice(0, 10) };

  const territoryRows = (await db.execute(sql`SELECT id FROM territories WHERE deleted_at IS NULL ORDER BY id`)) as unknown as Array<{ id: string }>;
  const territories: Record<string, MetricValues> = Object.fromEntries(territoryRows.map((row) => [row.id, {}]));

  for (const definition of metricCatalogue) {
    if (definition.kind !== "query") continue;
    const rows = (await db.execute(definition.query(context))) as unknown as Array<{ territory_id: string | null; value: number | string | null }>;
    const found = new Map<string, number | null>();
    for (const row of rows) {
      if (row.territory_id) found.set(row.territory_id, row.value == null ? null : Number(row.value));
    }
    for (const territoryId of Object.keys(territories)) {
      // No rows for a territory means zero activity for count/sum metrics, and "no data" for
      // ratio-style queries that return nothing when there is nothing to divide.
      territories[territoryId]![definition.key] = found.has(territoryId) ? found.get(territoryId)! : definition.unit === "percent" ? null : 0;
    }
  }

  const network: MetricValues = {};
  for (const definition of metricCatalogue) {
    if (definition.kind === "query" && definition.unit !== "percent") {
      network[definition.key] = Object.values(territories).reduce((total, values) => total + (values[definition.key] ?? 0), 0);
    }
  }
  // Percent queries (e.g. edition approval share) cannot be summed: weight by territory counts instead.
  network["publishing.edition_approval_share"] = await networkEditionShare(db);

  for (const values of [...Object.values(territories), network]) {
    for (const definition of metricCatalogue) {
      if (definition.kind === "derived") values[definition.key] = definition.derive(values);
    }
  }

  return { definitionsVersion: DEFINITIONS_VERSION, collectedAt: now, territories, network };
}

async function networkEditionShare(db: Db): Promise<number | null> {
  const rows = (await db.execute(sql`
    SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('approved', 'generating', 'published')) / NULLIF(COUNT(*), 0), 1)::float8 AS value
    FROM territory_editions WHERE deleted_at IS NULL AND status <> 'archived'`)) as unknown as Array<{ value: number | string | null }>;
  const value = rows[0]?.value;
  return value == null ? null : Number(value);
}
