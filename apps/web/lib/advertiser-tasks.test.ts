import { randomUUID } from "node:crypto";
import { advertiserActivityEvents, advertiserTasks, advertisers, auditEvents, createDb, fixtureIds, opportunities, organisations, pipelineStages } from "@raring2go/db";
import { loadAdvertisingData } from "@raring2go/advertising";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { changeTaskRecord, createAdvertiserRecord, createOpportunityRecord, createTaskRecord, logActivityRecord } from "./advertising-mutations";
import { readMyOpenTasks, readPipeline } from "./advertising-runtime";
import { withFinanceGuardsDisabled } from "./finance-test-support";

/** Real database: tasks persist and are audited, scores use real activity, and everything stays in the territory. `RUN_DB_TESTS=1` */
describe.skipIf(!process.env.RUN_DB_TESTS)("advertiser tasks and opportunity scores (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const solihull = { ...sutton, territoryId: fixtureIds.territories.solihull };
  const advertiserIds: string[] = [];
  const organisationIds: string[] = [];
  const taskIds: string[] = [];

  afterAll(async () => {
    const opps = advertiserIds.length ? await db.select({ id: opportunities.id }).from(opportunities).where(inArray(opportunities.advertiserId, advertiserIds)) : [];
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(inArray(auditEvents.entityId, [...advertiserIds, ...taskIds, ...opps.map((o) => o.id)]));
    });
    if (advertiserIds.length) {
      await db.delete(advertiserTasks).where(inArray(advertiserTasks.advertiserId, advertiserIds));
      await db.delete(advertiserActivityEvents).where(inArray(advertiserActivityEvents.advertiserId, advertiserIds));
      await db.delete(opportunities).where(inArray(opportunities.advertiserId, advertiserIds));
      await db.delete(advertisers).where(inArray(advertisers.id, advertiserIds));
    }
    if (organisationIds.length) await db.delete(organisations).where(inArray(organisations.id, organisationIds));
    await sql.end();
  });

  it("persists tasks through their life, audits them, and shows a user's due tasks", async () => {
    const advertiser = await createAdvertiserRecord(sutton, { newOrganisationName: `Task Test ${tag}`, owningTerritoryId: sutton.territoryId });
    advertiserIds.push(advertiser.id);
    organisationIds.push(advertiser.advertiserOrganisationId);

    const overdue = await createTaskRecord(sutton, { advertiserId: advertiser.id, title: "Chase artwork", dueOn: "2020-01-01", notes: "  twice  " });
    const later = await createTaskRecord(sutton, { advertiserId: advertiser.id, title: "Quarterly catch-up", dueOn: "2099-01-01" });
    taskIds.push(overdue.id, later.id);
    const [row] = await db.select().from(advertiserTasks).where(eq(advertiserTasks.id, overdue.id));
    expect(row).toMatchObject({ title: "Chase artwork", notes: "twice", status: "open", assignedToUserId: sutton.userId, territoryId: sutton.territoryId });
    expect(row!.dueOn?.toISOString().slice(0, 10)).toBe("2020-01-01");

    const mine = await readMyOpenTasks(sutton);
    expect(mine.map((entry) => entry.task.id)).toEqual(expect.arrayContaining([overdue.id, later.id]));
    expect(mine.find((entry) => entry.task.id === overdue.id)!.advertiserName).toBe(`Task Test ${tag}`);

    await changeTaskRecord(sutton, overdue.id, "complete");
    const [done] = await db.select().from(advertiserTasks).where(eq(advertiserTasks.id, overdue.id));
    expect(done).toMatchObject({ status: "done", completedByUserId: sutton.userId });
    expect(done!.completedAt).toBeInstanceOf(Date);
    expect((await readMyOpenTasks(sutton)).map((entry) => entry.task.id)).not.toContain(overdue.id);
    await expect(changeTaskRecord(sutton, overdue.id, "complete")).rejects.toThrow(/cannot be completed/);
    await changeTaskRecord(sutton, overdue.id, "reopen");

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityId, advertiser.id));
    expect(audit.filter((event) => event.action === "advertiser.task.manage")).toHaveLength(4); // two creates, one completion, one reopen (the refused second completion is not audited)
  });

  it("scores real opportunities from real activity and overdue tasks, and keeps other territories out", async () => {
    const advertiser = await createAdvertiserRecord(sutton, { newOrganisationName: `Score Test ${tag}`, owningTerritoryId: sutton.territoryId });
    advertiserIds.push(advertiser.id);
    organisationIds.push(advertiser.advertiserOrganisationId);
    const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.key, "proposal"));
    const opportunity = await createOpportunityRecord(sutton, { advertiserId: advertiser.id, stageId: stage!.id, title: `Score deal ${tag}`, estimatedValueMinor: 300_000 });

    const scoreOf = async () => (await readPipeline(sutton)).stages.flatMap((s) => s.opportunities).find((view) => view.opportunity.id === opportunity.id)!.score!;
    const before = await scoreOf();
    expect(before.factors.find((f) => f.key === "recency")!.points).toBe(-15);
    expect(before.factors.find((f) => f.key === "value")!.points).toBe(10);

    await logActivityRecord(sutton, advertiser.id, { activityType: "call", title: "Rang about page 5" });
    const warmed = await scoreOf();
    expect(warmed.factors.find((f) => f.key === "recency")!.points).toBe(15);
    expect(warmed.score).toBe(before.score + 30);

    const late = await createTaskRecord(sutton, { advertiserId: advertiser.id, title: "Send media pack", dueOn: "2020-01-01" });
    taskIds.push(late.id);
    const penalised = await scoreOf();
    expect(penalised.factors.find((f) => f.key === "tasks")!.points).toBe(-5);
    expect(penalised.score).toBe(warmed.score - 5);

    // Counts reconcile: every open opportunity in the pipeline is in exactly one stage and has a score.
    const pipeline = await readPipeline(sutton);
    const data = await loadAdvertisingData(db);
    const openInTerritory = data.opportunities.filter((o) => !o.deletedAt && o.territoryId === sutton.territoryId && !data.pipelineStages.find((s) => s.id === o.stageId)!.isClosed);
    expect(pipeline.stages.reduce((sum, s) => sum + s.opportunities.length, 0)).toBe(openInTerritory.length);
    expect(pipeline.stages.flatMap((s) => s.opportunities).every((view) => view.score !== null)).toBe(true);

    // Another territory's user cannot add to, change or even see this advertiser's tasks.
    await expect(createTaskRecord(solihull, { advertiserId: advertiser.id, title: "Sneaky" })).rejects.toThrow();
    await expect(changeTaskRecord(solihull, late.id, "cancel")).rejects.toThrow();
    expect((await readMyOpenTasks(solihull).catch(() => [])).some((entry) => entry.task.id === late.id)).toBe(false);
  });
});
