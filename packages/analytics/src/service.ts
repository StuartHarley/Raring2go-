import { auditActions } from "@raring2go/audit";
import type { RecordAuditEventInput } from "@raring2go/audit";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import { benchmarkMetric } from "./benchmark";
import type { Benchmark } from "./benchmark";
import { metricCatalogue } from "./catalogue";
import type { MetricDefinition, MetricValues } from "./catalogue";
import type { CollectedMetrics } from "./collect";
import { computeHealth, validateHealthConfig } from "./health";
import type { HealthBand, HealthResult } from "./health";
import type { AnalyticsDb, HealthConfigRecord } from "./repository";
import { activateHealthConfig, createDraftHealthConfig, getHealthConfig, updateDraftHealthConfig } from "./repository";

export const analyticsCapabilities = {
  scorecardView: { module: "analytics.scorecard", action: "view" },
  healthConfigManage: { module: "analytics.health_config", action: "manage" },
  snapshotGenerate: { module: "analytics.snapshot", action: "generate" }
} as const;

export type AnalyticsActorContext = { userId: string; organisationId?: string | null; territoryId?: string | null };
export type AnalyticsAuditRecorder = { record: (input: RecordAuditEventInput) => Promise<unknown> };

export class AnalyticsAccessError extends Error {
  constructor(message = "You do not have access to this scorecard.") {
    super(message);
    this.name = "AnalyticsAccessError";
  }
}

export class AnalyticsStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsStateError";
  }
}

export class HealthConfigValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "HealthConfigValidationError";
    this.errors = errors;
  }
}

function allowed(context: AnalyticsActorContext, permissions: PermissionData, capability: keyof typeof analyticsCapabilities, territoryId?: string) {
  const { module, action } = analyticsCapabilities[capability];
  return evaluatePermission({ userId: context.userId, module, action, ...(territoryId ? { resource: { territoryId } } : {}) }, permissions).allowed;
}

export type ScorecardMetric = {
  definition: Pick<MetricDefinition, "key" | "label" | "domain" | "unit" | "direction" | "description" | "formula" | "source" | "window">;
  value: number | null;
  /** The value ~30 days ago from stored snapshots, when one exists. */
  previous: number | null;
};

export type TerritoryRow = { territoryId: string; name: string; score: number | null; band: HealthBand; metrics: MetricValues };

export type ScorecardView = {
  scope: "network" | "territory";
  definitionsVersion: string;
  collectedAt: Date;
  territory?: { id: string; name: string };
  metrics: ScorecardMetric[];
  /** Territory scope: this territory's score. Network scope: the distribution across the cohort. */
  health?: { result: HealthResult; configVersion: number; thresholds: { green: number; amber: number } };
  distribution?: Record<HealthBand, number>;
  /** Network scope only. Peer territories' own figures are never present in a territory scope. */
  territories?: TerritoryRow[];
  /** Territory scope only: aggregates against peers, never any peer's value or identity. */
  benchmarks?: Benchmark[];
};

export type ScorecardInput = {
  collected: CollectedMetrics;
  config: HealthConfigRecord;
  /** Territories in the benchmarking cohort (active franchises) with display names. */
  cohort: Array<{ id: string; name: string }>;
  previous?: { network?: Record<string, number>; territories?: Record<string, Record<string, number>> };
};

const asMetrics = (values: MetricValues, previous: Record<string, number> | undefined): ScorecardMetric[] =>
  metricCatalogue.map((definition) => ({
    definition: { key: definition.key, label: definition.label, domain: definition.domain, unit: definition.unit, direction: definition.direction, description: definition.description, formula: definition.formula, source: definition.source, window: definition.window },
    value: values[definition.key] ?? null,
    previous: previous?.[definition.key] ?? null
  }));

/**
 * The scorecard for the actor's scope. A network (Head Office) grant sees the network total
 * and every territory; a territory grant sees only its own territory plus peer aggregates.
 * Both read the same collected values, so the two views always reconcile.
 */
export function buildScorecard(context: AnalyticsActorContext, permissions: PermissionData, input: ScorecardInput): ScorecardView {
  const { collected, config, cohort } = input;

  if (allowed(context, permissions, "scorecardView")) {
    const rows: TerritoryRow[] = cohort.map((territory) => {
      const metrics = collected.territories[territory.id] ?? {};
      const result = computeHealth(config.config, metrics);
      return { territoryId: territory.id, name: territory.name, score: result.score, band: result.band, metrics };
    });
    const distribution: Record<HealthBand, number> = { green: 0, amber: 0, red: 0, unrated: 0 };
    for (const row of rows) distribution[row.band] += 1;

    return {
      scope: "network",
      definitionsVersion: collected.definitionsVersion,
      collectedAt: collected.collectedAt,
      metrics: asMetrics(collected.network, input.previous?.network),
      distribution,
      territories: rows.sort((a, b) => (a.score ?? -1) - (b.score ?? -1))
    };
  }

  const territoryId = context.territoryId;
  if (!territoryId || !allowed(context, permissions, "scorecardView", territoryId)) {
    throw new AnalyticsAccessError("Missing permission analytics.scorecard.view.");
  }
  const own = collected.territories[territoryId];
  const territory = cohort.find((entry) => entry.id === territoryId);
  if (!own) throw new AnalyticsAccessError("Territory not found.");

  // Peer comparisons use the cohort only, and expose aggregates only.
  const peerValues = Object.fromEntries(cohort.map((entry) => [entry.id, collected.territories[entry.id] ?? {}]));
  peerValues[territoryId] = own;
  const benchmarks = metricCatalogue.filter((definition) => definition.direction !== "neutral").map((definition) => benchmarkMetric(peerValues, territoryId, definition.key));

  return {
    scope: "territory",
    definitionsVersion: collected.definitionsVersion,
    collectedAt: collected.collectedAt,
    territory: { id: territoryId, name: territory?.name ?? "Your territory" },
    metrics: asMetrics(own, input.previous?.territories?.[territoryId]),
    health: { result: computeHealth(config.config, own), configVersion: config.versionNumber, thresholds: config.config.thresholds },
    benchmarks
  };
}

// ---- Health score configuration ------------------------------------------------------

function requireManage(context: AnalyticsActorContext, permissions: PermissionData) {
  // Scoring rules are network configuration: a territory-scoped grant is not enough.
  if (!allowed(context, permissions, "healthConfigManage")) throw new AnalyticsAccessError("Missing permission analytics.health_config.manage.");
}

export async function createHealthConfigDraft(
  context: AnalyticsActorContext,
  permissions: PermissionData,
  audit: AnalyticsAuditRecorder,
  db: AnalyticsDb,
  input: unknown,
  changeNote: string | null
): Promise<HealthConfigRecord> {
  requireManage(context, permissions);
  const validated = validateHealthConfig(input);
  if (!validated.ok) throw new HealthConfigValidationError(validated.errors);
  const created = await createDraftHealthConfig(db, validated.value, context.userId, changeNote?.trim().slice(0, 300) || null);
  await audit.record({
    action: auditActions.analyticsHealthConfigCreate,
    actor: { type: "human", userId: context.userId },
    entity: { type: "health_score_config", id: created.id },
    after: { versionNumber: created.versionNumber, factorCount: created.config.factors.length, thresholds: created.config.thresholds },
    metadata: { changeNote: created.changeNote }
  });
  return created;
}

export async function updateHealthConfigDraft(
  context: AnalyticsActorContext,
  permissions: PermissionData,
  audit: AnalyticsAuditRecorder,
  db: AnalyticsDb,
  id: string,
  input: unknown,
  changeNote: string | null
): Promise<HealthConfigRecord> {
  requireManage(context, permissions);
  const existing = await getHealthConfig(db, id);
  if (!existing) throw new AnalyticsStateError("That configuration was not found.");
  if (existing.status !== "draft") throw new AnalyticsStateError(`A ${existing.status} version is immutable history. Create a new draft to change it.`);
  const validated = validateHealthConfig(input);
  if (!validated.ok) throw new HealthConfigValidationError(validated.errors);
  const updated = await updateDraftHealthConfig(db, id, validated.value, changeNote?.trim().slice(0, 300) ?? null);
  if (!updated) throw new AnalyticsStateError("This draft was activated before the change could be saved.");
  await audit.record({
    action: auditActions.analyticsHealthConfigUpdate,
    actor: { type: "human", userId: context.userId },
    entity: { type: "health_score_config", id },
    before: { factors: existing.config.factors, thresholds: existing.config.thresholds },
    after: { factors: updated.config.factors, thresholds: updated.config.thresholds },
    metadata: { versionNumber: updated.versionNumber }
  });
  return updated;
}

export async function activateHealthConfigVersion(
  context: AnalyticsActorContext,
  permissions: PermissionData,
  audit: AnalyticsAuditRecorder,
  db: AnalyticsDb,
  id: string,
  now: Date = new Date()
): Promise<HealthConfigRecord> {
  requireManage(context, permissions);
  const existing = await getHealthConfig(db, id);
  if (!existing) throw new AnalyticsStateError("That configuration was not found.");
  if (existing.status !== "draft") throw new AnalyticsStateError(`Only a draft can be activated; this version is ${existing.status}.`);
  const validated = validateHealthConfig(existing.config);
  if (!validated.ok) throw new HealthConfigValidationError(validated.errors);
  const activated = await activateHealthConfig(db, id, context.userId, now);
  if (!activated) throw new AnalyticsStateError("This version could not be activated. Refresh and try again.");
  await audit.record({
    action: auditActions.analyticsHealthConfigActivate,
    actor: { type: "human", userId: context.userId },
    entity: { type: "health_score_config", id },
    after: { activeVersion: activated.versionNumber },
    metadata: { changeNote: activated.changeNote }
  });
  return activated;
}
