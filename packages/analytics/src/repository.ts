import { franchiseHealthSnapshots, healthScoreConfigs, metricSnapshots } from "@raring2go/db";
import type { createDb } from "@raring2go/db";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { CollectedMetrics } from "./collect";
import { defaultHealthConfig } from "./health";
import type { HealthConfig, HealthResult } from "./health";

export type AnalyticsDb = ReturnType<typeof createDb>["db"];

export type HealthConfigRecord = {
  id: string;
  versionNumber: number;
  status: "draft" | "active" | "retired";
  config: HealthConfig;
  changeNote: string | null;
  createdByUserId: string | null;
  activatedByUserId: string | null;
  activatedAt: Date | null;
  createdAt: Date;
};

const toRecord = (row: typeof healthScoreConfigs.$inferSelect): HealthConfigRecord => ({
  id: row.id,
  versionNumber: row.versionNumber,
  status: row.status as HealthConfigRecord["status"],
  config: { factors: row.factors as unknown as HealthConfig["factors"], thresholds: row.thresholds as HealthConfig["thresholds"] },
  changeNote: row.changeNote,
  createdByUserId: row.createdByUserId,
  activatedByUserId: row.activatedByUserId,
  activatedAt: row.activatedAt,
  createdAt: row.createdAt
});

const toRow = (config: HealthConfig) => ({ factors: config.factors as unknown as Array<Record<string, unknown>>, thresholds: config.thresholds });

export async function listHealthConfigs(db: AnalyticsDb): Promise<HealthConfigRecord[]> {
  return (await db.select().from(healthScoreConfigs).orderBy(desc(healthScoreConfigs.versionNumber))).map(toRecord);
}

export async function getHealthConfig(db: AnalyticsDb, id: string): Promise<HealthConfigRecord | undefined> {
  const [row] = await db.select().from(healthScoreConfigs).where(eq(healthScoreConfigs.id, id));
  return row ? toRecord(row) : undefined;
}

/**
 * The active configuration. If none exists yet, the default is installed as version 1 and
 * activated (idempotent: a concurrent first call loses the unique-version race and re-reads).
 */
export async function getActiveHealthConfig(db: AnalyticsDb, now: Date = new Date()): Promise<HealthConfigRecord> {
  const [active] = await db.select().from(healthScoreConfigs).where(eq(healthScoreConfigs.status, "active"));
  if (active) return toRecord(active);

  const inserted = await db
    .insert(healthScoreConfigs)
    .values({ versionNumber: 1, status: "active", ...toRow(defaultHealthConfig), changeNote: "Built-in default", activatedAt: now })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return toRecord(inserted[0]);

  const [again] = await db.select().from(healthScoreConfigs).where(eq(healthScoreConfigs.status, "active"));
  if (!again) throw new Error("No active health score configuration is available.");
  return toRecord(again);
}

export async function createDraftHealthConfig(db: AnalyticsDb, config: HealthConfig, createdByUserId: string, changeNote: string | null): Promise<HealthConfigRecord> {
  return db.transaction(async (tx) => {
    const [latest] = await tx.select({ n: sql<number>`coalesce(max(${healthScoreConfigs.versionNumber}), 0)::int` }).from(healthScoreConfigs);
    const [row] = await tx
      .insert(healthScoreConfigs)
      .values({ versionNumber: (latest?.n ?? 0) + 1, status: "draft", ...toRow(config), changeNote, createdByUserId })
      .returning();
    return toRecord(row!);
  });
}

/** Only drafts are editable: active and retired versions are immutable history. */
export async function updateDraftHealthConfig(db: AnalyticsDb, id: string, config: HealthConfig, changeNote: string | null): Promise<HealthConfigRecord | undefined> {
  const [row] = await db
    .update(healthScoreConfigs)
    .set({ ...toRow(config), ...(changeNote !== null ? { changeNote } : {}) })
    .where(and(eq(healthScoreConfigs.id, id), eq(healthScoreConfigs.status, "draft")))
    .returning();
  return row ? toRecord(row) : undefined;
}

export async function activateHealthConfig(db: AnalyticsDb, id: string, userId: string, now: Date = new Date()): Promise<HealthConfigRecord | undefined> {
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(healthScoreConfigs).where(and(eq(healthScoreConfigs.id, id), eq(healthScoreConfigs.status, "draft"))).for("update");
    if (!target) return undefined;
    await tx.update(healthScoreConfigs).set({ status: "retired" }).where(eq(healthScoreConfigs.status, "active"));
    const [row] = await tx.update(healthScoreConfigs).set({ status: "active", activatedByUserId: userId, activatedAt: now }).where(eq(healthScoreConfigs.id, id)).returning();
    return row ? toRecord(row) : undefined;
  });
}

const asDay = (date: Date) => date.toISOString().slice(0, 10);

/** One snapshot per scope per day; running again the same day replaces it (idempotent). */
export async function saveMetricSnapshots(db: AnalyticsDb, collected: CollectedMetrics) {
  const day = new Date(`${asDay(collected.collectedAt)}T00:00:00Z`);
  const values = (record: Record<string, number | null>) => Object.fromEntries(Object.entries(record).filter((entry): entry is [string, number] => entry[1] != null));

  for (const [territoryId, record] of Object.entries(collected.territories)) {
    await db
      .insert(metricSnapshots)
      .values({ territoryId, snapshotDate: day, definitionsVersion: collected.definitionsVersion, values: values(record) })
      .onConflictDoUpdate({ target: [metricSnapshots.territoryId, metricSnapshots.snapshotDate], set: { values: values(record), definitionsVersion: collected.definitionsVersion } });
  }

  const existing = await db.select().from(metricSnapshots).where(and(isNull(metricSnapshots.territoryId), eq(metricSnapshots.snapshotDate, day)));
  if (existing[0]) {
    await db.update(metricSnapshots).set({ values: values(collected.network), definitionsVersion: collected.definitionsVersion }).where(eq(metricSnapshots.id, existing[0].id));
  } else {
    await db.insert(metricSnapshots).values({ territoryId: null, snapshotDate: day, definitionsVersion: collected.definitionsVersion, values: values(collected.network) });
  }
}

export async function saveHealthSnapshot(db: AnalyticsDb, input: { territoryId: string; date: Date; config: HealthConfigRecord; result: HealthResult }) {
  if (input.result.score == null) return;
  const day = new Date(`${asDay(input.date)}T00:00:00Z`);
  const row = { territoryId: input.territoryId, snapshotDate: day, configId: input.config.id, configVersion: input.config.versionNumber, score: input.result.score.toFixed(2), band: input.result.band, factors: input.result.factors as unknown as Array<Record<string, unknown>> };
  await db
    .insert(franchiseHealthSnapshots)
    .values(row)
    .onConflictDoUpdate({ target: [franchiseHealthSnapshots.territoryId, franchiseHealthSnapshots.snapshotDate], set: { configId: row.configId, configVersion: row.configVersion, score: row.score, band: row.band, factors: row.factors } });
}

export type HealthHistoryPoint = { snapshotDate: Date; score: number; band: string; configVersion: number };

export async function healthHistory(db: AnalyticsDb, territoryId: string, limit = 12): Promise<HealthHistoryPoint[]> {
  const rows = await db.select().from(franchiseHealthSnapshots).where(eq(franchiseHealthSnapshots.territoryId, territoryId)).orderBy(desc(franchiseHealthSnapshots.snapshotDate)).limit(limit);
  return rows.map((row) => ({ snapshotDate: row.snapshotDate, score: Number(row.score), band: row.band, configVersion: row.configVersion }));
}

/** The latest snapshot at or before `before`: used to show change over time. */
export async function snapshotAtOrBefore(db: AnalyticsDb, territoryId: string | null, before: Date): Promise<{ date: Date; values: Record<string, number> } | undefined> {
  const [row] = await db
    .select()
    .from(metricSnapshots)
    .where(and(territoryId ? eq(metricSnapshots.territoryId, territoryId) : isNull(metricSnapshots.territoryId), lte(metricSnapshots.snapshotDate, new Date(`${asDay(before)}T00:00:00Z`))))
    .orderBy(desc(metricSnapshots.snapshotDate))
    .limit(1);
  return row ? { date: row.snapshotDate, values: row.values } : undefined;
}
