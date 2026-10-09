import { randomUUID } from "node:crypto";
import { audienceConsentEvents, audienceContacts, audienceImports, audienceSuppressions, audienceTerritorySubscriptions, auditEvents, createDb, deleteAudienceContactsForTests, fixtureIds, territories } from "@raring2go/db";
import { loadMarketingData, previewSegmentDefinition } from "@raring2go/marketing";
import { loadPermissionData } from "@raring2go/permissions";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImportFileError, commitAudienceImport, previewAudienceImport, readAudienceImport, readImportReport, rollbackAudienceImport } from "./audience-import-runtime";

/** Real database: imports are dry-run first, never bypass consent, tenancy or suppression, and can be rolled back. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("audience import (postgres)", () => {
  const { db, sql } = createDb();
  const tag = randomUUID().slice(0, 8);
  const TERRITORY = "00000000-0000-4000-8000-0000000009a2";
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
  const sutton = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const addr = (name: string) => `${name}-${tag}@example.test`;
  const importIds: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);

  const csv = (rows: string[]) => `email,first_name,last_name,consent_date,consent_source,tags\n${rows.join("\n")}\n`;
  const standardFile = (variant = "") => csv([
    `${addr("new")}${variant},Nora,New,${recent},Autumn fair sign-up,"school, crafts"`,
    `${addr("nodate")}${variant},Nick,Nodate,,,`,
    `${addr("stale")}${variant},Sam,Stale,2020-01-01,Old list,`,
    `not-an-email,Bad,Row,${recent},Form,`,
    `${addr("new")}${variant},Nora,Again,${recent},Form,`
  ]);

  async function preview(text: string, overrides: Partial<{ basis: "consent_evidenced" | "no_consent_record"; territoryId: string; context: typeof hq | typeof sutton }> = {}) {
    const result = await previewAudienceImport(overrides.context ?? hq, { territoryId: overrides.territoryId ?? TERRITORY, source: `Test list ${tag}`, basis: overrides.basis ?? "consent_evidenced", fileName: "list.csv", text });
    if (!importIds.includes(result.id)) importIds.push(result.id);
    return result;
  }
  const contactsLike = () => db.select().from(audienceContacts).where(like(audienceContacts.emailNormalised, `%-${tag}%`));
  const subsOf = async (contactId: string) => db.select().from(audienceTerritorySubscriptions).where(eq(audienceTerritorySubscriptions.contactId, contactId));

  beforeAll(async () => {
    await db.insert(territories).values({ id: TERRITORY, code: "IMPORT-TESTS", name: "Import Tests (do not use)", status: "archived", franchiseOrganisationId: fixtureIds.organisations.franchise }).onConflictDoNothing();
  });

  afterAll(async () => {
    const mine = await contactsLike();
    await deleteAudienceContactsForTests(db, mine.map((contact) => contact.id));
    if (importIds.length) await db.delete(audienceImports).where(inArray(audienceImports.id, importIds));
    await sql.end();
  });

  it("rejects an unreadable file before storing anything", async () => {
    await expect(previewAudienceImport(hq, { territoryId: TERRITORY, source: "x", basis: "consent_evidenced", fileName: "a.csv", text: "name\nPat" })).rejects.toBeInstanceOf(ImportFileError);
    await expect(previewAudienceImport(hq, { territoryId: TERRITORY, source: " ", basis: "consent_evidenced", fileName: "a.csv", text: "email\na@b.test" })).rejects.toThrow(/where this list came from/);
    await expect(previewAudienceImport(hq, { territoryId: TERRITORY, source: "x", basis: "legitimate_interest" as never, fileName: "a.csv", text: "email\na@b.test" })).rejects.toThrow(/how this list was collected/);
    await expect(previewAudienceImport(hq, { territoryId: TERRITORY, source: "x", basis: "consent_evidenced", fileName: "a.csv", text: `email\n${"a".repeat(2 * 1024 * 1024)}@b.test` })).rejects.toThrow(/2 MB/);
  });

  it("dry-runs without touching the audience, then commits exactly what it planned, with consent provenance", async () => {
    const before = await contactsLike();
    const dry = await preview(standardFile());
    expect(await contactsLike()).toHaveLength(before.length);

    const detail = await readAudienceImport(hq, dry.id);
    expect(detail.summary).toMatchObject({ total: 5, newSubscribed: 1, newPending: 2, rejected: 2 });
    expect(detail.hasReport).toBe(true);
    const report = await readImportReport(hq, dry.id);
    expect(report).toContain("reject_invalid_email");
    expect(report).toContain("reject_duplicate_in_file");
    expect(report).toContain("create_pending");

    const [first, second] = await Promise.all([commitAudienceImport(hq, dry.id), commitAudienceImport(hq, dry.id)]);
    expect([first.alreadyDone, second.alreadyDone].sort()).toEqual([false, true]);

    const contacts = await contactsLike();
    expect(contacts).toHaveLength(before.length + 3);
    const subscribed = contacts.find((contact) => contact.emailNormalised === addr("new"))!;
    expect(subscribed).toMatchObject({ firstName: "Nora", emailStatus: "subscribed", tags: ["school", "crafts"], metadata: { source: "import", importId: dry.id } });
    expect((await subsOf(subscribed.id))[0]).toMatchObject({ status: "subscribed", source: `import:${dry.id}`, territoryId: TERRITORY });

    // Consent evidence is recorded with where it came from.
    const [consent] = await db.select().from(audienceConsentEvents).where(eq(audienceConsentEvents.contactId, subscribed.id));
    expect(consent).toMatchObject({ action: "granted", consentType: "email_marketing", source: `import:${dry.id}`, actorUserId: hq.userId });
    expect(consent!.evidence).toMatchObject({ importId: dry.id, consentSource: "Autumn fair sign-up", consentDate: recent, basis: "consent_evidenced" });

    // No evidence or stale evidence: on file, pending, no consent event, never subscribed.
    for (const name of ["nodate", "stale"]) {
      const contact = contacts.find((candidate) => candidate.emailNormalised === addr(name))!;
      expect(contact.emailStatus).toBe("unconfirmed");
      expect((await subsOf(contact.id))[0]).toMatchObject({ status: "pending_consent" });
      expect(await db.select().from(audienceConsentEvents).where(eq(audienceConsentEvents.contactId, contact.id))).toHaveLength(0);
    }

    const [stored] = await db.select().from(audienceImports).where(eq(audienceImports.id, dry.id));
    expect(stored).toMatchObject({ status: "committed", totalRows: 5, importedRows: 3, errorRows: 2 });
    // Raw rows (personal data) are dropped once applied; the report is kept.
    expect((stored!.metadata as { rows?: unknown }).rows).toBeUndefined();
    expect((stored!.metadata as { rejectReport?: string }).rejectReport).toContain("reject_invalid_email");

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityId, dry.id));
    expect(audit.map((event) => event.action)).toEqual(expect.arrayContaining(["marketing.audience.import.dry_run", "marketing.audience.import.commit"]));
  });

  it("is idempotent: the same file again returns the same import and adds nothing", async () => {
    const again = await preview(standardFile());
    expect(again.existing).toBe(true);
    const count = (await contactsLike()).length;
    await expect(commitAudienceImport(hq, again.id)).resolves.toMatchObject({ alreadyDone: true });
    expect(await contactsLike()).toHaveLength(count);
  });

  it("only the consented person is eligible to be emailed; pending people are not", async () => {
    const [data, permissions] = await Promise.all([loadMarketingData(db), loadPermissionData(db)]);
    const eligible = previewSegmentDefinition({ ...hq }, permissions, data, { territoryId: TERRITORY, definition: {} }).map((view) => view.contact.emailNormalised).filter((email) => email.endsWith(`-${tag}@example.test`));
    expect(eligible).toEqual([addr("new")]);
  });

  it("never revives a suppressed or unsubscribed person, including one suppressed after the dry run", async () => {
    const suppressed = randomUUID();
    const unsub = randomUUID();
    const racing = randomUUID();
    for (const [id, name] of [[suppressed, "suppressed"], [unsub, "unsub"], [racing, "racing"]] as const) {
      await db.insert(audienceContacts).values({ id, email: addr(name), emailNormalised: addr(name), emailStatus: name === "suppressed" ? "suppressed" : "subscribed", tags: [], metadata: {} });
    }
    await db.insert(audienceSuppressions).values({ id: randomUUID(), contactId: suppressed, emailNormalised: addr("suppressed"), territoryId: null, reason: "hard_bounce", source: "test", active: true, suppressedAt: new Date(), metadata: {} });
    await db.insert(audienceTerritorySubscriptions).values({ id: randomUUID(), contactId: unsub, territoryId: TERRITORY, status: "unsubscribed", source: "test", preferences: {}, unsubscribedAt: new Date() });

    const dry = await preview(csv([`${addr("suppressed")},A,B,${recent},Form,`, `${addr("unsub")},C,D,${recent},Form,`, `${addr("racing")},E,F,${recent},Form,`]));
    expect((await readAudienceImport(hq, dry.id)).summary).toMatchObject({ rejected: 2, addedToTerritory: 1 });

    // Between the dry run and the commit, the third person unsubscribes everywhere.
    await db.insert(audienceSuppressions).values({ id: randomUUID(), contactId: racing, emailNormalised: addr("racing"), territoryId: null, reason: "recipient_unsubscribe", source: "test", active: true, suppressedAt: new Date(), metadata: {} });
    await commitAudienceImport(hq, dry.id);

    for (const id of [suppressed, racing]) expect(await subsOf(id)).toHaveLength(0);
    expect((await subsOf(unsub))[0]!.status).toBe("unsubscribed");
  });

  it("adds an existing contact to the territory only with consent evidence, and leaves their record alone", async () => {
    const existing = randomUUID();
    await db.insert(audienceContacts).values({ id: existing, email: addr("existing"), emailNormalised: addr("existing"), firstName: "Keep", emailStatus: "subscribed", tags: ["mine"], metadata: {} });
    const dry = await preview(csv([`${addr("existing")},Overwrite,Attempt,${recent},Form,"other"`]));
    await commitAudienceImport(hq, dry.id);

    const [contact] = await db.select().from(audienceContacts).where(eq(audienceContacts.id, existing));
    expect(contact).toMatchObject({ firstName: "Keep", tags: ["mine"] });
    expect((await subsOf(existing))[0]).toMatchObject({ status: "subscribed", territoryId: TERRITORY });
  });

  it("keeps territories apart: another territory's staff cannot import here, or see, commit or reverse this import", async () => {
    await expect(preview(csv([`${addr("intruder")},A,B,${recent},Form,`]), { context: sutton })).rejects.toThrow();
    const dry = await preview(csv([`${addr("private")},A,B,${recent},Form,`]));
    for (const attempt of [() => readAudienceImport(sutton, dry.id), () => commitAudienceImport(sutton, dry.id), () => rollbackAudienceImport(sutton, dry.id), () => readImportReport(sutton, dry.id)]) {
      await expect(attempt()).rejects.toThrow(/not found/);
    }
    expect((await db.select().from(audienceImports).where(eq(audienceImports.id, dry.id)))[0]!.status).toBe("dry_run");
    expect((await contactsLike()).some((contact) => contact.emailNormalised === addr("intruder"))).toBe(false);

    // An import for the staff member's own territory works.
    const own = await previewAudienceImport(sutton, { territoryId: fixtureIds.territories.suttonColdfield, source: "Own list", basis: "no_consent_record", fileName: "own.csv", text: csv([`${addr("own")},A,B,,,`]) });
    importIds.push(own.id);
    expect(own.existing).toBe(false);
  });

  it("imports a no-consent list as pending for everyone, whatever dates the file contains", async () => {
    const dry = await preview(csv([`${addr("listed")},A,B,${recent},Form,`]), { basis: "no_consent_record" });
    await commitAudienceImport(hq, dry.id);
    const contact = (await contactsLike()).find((candidate) => candidate.emailNormalised === addr("listed"))!;
    expect((await subsOf(contact.id))[0]!.status).toBe("pending_consent");
    expect(await db.select().from(audienceConsentEvents).where(eq(audienceConsentEvents.contactId, contact.id))).toHaveLength(0);
  });

  it("rolls back: withdraws what the import created and appends to the consent history, once, and a corrected file can come back in", async () => {
    const dry = await preview(csv([`${addr("rb1")},A,B,${recent},Form,`, `${addr("rb2")},C,D,,,`, `${addr("rb3")},E,F,${recent},Form,`]));
    await commitAudienceImport(hq, dry.id);
    const byName = async (name: string) => (await contactsLike()).find((contact) => contact.emailNormalised === addr(name))!;
    const rb1 = await byName("rb1");
    const rb2 = await byName("rb2");
    const rb3 = await byName("rb3");

    // rb3 confirmed for themselves since, so the import no longer owns their subscription.
    await db.update(audienceTerritorySubscriptions).set({ source: "parent_account" }).where(eq(audienceTerritorySubscriptions.contactId, rb3.id));

    const first = await rollbackAudienceImport(hq, dry.id);
    expect(first).toMatchObject({ alreadyDone: false, subscriptionsWithdrawn: 2, leftAlone: 1 });
    await expect(rollbackAudienceImport(hq, dry.id)).resolves.toMatchObject({ alreadyDone: true });

    expect((await subsOf(rb1.id))[0]!.status).toBe("import_rolled_back");
    expect((await subsOf(rb2.id))[0]!.status).toBe("import_rolled_back");
    expect((await subsOf(rb3.id))[0]!.status).toBe("subscribed");

    // History is append-only: the grant is still there, with a withdrawal after it.
    const events = await db.select().from(audienceConsentEvents).where(eq(audienceConsentEvents.contactId, rb1.id));
    expect(events.map((event) => event.action).sort()).toEqual(["granted", "withdrawn"]);
    expect(events.find((event) => event.action === "withdrawn")).toMatchObject({ source: "import_rollback" });
    expect((await contactsLike()).some((contact) => contact.id === rb1.id)).toBe(true);

    // Not eligible any more, and not blocked as "previously unsubscribed".
    const [data, permissions] = await Promise.all([loadMarketingData(db), loadPermissionData(db)]);
    expect(previewSegmentDefinition({ ...hq }, permissions, data, { territoryId: TERRITORY, definition: {} }).some((view) => view.contact.id === rb1.id)).toBe(false);
    const again = await preview(csv([`${addr("rb1")},A,B,${recent},Form,`]));
    expect((await readAudienceImport(hq, again.id)).summary).toMatchObject({ addedToTerritory: 1, rejected: 0 });

    await expect(rollbackAudienceImport(hq, again.id)).rejects.toThrow(/Only a committed import/);
    // A rolled-back import cannot be applied again; the corrected file is a new import.
    await expect(commitAudienceImport(hq, dry.id)).rejects.toThrow(/Only a dry run/);
  });
});
