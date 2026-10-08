import { fixtureIds } from "@raring2go/db";
import type { PermissionData } from "@raring2go/permissions";
import { describe, expect, it } from "vitest";
import { metricCatalogue } from "./catalogue";
import type { MetricValues } from "./catalogue";
import type { CollectedMetrics } from "./collect";
import { defaultHealthConfig } from "./health";
import type { HealthConfigRecord } from "./repository";
import { AnalyticsAccessError, buildScorecard } from "./service";

const permission = (id: string, module: string, action: string) => ({ id, module, action });
const view = permission(fixtureIds.permissions.scorecardView, "analytics.scorecard", "view");

const permissions: PermissionData = {
  roleAssignments: [
    { id: "a1", userId: fixtureIds.users.superAdmin, roleId: fixtureIds.roles.hqAdmin, organisationId: fixtureIds.organisations.hq },
    { id: "a2", userId: fixtureIds.users.franchisee, roleId: fixtureIds.roles.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield }
  ],
  rolePermissions: [
    { roleId: fixtureIds.roles.hqAdmin, permission: view, scope: "network", constraints: {} },
    { roleId: fixtureIds.roles.franchisee, permission: view, scope: "own_territory", constraints: {} }
  ]
};

const territoryIds = Array.from({ length: 7 }, (_, index) => (index === 0 ? fixtureIds.territories.suttonColdfield : `10000000-0000-4000-8000-00000000000${index}`));
const own = territoryIds[0]!;
const peerSecret = 987_654_321;

const metricsFor = (index: number): MetricValues => ({
  "commercial.bookings_value_30d": index === 1 ? peerSecret : (index + 1) * 10_000,
  "audience.subscribers": (index + 1) * 100,
  "franchise.overdue_compliance_actions": index
});

const collected: CollectedMetrics = {
  definitionsVersion: "test",
  collectedAt: new Date("2026-10-08T00:00:00Z"),
  territories: Object.fromEntries(territoryIds.map((id, index) => [id, metricsFor(index)])),
  network: { "commercial.bookings_value_30d": 1 }
};

const config: HealthConfigRecord = {
  id: "cfg", versionNumber: 3, status: "active", config: defaultHealthConfig, changeNote: null, createdByUserId: null, activatedByUserId: null, activatedAt: null, createdAt: new Date()
};
const cohort = territoryIds.map((id, index) => ({ id, name: `Territory ${index}` }));
const input = { collected, config, cohort };

describe("scorecard scoping", () => {
  it("gives Head Office the network figures, every territory and the health distribution", () => {
    const result = buildScorecard({ userId: fixtureIds.users.superAdmin }, permissions, input);
    expect(result.scope).toBe("network");
    expect(result.territories).toHaveLength(territoryIds.length);
    expect(result.distribution).toBeDefined();
    expect(result.metrics).toHaveLength(metricCatalogue.length);
    expect(result.benchmarks).toBeUndefined();
  });

  it("gives a franchisee only their own territory, their score and aggregate-only benchmarks", () => {
    const result = buildScorecard({ userId: fixtureIds.users.franchisee, territoryId: own }, permissions, input);
    expect(result.scope).toBe("territory");
    expect(result.territory?.id).toBe(own);
    expect(result.territories).toBeUndefined();
    expect(result.distribution).toBeUndefined();
    expect(result.health?.configVersion).toBe(3);
    expect(result.benchmarks?.length).toBeGreaterThan(0);
  });

  it("never exposes another territory's values, ids or names to a territory user", () => {
    const result = buildScorecard({ userId: fixtureIds.users.franchisee, territoryId: own }, permissions, input);
    const text = JSON.stringify(result);
    expect(text).not.toContain(String(peerSecret));
    for (const id of territoryIds.slice(1)) expect(text).not.toContain(id);
    for (const name of cohort.slice(1).map((entry) => entry.name)) expect(text).not.toContain(name);
  });

  it("refuses a territory user asking for a different territory", () => {
    expect(() => buildScorecard({ userId: fixtureIds.users.franchisee, territoryId: territoryIds[1] }, permissions, input)).toThrow(AnalyticsAccessError);
  });

  it("refuses a user with no scorecard grant, and a territory user with no territory", () => {
    expect(() => buildScorecard({ userId: fixtureIds.users.advertiserUser }, permissions, input)).toThrow(AnalyticsAccessError);
    expect(() => buildScorecard({ userId: fixtureIds.users.franchisee }, permissions, input)).toThrow(AnalyticsAccessError);
  });

  it("withholds benchmarks when too few peers exist", () => {
    const few = { ...input, collected: { ...collected, territories: Object.fromEntries(territoryIds.slice(0, 3).map((id, index) => [id, metricsFor(index)])) }, cohort: cohort.slice(0, 3) };
    const result = buildScorecard({ userId: fixtureIds.users.franchisee, territoryId: own }, permissions, few);
    expect(result.benchmarks?.every((benchmark) => benchmark.suppressed)).toBe(true);
  });
});
