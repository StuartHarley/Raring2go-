import { randomUUID } from "node:crypto";
import { advertisers, auditEvents, audienceContacts, createDb, fixtureIds, franchiseContacts, franchiseImports, franchises, organisations, territories } from "@raring2go/db";
import { count, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { FranchiseImportFileError, commitFranchiseImport, listFranchiseImports, previewFranchiseImport, readFranchiseImport, readFranchiseImportReport, rollbackFranchiseImport } from "./franchise-import-runtime";
import { withFinanceGuardsDisabled } from "./finance-test-support";

/** Real database: a list of franchises and territories is checked, applied and reversed safely, by head office only. `RUN_DB_TESTS=1` */
describe.skipIf(!process.env.RUN_DB_TESTS)("franchise import (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, territoryId: null };
  const franchisee = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const importIds: string[] = [];

  afterAll(async () => {
    const terrs = await db.select({ id: territories.id }).from(territories).where(like(territories.name, `%${tag}%`));
    const orgs = await db.select({ id: organisations.id }).from(organisations).where(like(organisations.name, `%${tag}%`));
    const terrIds = terrs.map((t) => t.id);
    const orgIds = orgs.map((o) => o.id);
    await withFinanceGuardsDisabled(db, async () => {
      if (importIds.length) await db.delete(auditEvents).where(inArray(auditEvents.entityId, importIds));
    });
    if (terrIds.length) await db.delete(advertisers).where(inArray(advertisers.owningTerritoryId, terrIds));
    if (orgIds.length) {
      const fr = await db.select({ id: franchises.id }).from(franchises).where(inArray(franchises.franchiseOrganisationId, orgIds));
      if (fr.length) {
        await db.delete(franchiseContacts).where(inArray(franchiseContacts.franchiseId, fr.map((f) => f.id)));
        await db.delete(franchises).where(inArray(franchises.id, fr.map((f) => f.id)));
      }
    }
    if (terrIds.length) await db.delete(territories).where(inArray(territories.id, terrIds));
    if (orgIds.length) await db.delete(organisations).where(inArray(organisations.id, orgIds));
    if (importIds.length) await db.delete(franchiseImports).where(inArray(franchiseImports.id, importIds));
    await sql.end();
  });

  const file = (rows: string[]) => `Territory Code,Territory Name,Franchise Name,Contact,Email,Phone,Launch Date,Renewal Date,Stage,Tags\n${rows.join("\n")}\n`;
  const preview = (text: string, actor = hq) => previewFranchiseImport(actor, { source: "Franchise register", fileName: "franchises.csv", text });

  it("checks a file without changing anything, applies it, and refuses a repeat", async () => {
    const text = file([
      `T1${tag},North ${tag},Raring2go North ${tag},Pat Lee,pat-${tag}@example.test,0121 000 0000,01/03/2025,2030-03-01,trading,"north; new"`,
      `T2${tag},South ${tag},Raring2go South ${tag},,,,,,onboarding,`,
      `,Nowhere ${tag},No Code ${tag},,,,,,,`,
      `T3${tag},Bad ${tag},Bad Mail ${tag},Sam,not-an-email,,,,,`,
      `T4${tag},Bad Dates ${tag},Bad Dates Ltd ${tag},,,,2025-02-30,,,`,
      `t1${tag},Dup ${tag},Dup Co ${tag},,,,,,,`,
      `SUT,Existing ${tag},Existing Code ${tag},,,,,,,`
    ]);
    const before = await db.select({ n: count() }).from(franchises);
    const created = await preview(text);
    importIds.push(created.id);
    expect(created.existing).toBe(false);
    expect((await db.select({ n: count() }).from(franchises))[0]!.n).toBe(before[0]!.n);
    expect((await preview(text)).id).toBe(created.id);

    const view = await readFranchiseImport(hq, created.id);
    expect(view.summary).toMatchObject({ total: 7, create: 2, rejected: 5 });
    expect(view.sample.map((s) => s.outcome)).toEqual(["create", "create", "reject_missing_field", "reject_invalid_email", "reject_invalid_date", "reject_duplicate_in_file", "reject_code_exists"]);
    expect(await readFranchiseImportReport(hq, created.id)).toContain("reject_invalid_date");

    const audienceBefore = (await db.select({ n: count() }).from(audienceContacts))[0]!.n;
    expect(await commitFranchiseImport(hq, created.id)).toMatchObject({ alreadyDone: false, created: 2, rejected: 5 });
    expect(await commitFranchiseImport(hq, created.id)).toMatchObject({ alreadyDone: true });
    expect((await db.select({ n: count() }).from(audienceContacts))[0]!.n).toBe(audienceBefore);

    const territoriesMade = await db.select().from(territories).where(like(territories.name, `%${tag}%`));
    expect(territoriesMade.map((t) => t.code).sort()).toEqual([`T1${tag}`, `T2${tag}`]);
    const north = territoriesMade.find((t) => t.code === `T1${tag}`)!;
    const [franchise] = await db.select().from(franchises).where(eq(franchises.primaryTerritoryId, north.id));
    expect(franchise).toMatchObject({ status: "active", lifecycleStage: "trading", onboardingStatus: "complete", primaryOwnerUserId: null, franchiseOrganisationId: north.franchiseOrganisationId });
    expect(franchise!.launchDate?.toISOString().slice(0, 10)).toBe("2025-03-01");
    expect(franchise!.tags).toEqual(["north", "new"]);
    const contacts = await db.select().from(franchiseContacts).where(eq(franchiseContacts.franchiseId, franchise!.id));
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ name: "Pat Lee", userId: null, isPrimary: true });
    const south = territoriesMade.find((t) => t.code === `T2${tag}`)!;
    expect((await db.select().from(franchises).where(eq(franchises.primaryTerritoryId, south.id)))[0]).toMatchObject({ lifecycleStage: "onboarding", onboardingStatus: "not_started" });

    const raw = await db.select().from(franchiseImports).where(eq(franchiseImports.id, created.id));
    expect(JSON.stringify(raw[0]!.metadata)).not.toContain("not-an-email"); // the raw rows are dropped once applied
    expect(raw[0]).toMatchObject({ status: "applied", createdCount: 2, rejectedCount: 5 });

    const actions = (await db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, created.id))).map((r) => r.action).sort();
    expect(actions).toEqual(["franchise.import.commit", "franchise.import.dry_run"]);
  });

  it("rolls back what is untouched and keeps what has been worked on", async () => {
    const created = await preview(file([`R1${tag},Keep ${tag},Keep Co ${tag},,,,,,,`, `R2${tag},Drop ${tag},Drop Co ${tag},Al,al-${tag}@example.test,,,,,`]));
    importIds.push(created.id);
    await commitFranchiseImport(hq, created.id);
    const keep = (await db.select().from(territories).where(eq(territories.code, `R1${tag}`)))[0]!;
    // Something else now refers to the first territory, so it is no longer the import's alone.
    const [advOrg] = await db.insert(organisations).values({ kind: "advertiser", name: `Neighbour ${tag}` }).returning();
    await db.insert(advertisers).values({ advertiserOrganisationId: advOrg!.id, owningTerritoryId: keep.id, status: "prospect", relationshipState: "new", source: "test", tags: [], commercialMetadata: {} });

    expect(await rollbackFranchiseImport(hq, created.id)).toMatchObject({ alreadyDone: false, removed: 1, leftAlone: 1 });
    expect(await rollbackFranchiseImport(hq, created.id)).toMatchObject({ alreadyDone: true });
    expect((await db.select().from(territories).where(eq(territories.id, keep.id)))[0]!.deletedAt).toBeNull();
    const dropped = (await db.select().from(territories).where(like(territories.code, `R2${tag}%`)))[0]!;
    expect(dropped.deletedAt).not.toBeNull();
    expect(dropped.code).toContain("~removed-");
    expect((await readFranchiseImport(hq, created.id)).rollback).toEqual({ removed: 1, leftAlone: 1 });

    // The freed code and name can be used by a corrected file.
    const again = await preview(file([`R2${tag},Drop ${tag},Drop Co ${tag},,,,,,,`]));
    importIds.push(again.id);
    expect((await readFranchiseImport(hq, again.id)).summary).toMatchObject({ create: 1, rejected: 0 });
  });

  it("is head office only: a franchisee cannot upload, read, list or apply, and gets file errors written for staff", async () => {
    await expect(preview(file([`X1${tag},X ${tag},X Co ${tag},,,,,,,`]), franchisee as never)).rejects.toThrow(/No permission grant/);
    const created = await preview(file([`X2${tag},Y ${tag},Y Co ${tag},,,,,,,`]));
    importIds.push(created.id);
    await expect(readFranchiseImport(franchisee as never, created.id)).rejects.toThrow(/not found/);
    await expect(commitFranchiseImport(franchisee as never, created.id)).rejects.toThrow(/not found/);
    await expect(readFranchiseImportReport(franchisee as never, created.id)).rejects.toThrow(/not found/);
    await expect(rollbackFranchiseImport(franchisee as never, created.id)).rejects.toThrow(/not found/);
    await expect(listFranchiseImports(franchisee as never)).rejects.toThrow(/No permission grant/);
    expect((await listFranchiseImports(hq)).some((row) => row.id === created.id)).toBe(true);
    expect((await db.select().from(franchiseImports).where(eq(franchiseImports.id, created.id)))[0]!.status).toBe("dry_run");

    await expect(previewFranchiseImport(hq, { source: "", fileName: "a.csv", text: "x" })).rejects.toBeInstanceOf(FranchiseImportFileError);
    await expect(previewFranchiseImport(hq, { source: "s", fileName: "a.csv", text: "territory,name\nA,B\n" })).rejects.toThrow(/territory code, territory name and franchise name/);
    await expect(previewFranchiseImport(hq, { source: "s", fileName: "a.csv", text: "x".repeat(600 * 1024) })).rejects.toThrow(/larger than 512 KB/);
  });
});
