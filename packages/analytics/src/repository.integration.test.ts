import { randomUUID } from "node:crypto";
import { createDb, fixtureIds, franchiseHealthSnapshots, healthScoreConfigs, metricSnapshots } from "@raring2go/db";
import type { PermissionData } from "@raring2go/permissions";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { metricCatalogue } from "./catalogue";
import { collectMetrics } from "./collect";
import { computeHealth, defaultHealthConfig } from "./health";
import { activateHealthConfig, getActiveHealthConfig, saveHealthSnapshot, saveMetricSnapshots } from "./repository";
import { activateHealthConfigVersion, AnalyticsAccessError, AnalyticsStateError, createHealthConfigDraft, HealthConfigValidationError, updateHealthConfigDraft } from "./service";
import type { AnalyticsActorContext } from "./service";

/** Real SQL for collection, snapshots and config versions. `RUN_DB_TESTS=1 pnpm --filter @raring2go/analytics test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("analytics (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  // A date no real snapshot job will ever use, so cleanup is exact.
  const testDay = new Date("2001-02-03T09:00:00Z");
  const createdConfigIds: string[] = [];
  let originalActiveId: string | undefined;

  const manage = { id: fixtureIds.permissions.healthConfigManage, module: "analytics.health_config", action: "manage" };
  const permissions: PermissionData = {
    roleAssignments: [
      { id: "a1", userId: fixtureIds.users.superAdmin, roleId: fixtureIds.roles.hqAdmin, organisationId: fixtureIds.organisations.hq },
      { id: "a2", userId: fixtureIds.users.franchisee, roleId: fixtureIds.roles.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield }
    ],
    rolePermissions: [{ roleId: fixtureIds.roles.hqAdmin, permission: manage, scope: "network", constraints: {} }]
  };
  const hq: AnalyticsActorContext = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const franchisee: AnalyticsActorContext = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const events: Array<{ action: string }> = [];
  const audit = { record: async (input: { action: string }) => void events.push(input) };

  afterAll(async () => {
    await db.delete(franchiseHealthSnapshots).where(eq(franchiseHealthSnapshots.snapshotDate, new Date("2001-02-03T00:00:00Z")));
    await db.delete(metricSnapshots).where(eq(metricSnapshots.snapshotDate, new Date("2001-02-03T00:00:00Z")));
    if (createdConfigIds.length) await db.delete(healthScoreConfigs).where(inArray(healthScoreConfigs.id, createdConfigIds));
    if (originalActiveId) {
      await db.update(healthScoreConfigs).set({ status: "retired" }).where(eq(healthScoreConfigs.status, "active"));
      await db.update(healthScoreConfigs).set({ status: "active" }).where(eq(healthScoreConfigs.id, originalActiveId));
    }
    await sql.end();
  });

  it("collects metrics that run against the real schema, with network equal to the sum of the territories", async () => {
    const collected = await collectMetrics(db, new Date());
    const territoryIds = Object.keys(collected.territories);
    expect(territoryIds).toEqual(expect.arrayContaining([fixtureIds.territories.suttonColdfield, fixtureIds.territories.solihull]));

    for (const definition of metricCatalogue) {
      if (definition.kind !== "query" || definition.unit === "percent") continue;
      const sum = territoryIds.reduce((total, id) => total + (collected.territories[id]![definition.key] ?? 0), 0);
      expect(collected.network[definition.key], definition.key).toBe(sum);
      for (const id of territoryIds) expect(typeof collected.territories[id]![definition.key], `${definition.key} for ${id}`).toBe("number");
    }
    // The HQ ratio comes from the summed components, not an average of territory ratios.
    const outstanding = collected.network["commercial.receivables_outstanding"] ?? 0;
    const overdue = collected.network["commercial.receivables_overdue"] ?? 0;
    expect(collected.network["commercial.overdue_share"] ?? null).toBe(outstanding > 0 ? Math.round((overdue / outstanding) * 10000) / 100 : null);
  });

  it("installs the default configuration once and keeps exactly one active version", async () => {
    const active = await getActiveHealthConfig(db);
    originalActiveId = active.id;
    expect(active.status).toBe("active");
    expect((await getActiveHealthConfig(db)).id).toBe(active.id);
    const rows = await db.select().from(healthScoreConfigs).where(eq(healthScoreConfigs.status, "active"));
    expect(rows).toHaveLength(1);
  });

  it("stores a snapshot per territory and day, replacing rather than duplicating on a re-run", async () => {
    const collected = await collectMetrics(db, testDay);
    await saveMetricSnapshots(db, collected);
    await saveMetricSnapshots(db, collected);
    const rows = await db.select().from(metricSnapshots).where(eq(metricSnapshots.snapshotDate, new Date("2001-02-03T00:00:00Z")));
    expect(rows).toHaveLength(Object.keys(collected.territories).length + 1);
    expect(rows.filter((row) => row.territoryId === null)).toHaveLength(1);
    expect(rows.every((row) => row.definitionsVersion === collected.definitionsVersion)).toBe(true);

    const config = await getActiveHealthConfig(db);
    const result = computeHealth(config.config, { "commercial.bookings_value_30d": 500_000, "audience.subscribers": 2_000 });
    await saveHealthSnapshot(db, { territoryId: fixtureIds.territories.suttonColdfield, date: testDay, config, result });
    await saveHealthSnapshot(db, { territoryId: fixtureIds.territories.suttonColdfield, date: testDay, config, result });
    const health = await db.select().from(franchiseHealthSnapshots).where(and(eq(franchiseHealthSnapshots.territoryId, fixtureIds.territories.suttonColdfield), eq(franchiseHealthSnapshots.snapshotDate, new Date("2001-02-03T00:00:00Z"))));
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({ configVersion: config.versionNumber, band: result.band });
    expect(Array.isArray(health[0]!.factors)).toBe(true);
  });

  it("does not store a score when there is no data at all", async () => {
    const config = await getActiveHealthConfig(db);
    await saveHealthSnapshot(db, { territoryId: fixtureIds.territories.solihull, date: testDay, config, result: computeHealth(config.config, {}) });
    const rows = await db.select().from(franchiseHealthSnapshots).where(and(eq(franchiseHealthSnapshots.territoryId, fixtureIds.territories.solihull), eq(franchiseHealthSnapshots.snapshotDate, new Date("2001-02-03T00:00:00Z"))));
    expect(rows).toHaveLength(0);
  });

  it("versions the configuration: drafts are editable, activation retires the old version, history is immutable, all audited", async () => {
    const draft = await createHealthConfigDraft(hq, permissions, audit, db, defaultHealthConfig, `itest ${tag}`);
    createdConfigIds.push(draft.id);
    expect(draft.status).toBe("draft");

    const edited = { ...defaultHealthConfig, thresholds: { green: 80, amber: 40 } };
    const updated = await updateHealthConfigDraft(hq, permissions, audit, db, draft.id, edited, null);
    expect(updated.config.thresholds).toEqual({ green: 80, amber: 40 });

    const activated = await activateHealthConfigVersion(hq, permissions, audit, db, draft.id);
    expect(activated).toMatchObject({ status: "active", activatedByUserId: fixtureIds.users.superAdmin });
    const active = await db.select().from(healthScoreConfigs).where(eq(healthScoreConfigs.status, "active"));
    expect(active.map((row) => row.id)).toEqual([draft.id]);
    expect((await db.select().from(healthScoreConfigs).where(eq(healthScoreConfigs.id, originalActiveId!)))[0]!.status).toBe("retired");

    await expect(updateHealthConfigDraft(hq, permissions, audit, db, draft.id, defaultHealthConfig, null)).rejects.toBeInstanceOf(AnalyticsStateError);
    await expect(activateHealthConfigVersion(hq, permissions, audit, db, draft.id)).rejects.toBeInstanceOf(AnalyticsStateError);
    expect(events.map((event) => event.action)).toEqual(["analytics.health_config.create", "analytics.health_config.update", "analytics.health_config.activate"]);
  });

  it("rejects invalid configuration and callers without the manage grant", async () => {
    await expect(createHealthConfigDraft(hq, permissions, audit, db, { factors: [], thresholds: { green: 10, amber: 90 } }, null)).rejects.toBeInstanceOf(HealthConfigValidationError);
    await expect(createHealthConfigDraft(franchisee, permissions, audit, db, defaultHealthConfig, null)).rejects.toBeInstanceOf(AnalyticsAccessError);
    await expect(activateHealthConfigVersion(franchisee, permissions, audit, db, originalActiveId!)).rejects.toBeInstanceOf(AnalyticsAccessError);
  });

  it("activates a draft only once under concurrency", async () => {
    const draft = await createHealthConfigDraft(hq, permissions, audit, db, defaultHealthConfig, `race ${tag}`);
    createdConfigIds.push(draft.id);
    const results = await Promise.allSettled([activateHealthConfig(db, draft.id, fixtureIds.users.superAdmin), activateHealthConfig(db, draft.id, fixtureIds.users.superAdmin)]);
    const winners = results.filter((result) => result.status === "fulfilled" && result.value !== undefined);
    expect(winners).toHaveLength(1);
    expect(await db.select().from(healthScoreConfigs).where(eq(healthScoreConfigs.status, "active"))).toHaveLength(1);
  });
});
