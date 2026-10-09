import { randomUUID } from "node:crypto";
import { auditEvents, createDb, fixtureIds, magazineTemplateVersions, magazineTemplates } from "@raring2go/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { approveTemplateVersionAsActor, createTemplateAsActor, publishTemplateVersionAsActor, readTemplateLibrary, reviseTemplateAsActor } from "./edition-runtime";
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
