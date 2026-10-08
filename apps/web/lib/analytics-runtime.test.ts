import { createDb, auditEvents, fixtureIds, franchiseHealthSnapshots, metricSnapshots } from "@raring2go/db";
import { and, eq, gte } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildJobRegistry, registeredJobKinds } from "./jobs-runtime";
import { analyticsPermissionData, generateSnapshotAsActor, hasAnalyticsCapability, hasNetworkAnalyticsAccess, readScorecardForActor, SNAPSHOT_METRICS_KIND } from "./analytics-runtime";

const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };

describe("analytics runtime permissions", () => {
  it("registers the snapshot job so it can run and be retried", () => {
    expect(registeredJobKinds).toContain(SNAPSHOT_METRICS_KIND);
    expect([...buildJobRegistry({} as never).kinds()]).toContain(SNAPSHOT_METRICS_KIND);
  });

  it("gives HQ network access to everything and a franchisee only their own scorecard", () => {
    expect(hasNetworkAnalyticsAccess(hq.userId)).toBe(true);
    expect(hasNetworkAnalyticsAccess(hq.userId, "healthConfigManage")).toBe(true);
    expect(hasNetworkAnalyticsAccess(hq.userId, "snapshotGenerate")).toBe(true);

    expect(hasAnalyticsCapability(sutton, "scorecardView")).toBe(true);
    expect(hasNetworkAnalyticsAccess(sutton.userId)).toBe(false);
    expect(hasAnalyticsCapability(sutton, "healthConfigManage")).toBe(false);
    expect(hasAnalyticsCapability(sutton, "snapshotGenerate")).toBe(false);
    expect(hasAnalyticsCapability({ userId: fixtureIds.users.advertiserUser }, "scorecardView")).toBe(false);
    expect(analyticsPermissionData.rolePermissions.every((grant) => grant.permission.module.startsWith("analytics."))).toBe(true);
  });
});

/** Real database: the audit row for a snapshot must actually insert. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("analytics runtime (postgres)", () => {
  const { db, sql } = createDb();
  const testDay = new Date("2001-03-04T10:00:00Z");
  const started = new Date();

  afterAll(async () => {
    const day = new Date("2001-03-04T00:00:00Z");
    await db.delete(franchiseHealthSnapshots).where(eq(franchiseHealthSnapshots.snapshotDate, day));
    await db.delete(metricSnapshots).where(eq(metricSnapshots.snapshotDate, day));
    await sql.end();
  });

  it("generates a snapshot for an HQ actor and audits it", async () => {
    const summary = await generateSnapshotAsActor(hq, testDay);
    expect(summary.territories).toBeGreaterThan(0);
    const events = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "analytics.snapshot.generate"), gte(auditEvents.createdAt, started)));
    expect(events.length).toBeGreaterThan(0);
  });

  it("refuses a franchisee generating a snapshot", async () => {
    await expect(generateSnapshotAsActor(sutton, testDay)).rejects.toThrow(/analytics\.snapshot\.generate/);
  });

  it("shows a franchisee only their own territory, with no peer territory in the payload", async () => {
    const { view } = await readScorecardForActor(sutton);
    expect(view.scope).toBe("territory");
    const text = JSON.stringify(view);
    expect(text).not.toContain(fixtureIds.territories.solihull);
    expect(text).not.toContain("Solihull");
  });
});
