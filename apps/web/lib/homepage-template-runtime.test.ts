import { randomUUID } from "node:crypto";
import { auditEvents, createDb, fixtureIds, publicHomepageTemplates } from "@raring2go/db";
import { HomepageTemplateError, defaultHomepageSlots, getPublicHomepage } from "@raring2go/public";
import { eq, inArray, sql as rawSql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HomepageNotAllowedError, HomepageStateError, discardHomepageDraft, publishHomepageDraft, readHomepageTemplates, saveHomepageDraft, startHomepageDraftFrom } from "./homepage-template-runtime";
import { withFinanceGuardsDisabled } from "./finance-test-support";
import { slotsFromForm } from "../app/(app)/app/content/homepage/form";

const input = () => defaultHomepageSlots().map(({ kind, heading, visible, itemCount, source }) => ({ kind, heading, visible, itemCount, source }));

/** Real database: HQ edits the layout, publishing is versioned and immutable, and the public homepage follows it. `RUN_DB_TESTS=1` */
describe.skipIf(!process.env.RUN_DB_TESTS)("homepage template (postgres)", () => {
  const { db, sql } = createDb();
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, territoryId: null };
  const franchisee = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const touched: string[] = [];
  let before: Array<{ id: string; status: string }> = [];

  beforeAll(async () => {
    before = (await db.select({ id: publicHomepageTemplates.id, status: publicHomepageTemplates.status }).from(publicHomepageTemplates)).map((row) => ({ id: row.id, status: row.status }));
  });

  afterAll(async () => {
    // Put the table back exactly as found: remove what this test made and restore any real published layout it retired.
    await withFinanceGuardsDisabled(db, async () => {
      const rows = await db.select({ id: publicHomepageTemplates.id }).from(publicHomepageTemplates);
      const mine = rows.map((row) => row.id).filter((id) => !before.some((old) => old.id === id));
      if (mine.length) {
        await db.delete(auditEvents).where(inArray(auditEvents.entityId, mine));
        await db.delete(publicHomepageTemplates).where(inArray(publicHomepageTemplates.id, mine));
      }
      for (const old of before) await db.update(publicHomepageTemplates).set({ status: old.status }).where(eq(publicHomepageTemplates.id, old.id));
    });
    await sql.end();
  });

  const guard = (fn: () => Promise<unknown>) => fn().then(() => "ok", (error: unknown) => (error instanceof Error ? `${error.message} ${(error.cause as Error | undefined)?.message ?? ""}` : "other"));

  it("refuses anyone without the grant, and bad layouts", async () => {
    await expect(readHomepageTemplates(franchisee)).rejects.toBeInstanceOf(HomepageNotAllowedError);
    await expect(saveHomepageDraft(franchisee, input())).rejects.toBeInstanceOf(HomepageNotAllowedError);
    await expect(saveHomepageDraft(hq, input().filter((s) => s.kind !== "newsletter"))).rejects.toBeInstanceOf(HomepageTemplateError);
    await expect(saveHomepageDraft(hq, input().map((s) => (s.kind === "stories" ? { ...s, itemCount: 99 } : s)))).rejects.toMatchObject({ code: "slot_count" });
  });

  it("walks a layout from draft to live, keeps history, and the public homepage follows it", async () => {
    const first = await saveHomepageDraft(hq, input().map((s) => (s.kind === "stories" ? { ...s, heading: "Fresh from your area", itemCount: 2 } : s)).filter((s) => s.kind !== "competitions"), "first");
    touched.push(first.id);
    // Saving again updates the same draft instead of piling up versions.
    expect((await saveHomepageDraft(hq, input().map((s) => (s.kind === "stories" ? { ...s, heading: "Fresh from your area", itemCount: 2 } : s)).filter((s) => s.kind !== "competitions"), "first, edited")).id).toBe(first.id);
    let state = await readHomepageTemplates(hq);
    expect(state.draft).toMatchObject({ id: first.id, status: "draft", notes: "first, edited" });

    // A draft is not live: the public homepage still uses whatever was live before.
    const beforePublish = await getPublicHomepage(db, "sutton-coldfield");
    expect(beforePublish!.template.slots.find((s) => s.kind === "stories")!.heading).not.toBe("Fresh from your area");

    await publishHomepageDraft(hq, first.id);
    let home = await getPublicHomepage(db, "sutton-coldfield");
    expect(home!.template).toMatchObject({ origin: "published", version: first.version });
    expect(home!.template.slots.find((s) => s.kind === "stories")).toMatchObject({ heading: "Fresh from your area", itemCount: 2 });
    expect(home!.template.slots.some((s) => s.kind === "competitions")).toBe(false);
    expect(home!.stories.length).toBeLessThanOrEqual(2);
    expect(home!.competitions).toEqual([]);

    // A second version replaces it as live; the first is kept as history.
    const second = await saveHomepageDraft(hq, input().reverse().map((s) => (s.kind === "offers" ? { ...s, visible: false } : s)));
    touched.push(second.id);
    expect(second.version).toBe(first.version + 1);
    await publishHomepageDraft(hq, second.id);
    state = await readHomepageTemplates(hq);
    expect(state.live).toMatchObject({ id: second.id, status: "published" });
    expect(state.history.map((v) => [v.version, v.status])).toContainEqual([first.version, "retired"]);
    home = await getPublicHomepage(db, "sutton-coldfield");
    expect(home!.template.version).toBe(second.version);
    expect(home!.template.slots[0]!.kind).toBe("newsletter");
    expect(home!.template.slots.find((s) => s.kind === "offers")!.visible).toBe(false);
    expect(home!.offers).toEqual([]);

    // Bringing an old look back is a new version, never an edit.
    const third = await startHomepageDraftFrom(hq, first.id);
    touched.push(third.id);
    expect(third.version).toBe(second.version + 1);
    await expect(startHomepageDraftFrom(hq, first.id)).rejects.toMatchObject({ code: "draft_exists" });
    await discardHomepageDraft(hq, third.id);
    expect((await readHomepageTemplates(hq)).draft).toBeNull();
    await expect(publishHomepageDraft(hq, second.id)).rejects.toBeInstanceOf(HomepageStateError);
    await expect(discardHomepageDraft(hq, randomUUID())).rejects.toMatchObject({ code: "not_found" });
  });

  it("is protected in the database: a published or retired layout cannot be edited, deleted or revived", async () => {
    const live = (await readHomepageTemplates(hq)).live!;
    const retired = (await readHomepageTemplates(hq)).history.find((v) => v.status === "retired")!;
    expect(await guard(() => db.execute(rawSql`update public_homepage_templates set slots = '[]'::jsonb where id = ${live.id}`))).toMatch(/cannot be changed/);
    expect(await guard(() => db.execute(rawSql`update public_homepage_templates set version = 999 where id = ${live.id}`))).toMatch(/cannot be changed/);
    expect(await guard(() => db.execute(rawSql`delete from public_homepage_templates where id = ${live.id}`))).toMatch(/cannot be deleted/);
    expect(await guard(() => db.execute(rawSql`update public_homepage_templates set status = 'draft' where id = ${live.id}`))).toMatch(/can only be retired/);
    expect(await guard(() => db.execute(rawSql`update public_homepage_templates set status = 'published' where id = ${retired.id}`))).toMatch(/cannot be revived/);
  });

  it("falls back to the built-in layout when the live record is unusable, so the homepage never goes blank", async () => {
    const live = (await readHomepageTemplates(hq)).live!;
    await withFinanceGuardsDisabled(db, async () => {
      await db.execute(rawSql`update public_homepage_templates set slots = '[{"kind":"stories"}]'::jsonb where id = ${live.id}`);
    });
    const home = await getPublicHomepage(db, "sutton-coldfield");
    expect(home!.template.origin).toBe("default");
    expect(home!.template.slots.map((s) => s.kind)).toContain("hero");
  });

  it("reads the editor form safely: ids and labels from the form are ignored, order follows the position numbers", () => {
    const form = new FormData();
    const kinds = ["hero", "stories", "newsletter"];
    form.set("pos-hero", "2"); form.set("pos-stories", "1"); form.set("pos-newsletter", "3");
    for (const kind of kinds) { form.set(`heading-${kind}`, kind); form.set(`count-${kind}`, "1"); form.set(`source-${kind}`, "local_only"); form.set(`show-${kind}`, "on"); }
    form.set("id-stories", "evil"); form.set("commercialTreatment-stories", "standard");
    expect(slotsFromForm(form, kinds)).toEqual([
      { kind: "stories", heading: "stories", visible: true, itemCount: 1, source: "local_only" },
      { kind: "hero", heading: "hero", visible: true, itemCount: 1, source: "local_only" },
      { kind: "newsletter", heading: "newsletter", visible: true, itemCount: 1, source: "local_only" }
    ]);
  });
});
