import { randomUUID } from "node:crypto";
import { advertiserActivityEvents, advertiserContacts, advertiserImports, advertisers, auditEvents, audienceContacts, createDb, fixtureIds, opportunities, organisations, pipelineStages } from "@raring2go/db";
import { and, count, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { commitAdvertiserImport, listAdvertiserImports, previewAdvertiserImport, readAdvertiserImport, readAdvertiserImportReport, rollbackAdvertiserImport, AdvertiserImportFileError } from "./advertiser-import-runtime";
import { withFinanceGuardsDisabled } from "./finance-test-support";

/** Real database: a list of advertisers is checked, applied and reversed safely, inside the territory. `RUN_DB_TESTS=1` */
describe.skipIf(!process.env.RUN_DB_TESTS)("advertiser import (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const sutton = fixtureIds.territories.suttonColdfield;
  const staff = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: sutton };
  const solihull = { ...staff, territoryId: fixtureIds.territories.solihull as string };
  const staffAny = staff as { userId: string; organisationId: string; territoryId: string };
  const importIds: string[] = [];

  afterAll(async () => {
    const created = await db.select({ id: advertisers.id, org: advertisers.advertiserOrganisationId }).from(advertisers).where(like(advertisers.source, "import:%"));
    const mine = created.filter(() => true);
    const ids = mine.map((row) => row.id);
    const orgs = await db.select({ id: organisations.id }).from(organisations).where(like(organisations.name, `%${tag}%`));
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(inArray(auditEvents.entityId, importIds));
    });
    const tagged = await db.select({ id: advertisers.id }).from(advertisers).where(inArray(advertisers.advertiserOrganisationId, orgs.map((o) => o.id)));
    const advIds = tagged.map((row) => row.id);
    void ids;
    if (advIds.length) {
      await db.delete(opportunities).where(inArray(opportunities.advertiserId, advIds));
      await db.delete(advertiserActivityEvents).where(inArray(advertiserActivityEvents.advertiserId, advIds));
      await db.delete(advertiserContacts).where(inArray(advertiserContacts.advertiserId, advIds));
      await db.delete(advertisers).where(inArray(advertisers.id, advIds));
    }
    if (orgs.length) await db.delete(organisations).where(inArray(organisations.id, orgs.map((o) => o.id)));
    if (importIds.length) await db.delete(advertiserImports).where(inArray(advertiserImports.id, importIds));
    await sql.end();
  });

  const file = (rows: string[]) => `Business Name,Contact,Email,Phone,Tags,Notes\n${rows.join("\n")}\n`;
  const preview = (text: string, actor: { userId: string; organisationId: string; territoryId: string } = staff, territoryId: string = sutton) => previewAdvertiserImport(actor, { territoryId, source: "Autumn fair list", fileName: "list.csv", text });

  it("checks a file without changing anything, applies it, and refuses a repeat", async () => {
    const text = file([`Cafe Alpha ${tag},Pat,pat-${tag}@example.test,0121 000 0000,"cafe; family",Met at the fair`, `Bakery Beta ${tag},,,,,`, ",Nobody,,,,", `Bad ${tag},Sam,not-an-email,,,`, `cafe   alpha ${tag},Dup,,,,`]);
    const before = await db.select({ n: count() }).from(advertisers);
    const created = await preview(text);
    importIds.push(created.id);
    expect(created.existing).toBe(false);
    expect((await db.select({ n: count() }).from(advertisers))[0]!.n).toBe(before[0]!.n);
    expect((await preview(text)).id).toBe(created.id); // the same file again is the same import

    const view = await readAdvertiserImport(staff, created.id);
    expect(view.summary).toMatchObject({ total: 5, create: 2, rejected: 3 });
    expect(view.sample.map((s) => s.outcome)).toEqual(["create", "create", "reject_missing_name", "reject_invalid_email", "reject_duplicate_in_file"]);
    expect(view.hasReport).toBe(true);
    expect(await readAdvertiserImportReport(staff, created.id)).toContain("reject_invalid_email");

    const audienceBefore = (await db.select({ n: count() }).from(audienceContacts))[0]!.n;
    const applied = await commitAdvertiserImport(staff, created.id);
    expect(applied).toMatchObject({ alreadyDone: false, created: 2, rejected: 3 });
    expect(await commitAdvertiserImport(staff, created.id)).toMatchObject({ alreadyDone: true });
    // Parents' audience is a different system: an advertiser import never touches it.
    expect((await db.select({ n: count() }).from(audienceContacts))[0]!.n).toBe(audienceBefore);

    const rows = await db.select().from(advertisers).where(eq(advertisers.source, `import:${created.id}`));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "prospect" && r.relationshipState === "new" && r.owningTerritoryId === sutton && r.accountOwnerUserId === null)).toBe(true);
    const alpha = rows.find((r) => (r.tags as string[]).includes("cafe"))!;
    expect(alpha.tags).toEqual(["cafe", "family"]);
    expect(alpha.commercialMetadata).toMatchObject({ internalNotes: "Met at the fair" });
    const contacts = await db.select().from(advertiserContacts).where(inArray(advertiserContacts.advertiserId, rows.map((r) => r.id)));
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ name: "Pat", email: `pat-${tag}@example.test`, isPrimary: true });
    const events = await db.select().from(advertiserActivityEvents).where(inArray(advertiserActivityEvents.advertiserId, rows.map((r) => r.id)));
    expect(events.every((e) => e.activityType === "imported")).toBe(true);

    const [record] = await db.select().from(advertiserImports).where(eq(advertiserImports.id, created.id));
    expect(record).toMatchObject({ status: "applied", createdCount: 2, rejectedCount: 3 });
    expect((record!.metadata as { rows?: unknown }).rows).toBeUndefined(); // the raw rows are dropped once applied

    // Existing businesses are never merged or overwritten: importing them again changes nothing.
    const again = await preview(file([`Cafe Alpha ${tag},Someone Else,,,,`, `Fresh ${tag},,,,,`]));
    importIds.push(again.id);
    expect((await readAdvertiserImport(staff, again.id)).summary).toMatchObject({ create: 1, rejected: 1 });
    const readded = await commitAdvertiserImport(staff, again.id);
    expect(readded).toMatchObject({ created: 1, rejected: 1 });
    expect(await db.select().from(advertiserContacts).where(and(eq(advertiserContacts.advertiserId, alpha.id), eq(advertiserContacts.name, "Someone Else")))).toEqual([]);
    importIds.length = 0;
    importIds.push(created.id, again.id);

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityId, created.id));
    expect(audit.map((a) => a.action).sort()).toEqual(["advertiser.import.commit", "advertiser.import.dry_run"]);
  });

  it("re-checks at the moment of applying, so a business added since the upload is left out", async () => {
    const created = await preview(file([`Racer ${tag},,,,,`, `Steady ${tag},,,,,`]));
    importIds.push(created.id);
    const [org] = await db.insert(organisations).values({ kind: "advertiser", name: `racer ${tag}` }).returning({ id: organisations.id });
    expect(org).toBeTruthy();
    const applied = await commitAdvertiserImport(staff, created.id);
    expect(applied).toMatchObject({ created: 1, rejected: 1 });
  });

  it("rolls back only what is still untouched, and says what it left", async () => {
    const created = await preview(file([`Untouched ${tag},,,,,`, `Touched ${tag},Owner,,,,`, `Sold ${tag},,,,,`]));
    importIds.push(created.id);
    await commitAdvertiserImport(staff, created.id);
    const rows = await db.select().from(advertisers).where(eq(advertisers.source, `import:${created.id}`));
    const orgs = await db.select().from(organisations).where(inArray(organisations.id, rows.map((r) => r.advertiserOrganisationId)));
    const byName = (name: string) => rows.find((r) => orgs.find((o) => o.id === r.advertiserOrganisationId)?.name === `${name} ${tag}`)!;
    // Someone has since added a contact to one and an opportunity to another.
    await db.insert(advertiserContacts).values({ advertiserId: byName("Touched").id, label: "Added later", name: "New person", role: "contact", isPrimary: false });
    const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.key, "lead"));
    await db.insert(opportunities).values({ advertiserId: byName("Sold").id, territoryId: sutton, stageId: stage!.id, source: "manual", title: "Full page", estimatedValueMinor: 1000 });

    expect(await rollbackAdvertiserImport(solihull, created.id).catch((e: Error) => e.message)).toMatch(/not found/i);
    const result = await rollbackAdvertiserImport(staff, created.id);
    expect(result).toMatchObject({ alreadyDone: false, removed: 1, leftAlone: 2 });
    expect(await rollbackAdvertiserImport(staff, created.id)).toMatchObject({ alreadyDone: true });
    const after = await db.select().from(advertisers).where(eq(advertisers.source, `import:${created.id}`));
    expect(after.filter((r) => r.deletedAt).map((r) => r.id)).toEqual([byName("Untouched").id]);
    const view = await readAdvertiserImport(staff, created.id);
    expect(view.record.status).toBe("rolled_back");
    expect(view.rollback).toEqual({ removed: 1, leftAlone: 2 });

    // The removed business's name is free again: a corrected file can bring it back.
    const again = await preview(file([`Untouched ${tag},,,,,`]));
    importIds.push(again.id);
    expect((await readAdvertiserImport(staff, again.id)).summary).toMatchObject({ create: 1, rejected: 0 });
    // Clean up the extra contact/opportunity rows' parents in afterAll (they hang off tagged advertisers).
  });

  it("keeps other territories out, and refuses bad files without echoing them", async () => {
    await expect(preview(file([`Nope ${tag},,,,,`]), solihull, sutton)).rejects.toThrow(/permission/i);
    await expect(preview(file([`Nope ${tag},,,,,`]), staffAny, fixtureIds.territories.solihull)).rejects.toThrow(/outside/i);
    await expect(previewAdvertiserImport(staff, { territoryId: sutton, source: " ", fileName: "x.csv", text: "business\nA" })).rejects.toBeInstanceOf(AdvertiserImportFileError);
    await expect(preview("email\nx@y.test")).rejects.toThrow(/no business name column/);
    await expect(preview("business\n")).rejects.toThrow(/no rows/);
    await expect(preview(`business\n${"x".repeat(2 * 1024 * 1024)}`)).rejects.toThrow(/larger than 1 MB/);
    const created = await preview(file([`Private ${tag},,,,,`]));
    importIds.push(created.id);
    await expect(readAdvertiserImport(solihull, created.id)).rejects.toThrow(/not found/i);
    await expect(commitAdvertiserImport(solihull, created.id)).rejects.toThrow(/not found/i);
    expect((await listAdvertiserImports(solihull)).some((r) => r.id === created.id)).toBe(false);
    expect((await listAdvertiserImports(staff)).some((r) => r.id === created.id)).toBe(true);
  });
});
