import { randomUUID } from "node:crypto";
import { auditEvents, createDb, editionPages, fixtureIds, editionContentItems, territoryEditionContent, editionPageRevisions, inventorySlots, preflightResults, magazineTemplateVersions, magazineTemplates, masterEditions, publicationOutputs, seasons, territoryEditions } from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { fileReferences } from "@raring2go/db";
import { afterAll, describe, expect, it } from "vitest";
import { resolveImageUrlsForRender, resolveSnapshotImages, listStudioImages, resolveStudioImage, uploadStudioImage } from "./studio-images";
import { generateEditionOutput } from "./edition-output";
import { createSlotsAsActor, readEditionInventory, retireSlotAsActor } from "./edition-inventory";
import { runBulkEditionAction, approvePageAsActor, readStudioPage, returnPageAsActor, runPreflightAsActor, savePageAsActor, snapshotFromForm, submitPageAsActor, assignPageAsActor, createLocalContentAsActor, movePageAsActor, readFlatplan, approveEditionAsActor, approveMasterAsActor, createFlatplanAsActor, createSeasonAsActor, generateEditionsAsActor, readSeasonPlanner, releaseEditionAsActor, reopenEditionAsActor, submitEditionAsActor, approveTemplateVersionAsActor, createTemplateAsActor, publishTemplateVersionAsActor, readTemplateLibrary, reviseTemplateAsActor } from "./edition-runtime";
import { withFinanceGuardsDisabled } from "./finance-test-support";

const spec = {
  size: "a4" as const, lockedElements: ["Masthead"], showPageNumber: true, showIssueDate: false,
  zones: [{ id: "headline", kind: "headline", x: "12", y: "12", width: "186", height: "30", maxCharacters: "60" }, { id: "body", kind: "copy" }, { id: "hero", kind: "image", x: "0", y: "50", width: "210", height: "100", minDpi: "300" }]
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
    expect(studio.layout?.zones.map((z) => z.id).sort()).toEqual(["body", "headline", "hero"]);
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

describe.skipIf(!process.env.RUN_DB_TESTS)("edition inventory slots (postgres)", () => {
  const { db, sql } = createDb();
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, territoryId: null };
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const solihull = { ...sutton, territoryId: fixtureIds.territories.solihull };
  const product = fixtureIds.commercialProducts.fullPageAdvert;
  const tag = randomUUID().slice(0, 8);
  let seasonId = "";

  afterAll(async () => {
    const editionIds = seasonId ? (await db.select({ id: territoryEditions.id }).from(territoryEditions).where(eq(territoryEditions.seasonId, seasonId))).map((e) => e.id) : [];
    const masters = seasonId ? (await db.select({ id: masterEditions.id }).from(masterEditions).where(eq(masterEditions.seasonId, seasonId))).map((m) => m.id) : [];
    const slots = editionIds.length ? await db.select({ id: inventorySlots.id }).from(inventorySlots).where(inArray(inventorySlots.territoryEditionId, editionIds)) : [];
    const pages = editionIds.length ? await db.select({ id: editionPages.id }).from(editionPages).where(inArray(editionPages.territoryEditionId, editionIds)) : [];
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(inArray(auditEvents.entityId, [...editionIds, ...masters, ...slots.map((s) => s.id), ...pages.map((p) => p.id)]));
    });
    if (editionIds.length) {
      await db.delete(inventorySlots).where(inArray(inventorySlots.territoryEditionId, editionIds));
      await db.delete(editionPageRevisions).where(inArray(editionPageRevisions.pageId, pages.map((p) => p.id)));
      await db.delete(editionPages).where(inArray(editionPages.territoryEditionId, editionIds));
      await db.delete(territoryEditionContent).where(inArray(territoryEditionContent.territoryEditionId, editionIds));
      await db.delete(territoryEditions).where(inArray(territoryEditions.id, editionIds));
    }
    if (seasonId) {
      const items = await db.select({ id: editionContentItems.id }).from(editionContentItems).where(eq(editionContentItems.title, `Slot content ${tag}`));
      if (items.length) await db.delete(editionContentItems).where(inArray(editionContentItems.id, items.map((i) => i.id)));
      await db.delete(masterEditions).where(eq(masterEditions.seasonId, seasonId));
      await db.delete(seasons).where(eq(seasons.id, seasonId));
    }
    await sql.end();
  });

  it("puts pages on sale, follows a reorder, blocks editorial on a sold page, and respects scope", async () => {
    seasonId = await createSeasonAsActor(hq, { key: `slot-${tag}`, name: `Slot ${tag}`, year: "2099", season: "autumn", accent: "#aa3300", pageCount: "8" });
    const master = (await readSeasonPlanner(hq)).find((e) => e.season.id === seasonId)!.masters[0]!.master;
    await approveMasterAsActor(hq, master.id);
    const [edition] = await generateEditionsAsActor(hq, master.id, [fixtureIds.territories.suttonColdfield]);
    await createFlatplanAsActor(hq, edition!.id);
    const pages = (await readFlatplan(sutton, edition!.id)).pages.map((p) => p.page);
    const page = (n: number) => pages.find((p) => p.pageNumber === n)!;

    const first = await createSlotsAsActor(hq, edition!.id, product, [page(3).id, page(5).id]);
    expect(first).toEqual({ created: 2, restored: 0, skipped: 0 });
    expect(await createSlotsAsActor(sutton, edition!.id, product, [page(3).id])).toEqual({ created: 0, restored: 0, skipped: 1 });
    await expect(createSlotsAsActor(hq, edition!.id, product, [page(1).id])).rejects.toThrow(/locked/);
    await expect(createSlotsAsActor(solihull, edition!.id, product, [page(4).id])).rejects.toThrow();

    let inventory = await readEditionInventory(sutton, edition!.id);
    expect(inventory.slots.map((s) => [s.pageNumber, s.status])).toEqual([[3, "available"], [5, "available"]]);
    expect(inventory.pages.find((p) => p.pageNumber === 1)).toMatchObject({ eligible: false, reason: "locked" });
    expect(inventory.pages.find((p) => p.pageNumber === 3)).toMatchObject({ sold: true });

    await movePageAsActor(sutton, edition!.id, page(3).id, "down");
    inventory = await readEditionInventory(sutton, edition!.id);
    expect(inventory.slots.map((s) => s.pageNumber)).toEqual([4, 5]);

    const { content } = await createLocalContentAsActor(sutton, edition!.id, { title: `Slot content ${tag}`, contentType: "article", headline: "H", body: "B" });
    await expect(assignPageAsActor(sutton, page(3).id, { assignedContentId: content.id })).rejects.toThrow(/on sale/);
    const slotId = (await db.select({ id: inventorySlots.id }).from(inventorySlots).where(eq(inventorySlots.editionPageId, page(3).id)))[0]!.id;
    await retireSlotAsActor(sutton, slotId);
    await assignPageAsActor(sutton, page(3).id, { assignedContentId: content.id });
    await expect(createSlotsAsActor(sutton, edition!.id, product, [page(3).id])).rejects.toThrow(/editorial/);
    await expect(retireSlotAsActor(solihull, slotId)).rejects.toThrow();
  });
});

const pngBytes = (w: number, h: number) => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

describe.skipIf(!process.env.RUN_DB_TESTS)("page studio images (postgres)", () => {
  const { db, sql } = createDb();
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, territoryId: null };
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const solihull = { ...sutton, territoryId: fixtureIds.territories.solihull };
  const tag = randomUUID().slice(0, 8);
  let seasonId = "";
  let templateId = "";
  const fileIds: string[] = [];
  const files = {
    storage: { key: "test", createUploadIntent: async (reference: never) => ({ reference, uploadUrl: "https://storage.test/put", headers: {}, expiresAt: new Date().toISOString() }), createDownloadIntent: async (reference: { id: string }) => ({ reference, downloadUrl: `https://cdn.test/${reference.id}?sig=1`, expiresAt: new Date().toISOString(), disposition: "inline" }) },
    scanner: { key: "test", scan: async (reference: { id: string }) => ({ fileId: reference.id, status: "clean" as const, providerKey: "test", scannedAt: new Date().toISOString() }) },
    fetch: (async () => new Response("", { status: 200 })) as typeof fetch
  };

  afterAll(async () => {
    const editionIds = seasonId ? (await db.select({ id: territoryEditions.id }).from(territoryEditions).where(eq(territoryEditions.seasonId, seasonId))).map((e) => e.id) : [];
    const masters = seasonId ? (await db.select({ id: masterEditions.id }).from(masterEditions).where(eq(masterEditions.seasonId, seasonId))).map((m) => m.id) : [];
    const versions = templateId ? (await db.select({ id: magazineTemplateVersions.id }).from(magazineTemplateVersions).where(eq(magazineTemplateVersions.templateId, templateId))).map((v) => v.id) : [];
    const pages = editionIds.length ? (await db.select({ id: editionPages.id }).from(editionPages).where(inArray(editionPages.territoryEditionId, editionIds))).map((p) => p.id) : [];
    const outputs = editionIds.length ? await db.select({ id: publicationOutputs.id, artifact: publicationOutputs.artifact }).from(publicationOutputs).where(inArray(publicationOutputs.territoryEditionId, editionIds)) : [];
    const outputFiles = outputs.map((o) => String(o.artifact.fileId)).filter(Boolean);
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(inArray(auditEvents.entityId, [...editionIds, ...masters, ...versions, ...pages, ...outputs.map((o) => o.id), ...(templateId ? [templateId] : [])]));
    });
    if (editionIds.length) {
      await db.delete(publicationOutputs).where(inArray(publicationOutputs.territoryEditionId, editionIds));
      if (pages.length) await db.delete(editionPageRevisions).where(inArray(editionPageRevisions.pageId, pages));
      await db.delete(preflightResults).where(inArray(preflightResults.territoryEditionId, editionIds));
      await db.delete(editionPages).where(inArray(editionPages.territoryEditionId, editionIds));
      await db.delete(territoryEditions).where(inArray(territoryEditions.id, editionIds));
    }
    if (fileIds.length || outputFiles.length) await db.delete(fileReferences).where(inArray(fileReferences.id, [...fileIds, ...outputFiles]));
    if (seasonId) {
      await db.delete(masterEditions).where(eq(masterEditions.seasonId, seasonId));
      await db.delete(seasons).where(eq(seasons.id, seasonId));
    }
    if (templateId) {
      await db.delete(magazineTemplateVersions).where(eq(magazineTemplateVersions.templateId, templateId));
      await db.delete(magazineTemplates).where(eq(magazineTemplates.id, templateId));
    }
    await sql.end();
  });

  it("uploads, lists and resolves images within the edition's territory, reads the size from the file, and refuses fakes and other territories", async () => {
    templateId = await createTemplateAsActor(hq, { key: `img-${tag}`, name: "Img", category: "article", spec });
    const version = (await readTemplateLibrary(hq)).find((t) => t.template.id === templateId)!.versions[0]!.version.id;
    await approveTemplateVersionAsActor(hq, version);
    await publishTemplateVersionAsActor(hq, version);
    seasonId = await createSeasonAsActor(hq, { key: `img-${tag}`, name: `Img ${tag}`, year: "2099", season: "autumn", accent: "#aa3300", pageCount: "8" });
    const master = (await readSeasonPlanner(hq)).find((e) => e.season.id === seasonId)!.masters[0]!.master;
    await approveMasterAsActor(hq, master.id);
    const [edition] = await generateEditionsAsActor(hq, master.id, [fixtureIds.territories.suttonColdfield]);
    await createFlatplanAsActor(hq, edition!.id);
    const page = (await readFlatplan(sutton, edition!.id)).pages.find((p) => p.page.pageNumber === 3)!.page;
    await assignPageAsActor(sutton, page.id, { templateVersionId: version });

    const good = await uploadStudioImage(sutton, edition!.id, { fileName: "hero.png", contentType: "image/png", bytes: pngBytes(2480, 1200) }, files as never);
    fileIds.push(good.fileId);
    expect(good).toMatchObject({ widthPx: 2480, heightPx: 1200, fileName: "hero.png" });
    const hqUpload = await uploadStudioImage(hq, edition!.id, { fileName: "hq.png", contentType: "image/png", bytes: pngBytes(800, 600) }, files as never);
    fileIds.push(hqUpload.fileId);
    expect((await listStudioImages(sutton, edition!.id)).map((i) => i.fileId)).toEqual(expect.arrayContaining([good.fileId, hqUpload.fileId]));
    await expect(uploadStudioImage(sutton, edition!.id, { fileName: "x.png", contentType: "image/png", bytes: new TextEncoder().encode("<svg/>") }, files as never)).rejects.toThrow(/readable image/);
    await expect(uploadStudioImage(sutton, edition!.id, { fileName: "x.svg", contentType: "image/svg+xml", bytes: pngBytes(10, 10) }, files as never)).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(uploadStudioImage(sutton, edition!.id, { fileName: "big.png", contentType: "image/png", bytes: new Uint8Array(5 * 1024 * 1024) }, files as never)).rejects.toThrow(/4MB/);
    await expect(uploadStudioImage(solihull, edition!.id, { fileName: "x.png", contentType: "image/png", bytes: pngBytes(10, 10) }, files as never)).rejects.toThrow();
    await expect(listStudioImages(solihull, edition!.id)).rejects.toThrow();
    await expect(resolveStudioImage(solihull, edition!.id, good.fileId)).rejects.toThrow();

    // Saving takes the size from the stored file, ignoring anything the form said.
    const snapshot = await resolveSnapshotImages(sutton, edition!.id, { zones: { headline: "H", body: "B" }, images: { hero: { url: "", fileId: good.fileId, alt: "A hero", widthPx: 99999 } } });
    expect((snapshot.images as Record<string, unknown>).hero).toMatchObject({ fileId: good.fileId, widthPx: 2480, heightPx: 1200, alt: "A hero" });
    await expect(resolveSnapshotImages(sutton, edition!.id, { images: { hero: { fileId: randomUUID() } } })).rejects.toThrow(/not available/);
    await savePageAsActor(sutton, page.id, snapshot);

    // 2480px across 210mm is 300dpi: preflight passes. A 1000px image across the same zone does not.
    expect((await runPreflightAsActor(hq, page.id)).status).toBe("passed");
    const low = await uploadStudioImage(sutton, edition!.id, { fileName: "low.png", contentType: "image/png", bytes: pngBytes(1000, 500) }, files as never);
    fileIds.push(low.fileId);
    await savePageAsActor(sutton, page.id, await resolveSnapshotImages(sutton, edition!.id, { zones: { headline: "H", body: "B" }, images: { hero: { url: "", fileId: low.fileId } } }));
    const failed = await runPreflightAsActor(hq, page.id);
    expect(failed.status).toBe("failed");
    expect(failed.checks.map((c) => c.code)).toContain("low_resolution");
    expect(failed.unfixableIssues.map((c) => c.code)).toContain("low_resolution");

    // Render addresses: only this territory's clean files, as short-lived links.
    const urls = await resolveImageUrlsForRender(fixtureIds.territories.suttonColdfield, [good.fileId], { storage: files.storage as never });
    expect(urls[good.fileId]).toMatch(/^https:\/\/cdn\.test\//);
    await expect(resolveImageUrlsForRender(fixtureIds.territories.solihull, [good.fileId], { storage: files.storage as never })).rejects.toThrow(/does not belong/);
    await expect(resolveImageUrlsForRender(fixtureIds.territories.suttonColdfield, [randomUUID()], { storage: files.storage as never })).rejects.toThrow(/missing/);
  });
});
