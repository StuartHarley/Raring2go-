import { randomUUID } from "node:crypto";
import { auditEvents, createDb, editionPages, fixtureIds, editionContentItems, territoryEditionContent, editionPageRevisions, preflightResults, magazineTemplateVersions, magazineTemplates, masterEditions, publicationOutputs, seasons, territoryEditions } from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { runBulkEditionAction, approvePageAsActor, readStudioPage, returnPageAsActor, runPreflightAsActor, savePageAsActor, snapshotFromForm, submitPageAsActor, assignPageAsActor, createLocalContentAsActor, movePageAsActor, readFlatplan, approveEditionAsActor, approveMasterAsActor, createFlatplanAsActor, createSeasonAsActor, generateEditionsAsActor, readSeasonPlanner, releaseEditionAsActor, reopenEditionAsActor, submitEditionAsActor, approveTemplateVersionAsActor, createTemplateAsActor, publishTemplateVersionAsActor, readTemplateLibrary, reviseTemplateAsActor } from "./edition-runtime";
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

describe.skipIf(!process.env.RUN_DB_TESTS)("flatplan editing (postgres)", () => {
  const { db, sql } = createDb();
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, territoryId: null };
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const solihull = { ...sutton, territoryId: fixtureIds.territories.solihull };
  const tag = randomUUID().slice(0, 8);
  let seasonId = "";
  let templateId = "";

  afterAll(async () => {
    const editions = seasonId ? await db.select({ id: territoryEditions.id }).from(territoryEditions).where(eq(territoryEditions.seasonId, seasonId)) : [];
    const editionIds = editions.map((e) => e.id);
    const masters = seasonId ? await db.select({ id: masterEditions.id }).from(masterEditions).where(eq(masterEditions.seasonId, seasonId)) : [];
    const versions = templateId ? await db.select({ id: magazineTemplateVersions.id }).from(magazineTemplateVersions).where(eq(magazineTemplateVersions.templateId, templateId)) : [];
    const contents = editionIds.length ? await db.select().from(territoryEditionContent).where(inArray(territoryEditionContent.territoryEditionId, editionIds)) : [];
    const pageRows = editionIds.length ? await db.select({ id: editionPages.id }).from(editionPages).where(inArray(editionPages.territoryEditionId, editionIds)) : [];
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(inArray(auditEvents.entityId, [...editionIds, ...masters.map((m) => m.id), ...versions.map((v) => v.id), ...contents.map((c) => c.id), ...contents.map((c) => c.sourceContentItemId), ...pageRows.map((p) => p.id), ...(templateId ? [templateId] : [])]));
    });
    if (editionIds.length) {
      await db.delete(editionPageRevisions).where(inArray(editionPageRevisions.pageId, pageRows.map((p) => p.id)));
      await db.delete(preflightResults).where(inArray(preflightResults.territoryEditionId, editionIds));
      await db.delete(editionPages).where(inArray(editionPages.territoryEditionId, editionIds));
      await db.delete(territoryEditionContent).where(inArray(territoryEditionContent.territoryEditionId, editionIds));
      await db.delete(territoryEditions).where(inArray(territoryEditions.id, editionIds));
    }
    if (contents.length) await db.delete(editionContentItems).where(inArray(editionContentItems.id, contents.map((c) => c.sourceContentItemId)));
    await db.delete(masterEditions).where(eq(masterEditions.seasonId, seasonId));
    if (seasonId) await db.delete(seasons).where(eq(seasons.id, seasonId));
    if (templateId) {
      await db.delete(magazineTemplateVersions).where(eq(magazineTemplateVersions.templateId, templateId));
      await db.delete(magazineTemplates).where(eq(magazineTemplates.id, templateId));
    }
    await sql.end();
  });

  it("assigns a template and local content, reorders pages, and keeps the locked cover and other territories out", async () => {
    templateId = await createTemplateAsActor(hq, { key: `fp-${tag}`, name: "Flat", category: "article", spec });
    const version = (await readTemplateLibrary(hq)).find((t) => t.template.id === templateId)!.versions[0]!.version.id;
    await approveTemplateVersionAsActor(hq, version);
    await publishTemplateVersionAsActor(hq, version);
    seasonId = await createSeasonAsActor(hq, { key: `fp-${tag}`, name: `FP ${tag}`, year: "2099", season: "autumn", accent: "#aa3300", pageCount: "8" });
    const master = (await readSeasonPlanner(hq)).find((e) => e.season.id === seasonId)!.masters[0]!.master;
    await approveMasterAsActor(hq, master.id);
    const [edition] = await generateEditionsAsActor(hq, master.id, [fixtureIds.territories.suttonColdfield]);
    await createFlatplanAsActor(hq, edition!.id);

    let plan = await readFlatplan(sutton, edition!.id);
    expect(plan.pages).toHaveLength(8);
    expect(plan.templates.map((t) => t.id)).toContain(version);
    const { content } = await createLocalContentAsActor(sutton, edition!.id, { title: "Local feature", contentType: "article", headline: "Hello", body: "Body text" });
    const page3 = plan.pages.find((p) => p.page.pageNumber === 3)!.page;
    await assignPageAsActor(sutton, page3.id, { templateVersionId: version, assignedContentId: content.id });
    plan = await readFlatplan(sutton, edition!.id);
    expect(plan.pages.find((p) => p.page.id === page3.id)).toMatchObject({ templateName: expect.stringContaining("Flat v1"), contentTitle: "Local feature" });
    expect(plan.content[0]).toMatchObject({ title: "Local feature", usedOnPage: 3 });

    await movePageAsActor(sutton, edition!.id, page3.id, "down");
    plan = await readFlatplan(sutton, edition!.id);
    expect(plan.pages.find((p) => p.page.id === page3.id)!.page.pageNumber).toBe(4);
    const cover = plan.pages.find((p) => p.page.pageNumber === 1)!.page;
    await expect(movePageAsActor(sutton, edition!.id, cover.id, "down")).rejects.toThrow(/Locked/);
    await expect(assignPageAsActor(sutton, cover.id, { templateVersionId: version })).rejects.toThrow(/Locked/);

    // Page studio: edit, preflight, submit, HQ return and approve.
    const studio = await readStudioPage(sutton, edition!.id, page3.id);
    expect(studio.layout?.zones.map((z) => z.id).sort()).toEqual(["body", "headline"]);
    const form = new FormData();
    form.set("zone-headline", "Hello autumn");
    form.set("zone-body", "Some body text");
    form.set("zone-ignored", "not a zone");
    const snapshot = snapshotFromForm(form, studio.layout!.zones.map((z) => ({ id: z.id, kind: z.kind })));
    expect(snapshot).toEqual({ zones: { headline: "Hello autumn", body: "Some body text" }, images: {} });
    const bad = new FormData();
    bad.set("image-hero", "javascript:alert(1)");
    expect(() => snapshotFromForm(bad, [{ id: "hero", kind: "image" }])).toThrow(/https/);
    await savePageAsActor(sutton, page3.id, snapshot);
    await savePageAsActor(sutton, page3.id, { ...snapshot, zones: { headline: "Hello autumn again", body: "Some body text" } });
    const saved = await readStudioPage(sutton, edition!.id, page3.id);
    expect(saved.revisionCount).toBe(1);
    expect(saved.layout!.zones.find((z) => z.id === "headline")!.text).toBe("Hello autumn again");
    const result = await runPreflightAsActor(hq, page3.id);
    expect(result.status).toBe("passed");
    await submitPageAsActor(sutton, page3.id);
    await expect(approvePageAsActor(sutton, page3.id)).rejects.toThrow(/permission/);
    await returnPageAsActor(hq, page3.id, "Tighten the headline");
    expect((await readStudioPage(sutton, edition!.id, page3.id)).page.comments).toHaveLength(1);
    await submitPageAsActor(sutton, page3.id);
    await approvePageAsActor(hq, page3.id);
    expect((await readStudioPage(hq, edition!.id, page3.id)).page.status).toBe("approved");
    await expect(readStudioPage(solihull, edition!.id, page3.id)).rejects.toThrow();
    await expect(savePageAsActor(solihull, page3.id, snapshot)).rejects.toThrow();

    await expect(readFlatplan(solihull, edition!.id)).rejects.toThrow();
    await expect(assignPageAsActor(solihull, page3.id, { templateVersionId: version })).rejects.toThrow();
    await expect(createLocalContentAsActor(solihull, edition!.id, { title: "x", contentType: "article", headline: "", body: "" })).rejects.toThrow();
  });
});

describe.skipIf(!process.env.RUN_DB_TESTS)("bulk edition actions (postgres)", () => {
  const { db, sql } = createDb();
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, territoryId: null };
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const tag = randomUUID().slice(0, 8);
  let seasonId = "";

  afterAll(async () => {
    const editionIds = seasonId ? (await db.select({ id: territoryEditions.id }).from(territoryEditions).where(eq(territoryEditions.seasonId, seasonId))).map((e) => e.id) : [];
    const masters = seasonId ? (await db.select({ id: masterEditions.id }).from(masterEditions).where(eq(masterEditions.seasonId, seasonId))).map((m) => m.id) : [];
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(inArray(auditEvents.entityId, [...editionIds, ...masters]));
    });
    if (editionIds.length) {
      await db.delete(editionPages).where(inArray(editionPages.territoryEditionId, editionIds));
      await db.delete(territoryEditions).where(inArray(territoryEditions.id, editionIds));
    }
    if (seasonId) {
      await db.delete(masterEditions).where(eq(masterEditions.seasonId, seasonId));
      await db.delete(seasons).where(eq(seasons.id, seasonId));
    }
    await sql.end();
  });

  it("applies an action edition by edition: ready ones go through, the rest are skipped, and an unpermitted actor changes nothing", async () => {
    seasonId = await createSeasonAsActor(hq, { key: `bulk-${tag}`, name: `Bulk ${tag}`, year: "2099", season: "autumn", accent: "#aa3300", pageCount: "8" });
    const master = (await readSeasonPlanner(hq)).find((e) => e.season.id === seasonId)!.masters[0]!.master;
    await approveMasterAsActor(hq, master.id);
    const created = await generateEditionsAsActor(hq, master.id, [fixtureIds.territories.suttonColdfield, fixtureIds.territories.solihull]);
    expect(created).toHaveLength(2);
    await createFlatplanAsActor(hq, created[0]!.id);

    expect(await runBulkEditionAction(sutton, "submit", created.map((e) => e.id))).toEqual({ succeeded: 0, refused: 2 });
    expect(await runBulkEditionAction(hq, "submit", created.map((e) => e.id))).toEqual({ succeeded: 1, refused: 1 });
    expect(await runBulkEditionAction(hq, "approve", created.map((e) => e.id))).toEqual({ succeeded: 0, refused: 2 });
    const rows = await db.select({ id: territoryEditions.id, status: territoryEditions.status }).from(territoryEditions).where(inArray(territoryEditions.id, created.map((e) => e.id)));
    expect(rows.map((r) => r.status).sort()).toEqual(["draft", "review"]);
    expect(await runBulkEditionAction(hq, "digital", created.map((e) => e.id))).toEqual({ succeeded: 0, refused: 2 });
  });
});
