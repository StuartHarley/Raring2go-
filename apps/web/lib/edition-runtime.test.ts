import { randomUUID } from "node:crypto";
import { auditEvents, createDb, editionPages, fixtureIds, magazineTemplateVersions, magazineTemplates, masterEditions, publicationOutputs, seasons, territoryEditions } from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { approveEditionAsActor, approveMasterAsActor, createFlatplanAsActor, createSeasonAsActor, generateEditionsAsActor, readSeasonPlanner, releaseEditionAsActor, reopenEditionAsActor, submitEditionAsActor, approveTemplateVersionAsActor, createTemplateAsActor, publishTemplateVersionAsActor, readTemplateLibrary, reviseTemplateAsActor } from "./edition-runtime";
import { withFinanceGuardsDisabled } from "./finance-test-support";

const spec = {
  size: "a4" as const, lockedElements: ["Masthead"], showPageNumber: true, showIssueDate: false,
  zones: [{ id: "headline", kind: "headline", x: "12", y: "12", width: "186", height: "30", maxCharacters: "60" }, { id: "body", kind: "copy" }]
};

describe.skipIf(!process.env.RUN_DB_TESTS)("template library lifecycle (postgres)", () => {
  const { db, sql } = createDb();
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, territoryId: null };
  const franchisee = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const tag = randomUUID().slice(0, 8);
  const templateIds: string[] = [];

  afterAll(async () => {
    const versions = templateIds.length ? await db.select({ id: magazineTemplateVersions.id }).from(magazineTemplateVersions).where(inArray(magazineTemplateVersions.templateId, templateIds)) : [];
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(inArray(auditEvents.entityId, [...templateIds, ...versions.map((v) => v.id)]));
    });
    if (templateIds.length) {
      await db.delete(magazineTemplateVersions).where(inArray(magazineTemplateVersions.templateId, templateIds));
      await db.delete(magazineTemplates).where(inArray(magazineTemplates.id, templateIds));
    }
    await sql.end();
  });

  it("creates, revises, approves and publishes, with versions kept and immutable once published", async () => {
    const id = await createTemplateAsActor(hq, { key: `lib-${tag}`, name: "Library test", category: "article", spec });
    templateIds.push(id);
    let entry = (await readTemplateLibrary(hq)).find((candidate) => candidate.template.id === id)!;
    expect(entry.versions.map((v) => v.version.status)).toEqual(["draft"]);
    await approveTemplateVersionAsActor(hq, entry.versions[0]!.version.id);
    await publishTemplateVersionAsActor(hq, entry.versions[0]!.version.id);
    await reviseTemplateAsActor(hq, id, { ...spec, lockedElements: ["Masthead", "Footer"] });
    entry = (await readTemplateLibrary(hq)).find((candidate) => candidate.template.id === id)!;
    expect(entry.versions.map((v) => [v.version.version, v.version.status])).toEqual([[2, "draft"], [1, "published"]]);
    expect(entry.versions[1]!.version.lockedElements).toHaveLength(1);
    expect(entry.versions[0]!.version.lockedElements).toHaveLength(2);
    await expect(approveTemplateVersionAsActor(hq, entry.versions[1]!.version.id)).rejects.toThrow(/draft/);
  });

  it("refuses duplicate keys, bad zones and callers without the grant", async () => {
    const id = await createTemplateAsActor(hq, { key: `dup-${tag}`, name: "Dup", category: "article", spec });
    templateIds.push(id);
    await expect(createTemplateAsActor(hq, { key: `dup-${tag}`, name: "Dup", category: "article", spec })).rejects.toThrow(/already exists/);
    await expect(createTemplateAsActor(hq, { key: `bad-${tag}`, name: "Bad", category: "article", spec: { ...spec, zones: [{ id: "x", kind: "copy", x: "300", y: "0", width: "10", height: "10" }] } })).rejects.toThrow(/outside the trim|from 0 to/);
    await expect(createTemplateAsActor(franchisee, { key: `fr-${tag}`, name: "No", category: "article", spec })).rejects.toThrow(/permission/);
    await expect(readTemplateLibrary(franchisee)).rejects.toThrow(/permission/);
  });
});

describe.skipIf(!process.env.RUN_DB_TESTS)("season to publication lifecycle (postgres)", () => {
  const { db, sql } = createDb();
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, territoryId: null };
  const franchisee = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const tag = randomUUID().slice(0, 8);
  const key = `life-${tag}`;
  let seasonId = "";

  afterAll(async () => {
    const [season] = seasonId ? await db.select().from(seasons).where(eq(seasons.id, seasonId)) : [];
    if (season) {
      const editions = await db.select({ id: territoryEditions.id }).from(territoryEditions).where(eq(territoryEditions.seasonId, seasonId));
      const masters = await db.select({ id: masterEditions.id }).from(masterEditions).where(eq(masterEditions.seasonId, seasonId));
      const editionIds = editions.map((e) => e.id);
      await withFinanceGuardsDisabled(db, async () => {
        await db.delete(auditEvents).where(inArray(auditEvents.entityId, [...editionIds, ...masters.map((m) => m.id)]));
      });
      if (editionIds.length) {
        await db.delete(publicationOutputs).where(inArray(publicationOutputs.territoryEditionId, editionIds));
        await db.delete(editionPages).where(inArray(editionPages.territoryEditionId, editionIds));
        await db.delete(territoryEditions).where(inArray(territoryEditions.id, editionIds));
      }
      await db.delete(masterEditions).where(eq(masterEditions.seasonId, seasonId));
      await db.delete(seasons).where(eq(seasons.id, seasonId));
    }
    await sql.end();
  });

  it("plans a season, generates territory editions and a flatplan, and walks the edition to publication", async () => {
    seasonId = await createSeasonAsActor(hq, { key, name: `Life ${tag}`, year: "2099", season: "autumn", accent: "#aa3300", pageCount: "8", publicationDate: "2099-09-01" });
    await expect(createSeasonAsActor(hq, { key, name: "Dup", year: "2099", season: "autumn", accent: "#aa3300", pageCount: "8" })).rejects.toThrow(/already exists/);
    let planner = (await readSeasonPlanner(hq)).find((entry) => entry.season.id === seasonId)!;
    const master = planner.masters[0]!.master;
    expect(master.status).toBe("draft");
    await expect(generateEditionsAsActor(hq, master.id, [fixtureIds.territories.suttonColdfield])).rejects.toThrow(/Approve the master/);
    await approveMasterAsActor(hq, master.id);
    const created = await generateEditionsAsActor(hq, master.id, [fixtureIds.territories.suttonColdfield]);
    expect(created).toHaveLength(1);
    expect(await generateEditionsAsActor(hq, master.id, [fixtureIds.territories.suttonColdfield])).toHaveLength(0);
    const editionId = created[0]!.id;

    await expect(submitEditionAsActor(hq, editionId)).rejects.toThrow(/flatplan/);
    const pages = await createFlatplanAsActor(hq, editionId);
    expect(pages).toHaveLength(8);
    await expect(createFlatplanAsActor(hq, editionId)).rejects.toThrow(/already exists/);
    await submitEditionAsActor(hq, editionId);
    await expect(approveEditionAsActor(hq, editionId)).rejects.toThrow(/ready/);
    await reopenEditionAsActor(hq, editionId, "Pages not ready");
    await db.update(editionPages).set({ readiness: "ready", status: "approved" }).where(eq(editionPages.territoryEditionId, editionId));
    await submitEditionAsActor(hq, editionId);
    await approveEditionAsActor(hq, editionId);
    await expect(releaseEditionAsActor(hq, editionId)).rejects.toThrow(/digital edition/);
    await db.insert(publicationOutputs).values({ territoryEditionId: editionId, outputType: "digital", status: "generated", version: 1, idempotencyKey: `life-${tag}`, artifact: {} });
    await db.update(territoryEditions).set({ digitalStatus: "generated" }).where(eq(territoryEditions.id, editionId));
    const published = await releaseEditionAsActor(hq, editionId);
    expect(published.status).toBe("published");
    const [row] = await db.select().from(territoryEditions).where(eq(territoryEditions.id, editionId));
    expect(row).toMatchObject({ status: "published" });
    const statuses = await db.select({ status: editionPages.status }).from(editionPages).where(eq(editionPages.territoryEditionId, editionId));
    expect(new Set(statuses.map((p) => p.status))).toEqual(new Set(["published"]));
    planner = (await readSeasonPlanner(hq)).find((entry) => entry.season.id === seasonId)!;
    expect(planner.masters[0]!.editions).toHaveLength(1);
  });

  it("refuses a franchisee at every step", async () => {
    await expect(createSeasonAsActor(franchisee, { key: `fr-${tag}`, name: "No", year: "2099", season: "autumn", accent: "#aa3300", pageCount: "8" })).rejects.toThrow(/permission/);
    await expect(readSeasonPlanner(franchisee)).rejects.toThrow(/permission/);
  });
});
