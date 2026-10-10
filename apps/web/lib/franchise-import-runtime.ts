import { createHash, randomUUID } from "node:crypto";
import { auditActions, recordAuditEvent } from "@raring2go/audit";
import { createDb, franchiseContacts, franchiseImports, franchises, organisations, territories } from "@raring2go/db";
import { FRANCHISE_IMPORT_MAX_BYTES, buildFranchiseRejectReport, parseFranchiseCsv, planFranchiseImport } from "@raring2go/franchise";
import type { FranchiseImportPlan, ParsedFranchiseRow } from "@raring2go/franchise";
import { evaluatePermission } from "@raring2go/permissions";
import { and, desc, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { getPermissionData } from "./permission-source";

export class FranchiseImportFileError extends Error {}

export type FranchiseImportActor = { userId: string; organisationId?: string | null; territoryId?: string | null };

type Db = ReturnType<typeof createDb>["db"];
type Row = typeof franchiseImports.$inferSelect;
type Created = { organisationIds: string[]; territoryIds: string[]; franchiseIds: string[]; contactIds: string[] };
type Meta = {
  rows?: ParsedFranchiseRow[];
  summary?: FranchiseImportPlan["summary"];
  rejectReport?: string;
  created?: Created;
  rollback?: { removed: number; leftAlone: number };
};
const metaOf = (row: Row) => row.metadata as Meta;

/** Head office only: the grant is network-scoped and is not given to franchise roles. An import never looks like it exists to anyone else. */
async function authorise(actor: FranchiseImportActor) {
  const permissions = await getPermissionData();
  const decision = evaluatePermission({ userId: actor.userId, module: "franchise.import", action: "manage", context: { organisationId: actor.organisationId ?? undefined, territoryId: actor.territoryId ?? undefined } }, permissions);
  if (!decision.allowed) throw new Error("No permission grant matched this request.");
}

/** Territory codes are unique across every territory ever created (including removed ones); franchise names are compared among live franchises. */
async function existing(db: Db) {
  const codes = (await db.select({ code: territories.code }).from(territories)).map((row) => row.code);
  const names = (await db.select({ name: organisations.name }).from(organisations).where(and(eq(organisations.kind, "franchise"), isNull(organisations.deletedAt)))).map((row) => row.name);
  return { existingTerritoryCodes: codes, existingFranchiseNames: names };
}

function audit(db: Parameters<typeof recordAuditEvent>[0], actor: FranchiseImportActor, action: string, id: string, after: Record<string, unknown>) {
  return recordAuditEvent(db, { action, actor: { type: "human", userId: actor.userId }, entity: { type: "franchise_import", id }, scope: { organisationId: actor.organisationId ?? undefined }, after });
}

export async function previewFranchiseImport(actor: FranchiseImportActor, input: { source: string; fileName: string; text: string }) {
  await authorise(actor);
  if (!input.source.trim()) throw new FranchiseImportFileError("Say where this list came from.");
  if (Buffer.byteLength(input.text, "utf8") > FRANCHISE_IMPORT_MAX_BYTES) throw new FranchiseImportFileError("That file is larger than 512 KB. Split it and import in parts.");
  const parsed = parseFranchiseCsv(input.text);
  if (parsed.fatal) throw new FranchiseImportFileError(parsed.fatal);
  if (parsed.rows.length === 0) throw new FranchiseImportFileError("The file has a header but no rows.");

  const { db, sql } = createDb();
  try {
    const fileHash = createHash("sha256").update(input.text).digest("hex");
    const [same] = await db.select({ id: franchiseImports.id }).from(franchiseImports).where(eq(franchiseImports.fileHash, fileHash));
    if (same) return { id: same.id, existing: true };
    const plan = planFranchiseImport({ rows: parsed.rows, ...(await existing(db)) });
    const [created] = await db.insert(franchiseImports).values({
      source: input.source.trim().slice(0, 200),
      fileName: input.fileName.slice(0, 200),
      fileHash,
      totalRows: plan.summary.total,
      rejectedCount: plan.summary.rejected,
      metadata: { rows: parsed.rows, summary: plan.summary } as never,
      createdByUserId: actor.userId
    }).returning({ id: franchiseImports.id });
    await audit(db, actor, auditActions.franchiseImportDryRun, created!.id, { rows: plan.summary.total, toCreate: plan.summary.create, rejected: plan.summary.rejected, source: input.source.trim().slice(0, 200) });
    return { id: created!.id, existing: false };
  } finally {
    await sql.end();
  }
}

async function authorisedImport(actor: FranchiseImportActor, db: Db, id: string) {
  try {
    await authorise(actor);
  } catch {
    throw new Error("Import was not found.");
  }
  const [row] = await db.select().from(franchiseImports).where(eq(franchiseImports.id, id));
  if (!row) throw new Error("Import was not found.");
  return row;
}

export async function readFranchiseImport(actor: FranchiseImportActor, id: string) {
  const { db, sql } = createDb();
  try {
    const record = await authorisedImport(actor, db, id);
    const meta = metaOf(record);
    // A dry run is re-planned now, so staff see what would happen today and not what would have happened at upload.
    const live = record.status === "dry_run" && meta.rows ? planFranchiseImport({ rows: meta.rows, ...(await existing(db)) }) : undefined;
    return {
      record,
      summary: live?.summary ?? meta.summary,
      sample: live?.rows.slice(0, 25).map((row) => ({ line: row.line, territoryCode: row.territoryCode, franchiseName: row.franchiseName, outcome: row.outcome, reason: row.reason })) ?? [],
      hasReport: live ? live.summary.rejected > 0 : Boolean(meta.rejectReport && meta.rejectReport.split("\n").length > 2),
      rollback: meta.rollback
    };
  } finally {
    await sql.end();
  }
}

export async function readFranchiseImportReport(actor: FranchiseImportActor, id: string) {
  const { db, sql } = createDb();
  try {
    const record = await authorisedImport(actor, db, id);
    const meta = metaOf(record);
    if (record.status === "dry_run" && meta.rows) return buildFranchiseRejectReport(planFranchiseImport({ rows: meta.rows, ...(await existing(db)) }));
    return meta.rejectReport ?? "line,territory_code,franchise,outcome,reason\n";
  } finally {
    await sql.end();
  }
}

/**
 * Applies a dry run. Rows are checked again against the territories and franchises as they are at this moment, so a code or name
 * added since the upload is left out rather than duplicated. Creates records only: no user, role, agreement, invoice or consent.
 */
export async function commitFranchiseImport(actor: FranchiseImportActor, id: string) {
  const { db, sql } = createDb();
  try {
    await authorisedImport(actor, db, id);
    return await db.transaction(async (tx) => {
      const [claimed] = await tx.update(franchiseImports).set({ status: "applying", updatedAt: new Date() }).where(and(eq(franchiseImports.id, id), eq(franchiseImports.status, "dry_run"))).returning();
      if (!claimed) return { alreadyDone: true as const, created: 0, rejected: 0 };
      const meta = metaOf(claimed);
      const plan = planFranchiseImport({ rows: meta.rows ?? [], ...(await existing(tx as never)) });
      const created: Created = { organisationIds: [], territoryIds: [], franchiseIds: [], contactIds: [] };
      for (const item of plan.rows.filter((row) => row.outcome === "create")) {
        const row = item.row;
        const resolved = item.resolved!;
        const organisationId = randomUUID();
        const territoryId = randomUUID();
        const franchiseId = randomUUID();
        await tx.insert(organisations).values({ id: organisationId, kind: "franchise", name: row.franchiseName });
        await tx.insert(territories).values({ id: territoryId, franchiseOrganisationId: organisationId, code: row.territoryCode, name: row.territoryName, status: "active" });
        await tx.insert(franchises).values({
          id: franchiseId, franchiseOrganisationId: organisationId, primaryTerritoryId: territoryId, primaryOwnerUserId: null, status: "active", lifecycleStage: resolved.lifecycle,
          launchDate: resolved.launchDate ? new Date(`${resolved.launchDate}T00:00:00Z`) : null, renewalDate: resolved.renewalDate ? new Date(`${resolved.renewalDate}T00:00:00Z`) : null,
          onboardingStatus: resolved.lifecycle === "trading" ? "complete" : "not_started", tags: row.tags
        });
        created.organisationIds.push(organisationId);
        created.territoryIds.push(territoryId);
        created.franchiseIds.push(franchiseId);
        if (row.contactName || row.contactEmail || row.phone) {
          const contactId = randomUUID();
          await tx.insert(franchiseContacts).values({ id: contactId, franchiseId, userId: null, label: "Primary contact", name: row.contactName, email: row.contactEmail, phone: row.phone, isPrimary: true });
          created.contactIds.push(contactId);
        }
      }
      const rejectReport = buildFranchiseRejectReport(plan);
      // The raw rows are dropped as soon as the import is applied; what stays is the report, the ids and the counts.
      await tx.update(franchiseImports).set({
        status: "applied", appliedAt: new Date(), appliedByUserId: actor.userId, createdCount: created.franchiseIds.length, rejectedCount: plan.summary.rejected, totalRows: plan.summary.total,
        metadata: { summary: plan.summary, rejectReport, created } as never, updatedAt: new Date()
      }).where(eq(franchiseImports.id, id));
      await audit(tx, actor, auditActions.franchiseImportCommit, id, { created: created.franchiseIds.length, contacts: created.contactIds.length, rejected: plan.summary.rejected });
      return { alreadyDone: false as const, created: created.franchiseIds.length, rejected: plan.summary.rejected };
    });
  } finally {
    await sql.end();
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * How many rows anywhere in the database point at these records, other than the rows the import itself made. Found from the
 * foreign keys themselves, so a table added later is covered without anyone remembering to list it here.
 */
async function dependantCount(tx: Tx, target: "territories" | "organisations" | "franchises", ids: string[], own: Record<string, string[]>) {
  if (ids.length === 0) return 0;
  const references = (await tx.execute(dsql`
    select cls.relname as tbl, att.attname as col
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f' and array_length(con.conkey, 1) = 1 and con.confrelid = ${`public.${target}`}::regclass
  `)) as unknown as Array<{ tbl: string; col: string }>;
  let total = 0;
  for (const { tbl, col } of references) {
    if (!/^[a-z0-9_]+$/.test(tbl) || !/^[a-z0-9_]+$/.test(col)) throw new Error("Unexpected table name.");
    const mine = own[tbl] ?? [];
    const uuids = (list: string[]) => dsql.join(list.map((value) => dsql`${value}::uuid`), dsql`, `);
    const excluding = mine.length > 0 ? dsql` and id not in (${uuids(mine)})` : dsql``;
    const rows = (await tx.execute(dsql`select count(*)::int as n from ${dsql.identifier(tbl)} where ${dsql.identifier(col)} in (${uuids(ids)})${excluding}`)) as unknown as Array<{ n: number }>;
    total += rows[0]?.n ?? 0;
  }
  return total;
}

/**
 * Reverses an applied import. A franchise is removed only if nothing but the import's own records refers to it, its territory or its
 * organisation (no agreement, user, edition, advertiser, invoice, anything) and it is still as the import left it. Otherwise it is kept
 * and counted as left alone. Removed territories give up their code (renamed) so a corrected file can bring them back.
 */
export async function rollbackFranchiseImport(actor: FranchiseImportActor, id: string) {
  const { db, sql } = createDb();
  try {
    await authorisedImport(actor, db, id);
    return await db.transaction(async (tx) => {
      const [claimed] = await tx.update(franchiseImports).set({ status: "rolling_back", updatedAt: new Date() }).where(and(eq(franchiseImports.id, id), eq(franchiseImports.status, "applied"))).returning();
      if (!claimed) return { alreadyDone: true as const, removed: 0, leftAlone: 0 };
      const meta = metaOf(claimed);
      const created = meta.created ?? { organisationIds: [], territoryIds: [], franchiseIds: [], contactIds: [] };
      const own = { franchises: created.franchiseIds, franchise_contacts: created.contactIds, territories: created.territoryIds };
      const removable: number[] = [];
      for (const [index, franchiseId] of created.franchiseIds.entries()) {
        const [record] = await tx.select().from(franchises).where(eq(franchises.id, franchiseId));
        const untouched = Boolean(record) && !record!.deletedAt && record!.status === "active" && record!.primaryOwnerUserId === null && record!.supportStatus === "standard"
          && (await dependantCount(tx, "franchises", [franchiseId], own)) === 0
          && (await dependantCount(tx, "territories", [created.territoryIds[index]!], own)) === 0
          && (await dependantCount(tx, "organisations", [created.organisationIds[index]!], own)) === 0;
        if (untouched) removable.push(index);
      }
      const now = new Date();
      for (const index of removable) {
        const territoryId = created.territoryIds[index]!;
        await tx.update(franchiseContacts).set({ deletedAt: now }).where(eq(franchiseContacts.franchiseId, created.franchiseIds[index]!));
        await tx.update(franchises).set({ deletedAt: now }).where(eq(franchises.id, created.franchiseIds[index]!));
        await tx.update(territories).set({ deletedAt: now, status: "removed", code: dsql`${territories.code} || '~removed-' || ${id.slice(0, 8)}` }).where(eq(territories.id, territoryId));
        await tx.update(organisations).set({ deletedAt: now }).where(inArray(organisations.id, [created.organisationIds[index]!]));
      }
      const leftAlone = created.franchiseIds.length - removable.length;
      await tx.update(franchiseImports).set({ status: "rolled_back", rolledBackAt: now, metadata: { ...meta, rollback: { removed: removable.length, leftAlone } } as never, updatedAt: now }).where(eq(franchiseImports.id, id));
      await audit(tx, actor, auditActions.franchiseImportRollback, id, { removed: removable.length, leftAlone });
      return { alreadyDone: false as const, removed: removable.length, leftAlone };
    });
  } finally {
    await sql.end();
  }
}

export async function listFranchiseImports(actor: FranchiseImportActor) {
  await authorise(actor);
  const { db, sql } = createDb();
  try {
    return await db.select().from(franchiseImports).orderBy(desc(franchiseImports.createdAt)).limit(100);
  } finally {
    await sql.end();
  }
}
