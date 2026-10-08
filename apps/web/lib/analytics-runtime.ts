import { auditActions, recordAuditEvent } from "@raring2go/audit";
import { createDb, territories } from "@raring2go/db";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import {
  activateHealthConfigVersion,
  analyticsCapabilities,
  AnalyticsAccessError,
  buildScorecard,
  collectMetrics,
  computeHealth,
  createHealthConfigDraft,
  getActiveHealthConfig,
  healthHistory,
  listHealthConfigs,
  saveHealthSnapshot,
  saveMetricSnapshots,
  snapshotAtOrBefore,
  updateHealthConfigDraft
} from "@raring2go/analytics";
import type { AnalyticsActorContext, AnalyticsDb } from "@raring2go/analytics";
import { defineJobHandler } from "@raring2go/workflows";
import type { JobHandler } from "@raring2go/workflows";
import { isNull } from "drizzle-orm";
import { appLogger } from "./logger";
import { getPermissionData } from "./permission-source";

export type { AnalyticsActorContext };

export const SNAPSHOT_METRICS_KIND = "analytics.snapshot_metrics";
export const snapshotMetricsIdempotencyKey = (now: Date) => `${SNAPSHOT_METRICS_KIND}:${now.toISOString().slice(0, 10)}`;

export function hasAnalyticsCapability(permissions: PermissionData, context: AnalyticsActorContext, capability: keyof typeof analyticsCapabilities) {
  const required = analyticsCapabilities[capability];
  return evaluatePermission(
    {
      userId: context.userId,
      module: required.module,
      action: required.action,
      context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined }
    },
    permissions
  ).allowed;
}

/** True for a network-wide grant (Head Office), as opposed to a territory-scoped one. */
export function hasNetworkAnalyticsAccess(permissions: PermissionData, userId: string, capability: keyof typeof analyticsCapabilities = "scorecardView") {
  const required = analyticsCapabilities[capability];
  return evaluatePermission({ userId, module: required.module, action: required.action }, permissions).allowed;
}

const auditFor = (db: Parameters<typeof recordAuditEvent>[0]) => ({ record: (input: Parameters<typeof recordAuditEvent>[1]) => recordAuditEvent(db, input) });

/**
 * Collect, persist and score everything for one day. Metric and health snapshots are keyed
 * by day, so repeating the run replaces that day's rows instead of duplicating them.
 */
export async function runSnapshot(db: AnalyticsDb, now: Date) {
  const collected = await collectMetrics(db, now);
  await saveMetricSnapshots(db, collected);
  const config = await getActiveHealthConfig(db, now);
  let scored = 0;
  for (const [territoryId, metrics] of Object.entries(collected.territories)) {
    const result = computeHealth(config.config, metrics);
    if (result.score == null) continue;
    await saveHealthSnapshot(db, { territoryId, date: now, config, result });
    scored += 1;
  }
  return { territories: Object.keys(collected.territories).length, scored, configVersion: config.versionNumber, definitionsVersion: collected.definitionsVersion };
}

export function createSnapshotMetricsHandler(): JobHandler {
  return defineJobHandler({
    kind: SNAPSHOT_METRICS_KIND,
    maxAttempts: 3,
    handle: async ({ now }) => {
      const { db, sql: client } = createDb();
      try {
        const summary = await runSnapshot(db, now());
        await recordAuditEvent(db, {
          action: auditActions.analyticsSnapshotGenerate,
          actor: { type: "system", systemId: "analytics-snapshot-job", displayName: "Analytics snapshot job" },
          entity: { type: "metric_snapshot" },
          metadata: { ...summary, snapshotDate: now().toISOString().slice(0, 10) }
        });
        appLogger.info("analytics snapshot complete", summary);
      } finally {
        await client.end();
      }
    }
  });
}

export async function readScorecardForActor(context: AnalyticsActorContext, now: Date = new Date()) {
  const analyticsPermissionData = await getPermissionData();
  const { db, sql } = createDb();
  try {
    const [collected, config, cohortRows] = await Promise.all([
      collectMetrics(db, now),
      getActiveHealthConfig(db, now),
      db.select({ id: territories.id, name: territories.name }).from(territories).where(isNull(territories.deletedAt))
    ]);
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
    const network = hasNetworkAnalyticsAccess(analyticsPermissionData, context.userId);
    const [networkPrev, territoryPrev] = await Promise.all([
      network ? snapshotAtOrBefore(db, null, monthAgo) : undefined,
      !network && context.territoryId ? snapshotAtOrBefore(db, context.territoryId, monthAgo) : undefined
    ]);
    const view = buildScorecard(context, analyticsPermissionData, {
      collected,
      config,
      cohort: cohortRows,
      previous: {
        ...(networkPrev ? { network: networkPrev.values } : {}),
        ...(territoryPrev && context.territoryId ? { territories: { [context.territoryId]: territoryPrev.values } } : {})
      }
    });
    const history = view.scope === "territory" && view.territory ? await healthHistory(db, view.territory.id) : [];
    return { view, history, activeConfig: config };
  } finally {
    await sql.end();
  }
}

export async function readHealthConfigsForActor(context: AnalyticsActorContext) {
  const analyticsPermissionData = await getPermissionData();
  if (!hasNetworkAnalyticsAccess(analyticsPermissionData, context.userId, "healthConfigManage")) throw new AnalyticsAccessError("Missing permission analytics.health_config.manage.");
  const { db, sql } = createDb();
  try {
    await getActiveHealthConfig(db);
    return await listHealthConfigs(db);
  } finally {
    await sql.end();
  }
}

async function withAudited<T>(work: (db: AnalyticsDb, audit: ReturnType<typeof auditFor>) => Promise<T>): Promise<T> {
  const { db, sql } = createDb();
  try {
    return await db.transaction(async (tx) => work(tx as unknown as AnalyticsDb, auditFor(tx as unknown as Parameters<typeof recordAuditEvent>[0])));
  } finally {
    await sql.end();
  }
}

export async function createConfigDraftAsActor(context: AnalyticsActorContext, input: unknown, note: string | null) {
  const analyticsPermissionData = await getPermissionData();
  return withAudited((db, audit) => createHealthConfigDraft(context, analyticsPermissionData, audit, db, input, note));
}

export async function updateConfigDraftAsActor(context: AnalyticsActorContext, id: string, input: unknown, note: string | null) {
  const analyticsPermissionData = await getPermissionData();
  return withAudited((db, audit) => updateHealthConfigDraft(context, analyticsPermissionData, audit, db, id, input, note));
}

export async function activateConfigAsActor(context: AnalyticsActorContext, id: string) {
  const analyticsPermissionData = await getPermissionData();
  return withAudited((db, audit) => activateHealthConfigVersion(context, analyticsPermissionData, audit, db, id));
}

export async function generateSnapshotAsActor(context: AnalyticsActorContext, now: Date = new Date()) {
  const analyticsPermissionData = await getPermissionData();
  if (!hasNetworkAnalyticsAccess(analyticsPermissionData, context.userId, "snapshotGenerate")) throw new AnalyticsAccessError("Missing permission analytics.snapshot.generate.");
  const { db, sql } = createDb();
  try {
    const summary = await runSnapshot(db, now);
    await recordAuditEvent(db, {
      action: auditActions.analyticsSnapshotGenerate,
      actor: { type: "human", userId: context.userId },
      entity: { type: "metric_snapshot" },
      metadata: { ...summary, snapshotDate: now.toISOString().slice(0, 10) }
    });
    return summary;
  } finally {
    await sql.end();
  }
}
