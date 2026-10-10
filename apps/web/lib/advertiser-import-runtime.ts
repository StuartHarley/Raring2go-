import { createHash, randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { auditActions } from "@raring2go/audit";
import { advertiserActivityEvents, advertiserContacts, advertiserImports, advertisers, createDb, organisations } from "@raring2go/db";
import {
  ADVERTISER_IMPORT_MAX_BYTES,
  buildAdvertiserRejectReport,
  loadAdvertisingData,
  parseAdvertiserCsv,
  planAdvertiserImport
} from "@raring2go/advertising";
import type { AdvertiserImportPlan, ParsedAdvertiserRow } from "@raring2go/advertising";
import { evaluatePermission } from "@raring2go/permissions";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getPermissionData } from "./permission-source";

export class AdvertiserImportFileError extends Error {}

export type ImportActor = { userId: string; organisationId?: string | null; territoryId?: string | null };

type Db = ReturnType<typeof createDb>["db"];
type Row = typeof advertiserImports.$inferSelect;
type Meta = {
  rows?: ParsedAdvertiserRow[];
  summary?: AdvertiserImportPlan["summary"];
  rejectReport?: string;
  created?: { advertiserIds: string[]; organisationIds: string[]; contactIds: string[]; eventIds: string[] };
  rollback?: { removed: number; leftAlone: number };
};
const metaOf = (row: Row) => row.metadata as Meta;

/** Importing into a territory needs the grant for that territory; in another territory an import looks like it does not exist. */
async function authorise(actor: ImportActor, territoryId: string) {
  const permissions = await getPermissionData();
  const decision = evaluatePermission({ userId: actor.userId, module: "advertiser.import", action: "manage", context: { organisationId: actor.organisationId ?? undefined, territoryId: actor.territoryId ?? undefined } }, permissions);
  if (!decision.allowed) throw new Error("No permission grant matched this request.");
  // Someone working in one territory can import only into that territory, whatever the request says.
  if (actor.territoryId && actor.territoryId !== territoryId) throw new Error("Territory is outside the active territory.");
}

async function existingNames(db: Db): Promise<string[]> {
  return (await db.select({ name: organisations.name }).from(organisations).where(and(eq(organisations.kind, "advertiser"), isNull(organisations.deletedAt)))).map((row) => row.name);
}

function audit(db: Parameters<typeof recordAuditEvent>[0], actor: ImportActor, action: string, id: string, territoryId: string, after: Record<string, unknown>) {
  return recordAuditEvent(db, { action, actor: { type: "human", userId: actor.userId }, entity: { type: "advertiser_import", id }, scope: { organisationId: actor.organisationId ?? undefined, territoryId }, after });
}

/** Checks the file and stores it as a dry run. Nothing in the advertiser records changes. */
export async function previewAdvertiserImport(actor: ImportActor, input: { territoryId: string; source: string; fileName: string; text: string }) {
  await authorise(actor, input.territoryId);
  if (!input.source.trim()) throw new AdvertiserImportFileError("Say where this list came from.");
  if (Buffer.byteLength(input.text, "utf8") > ADVERTISER_IMPORT_MAX_BYTES) throw new AdvertiserImportFileError("That file is larger than 1 MB. Split it and import in parts.");
  const parsed = parseAdvertiserCsv(input.text);
  if (parsed.fatal) throw new AdvertiserImportFileError(parsed.fatal);
  if (parsed.rows.length === 0) throw new AdvertiserImportFileError("The file has a header but no rows.");

  const { db, sql } = createDb();
  try {
    const fileHash = createHash("sha256").update(input.text).digest("hex");
    const [same] = await db.select({ id: advertiserImports.id }).from(advertiserImports).where(and(eq(advertiserImports.territoryId, input.territoryId), eq(advertiserImports.fileHash, fileHash)));
    if (same) return { id: same.id, existing: true };
    const plan = planAdvertiserImport({ rows: parsed.rows, existingNames: await existingNames(db) });
    const [created] = await db.insert(advertiserImports).values({
      territoryId: input.territoryId,
      source: input.source.trim().slice(0, 200),
      fileName: input.fileName.slice(0, 200),
      fileHash,
      totalRows: plan.summary.total,
      rejectedCount: plan.summary.rejected,
      metadata: { rows: parsed.rows, summary: plan.summary } as never,
      createdByUserId: actor.userId
    }).returning({ id: advertiserImports.id });
    await audit(db, actor, auditActions.advertiserImportDryRun, created!.id, input.territoryId, { rows: plan.summary.total, toCreate: plan.summary.create, rejected: plan.summary.rejected, source: input.source.trim().slice(0, 200) });
    return { id: created!.id, existing: false };
  } finally {
    await sql.end();
  }
}

async function authorisedImport(actor: ImportActor, db: Db, id: string) {
  const [row] = await db.select().from(advertiserImports).where(eq(advertiserImports.id, id));
  if (!row) throw new Error("Import was not found.");
  try {
    await authorise(actor, row.territoryId);
  } catch {
    throw new Error("Import was not found.");
  }
  return row;
}

export async function readAdvertiserImport(actor: ImportActor, id: string) {
  const { db, sql } = createDb();
  try {
    const record = await authorisedImport(actor, db, id);
    const meta = metaOf(record);
    // A dry run is re-planned now, so staff see what would happen today and not what would have happened at upload.
    const live = record.status === "dry_run" && meta.rows ? planAdvertiserImport({ rows: meta.rows, existingNames: await existingNames(db) }) : undefined;
    return {
      record,
      summary: live?.summary ?? meta.summary,
      sample: live?.rows.slice(0, 25).map((row) => ({ line: row.line, businessName: row.businessName, outcome: row.outcome, reason: row.reason })) ?? [],
      hasReport: live ? live.summary.rejected > 0 : Boolean(meta.rejectReport && meta.rejectReport.split("\n").length > 2),
      rollback: meta.rollback
    };
  } finally {
    await sql.end();
  }
}

export async function readAdvertiserImportReport(actor: ImportActor, id: string) {
  const { db, sql } = createDb();
  try {
    const record = await authorisedImport(actor, db, id);
    const meta = metaOf(record);
    if (record.status === "dry_run" && meta.rows) return buildAdvertiserRejectReport(planAdvertiserImport({ rows: meta.rows, existingNames: await existingNames(db) }));
    return meta.rejectReport ?? "line,business,outcome,reason\n";
  } finally {
    await sql.end();
  }
}

/**
 * Applies a dry run. The rows are checked again against the advertisers as they are at this moment, so a business added since the
 * upload is left out rather than duplicated. Each new business becomes a prospect with its contact (if any) and a note saying where it came from.
 */
export async function commitAdvertiserImport(actor: ImportActor, id: string) {
  const { db, sql } = createDb();
  try {
    const record = await authorisedImport(actor, db, id);
    const outcome = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(advertiserImports).set({ status: "applying", updatedAt: new Date() }).where(and(eq(advertiserImports.id, id), eq(advertiserImports.status, "dry_run"))).returning();
      if (!claimed) return { alreadyDone: true as const };
      const meta = metaOf(claimed);
      const plan = planAdvertiserImport({ rows: meta.rows ?? [], existingNames: await existingNames(tx as never) });
      const created = { advertiserIds: [] as string[], organisationIds: [] as string[], contactIds: [] as string[], eventIds: [] as string[] };
      for (const item of plan.rows.filter((row) => row.outcome === "create")) {
        const row = item.row;
        const organisationId = randomUUID();
        const advertiserId = randomUUID();
        await tx.insert(organisations).values({ id: organisationId, kind: "advertiser", name: row.businessName });
        await tx.insert(advertisers).values({ id: advertiserId, advertiserOrganisationId: organisationId, owningTerritoryId: record.territoryId, accountOwnerUserId: null, status: "prospect", relationshipState: "new", source: `import:${id}`, tags: row.tags, commercialMetadata: row.notes ? { internalNotes: row.notes } : {} });
        created.organisationIds.push(organisationId);
        created.advertiserIds.push(advertiserId);
        if (row.contactName || row.contactEmail || row.phone) {
          const contactId = randomUUID();
          await tx.insert(advertiserContacts).values({ id: contactId, advertiserId, label: "Primary contact", name: row.contactName, email: row.contactEmail, phone: row.phone, role: row.role ?? "contact", isPrimary: true });
          created.contactIds.push(contactId);
        }
        const eventId = randomUUID();
        await tx.insert(advertiserActivityEvents).values({ id: eventId, advertiserId, territoryId: record.territoryId, actorUserId: actor.userId, activityType: "imported", title: `Imported from "${record.source}"`, metadata: { importId: id, line: row.line } });
        created.eventIds.push(eventId);
      }
      const rejectReport = buildAdvertiserRejectReport(plan);
      // The raw rows are dropped as soon as the import is applied; what stays is the report, the ids and the counts.
      await tx.update(advertiserImports).set({
        status: "applied", appliedAt: new Date(), appliedByUserId: actor.userId, createdCount: created.advertiserIds.length, rejectedCount: plan.summary.rejected, totalRows: plan.summary.total,
        metadata: { summary: plan.summary, rejectReport, created } as never, updatedAt: new Date()
      }).where(eq(advertiserImports.id, id));
      await audit(tx, actor, auditActions.advertiserImportCommit, id, record.territoryId, { created: created.advertiserIds.length, contacts: created.contactIds.length, rejected: plan.summary.rejected });
      return { alreadyDone: false as const, created: created.advertiserIds.length, rejected: plan.summary.rejected };
    });
    return outcome;
  } finally {
    await sql.end();
  }
}

/**
 * Reverses an applied import. Only businesses still exactly as the import left them are removed: if anyone has since added a
 * contact, note, task, opportunity, proposal, booking, invoice or artwork, or changed its status, it is kept and counted as left alone.
 */
export async function rollbackAdvertiserImport(actor: ImportActor, id: string) {
  const { db, sql } = createDb();
  try {
    const record = await authorisedImport(actor, db, id);
    return await db.transaction(async (tx) => {
      const [claimed] = await tx.update(advertiserImports).set({ status: "rolling_back", updatedAt: new Date() }).where(and(eq(advertiserImports.id, id), eq(advertiserImports.status, "applied"))).returning();
      if (!claimed) return { alreadyDone: true as const, removed: 0, leftAlone: 0 };
      const meta = metaOf(claimed);
      const created = meta.created ?? { advertiserIds: [], organisationIds: [], contactIds: [], eventIds: [] };
      const data = await loadAdvertisingData(tx as never);
      const pristine = (advertiserId: string) => {
        const advertiser = data.advertisers.find((candidate) => candidate.id === advertiserId);
        if (!advertiser || advertiser.deletedAt) return false;
        const mine = <T extends { id: string; advertiserId: string; deletedAt?: Date | null }>(rows: T[]) => rows.filter((row) => row.advertiserId === advertiserId && !row.deletedAt);
        return advertiser.status === "prospect" && advertiser.relationshipState === "new"
          && mine(data.contacts).every((contact) => created.contactIds.includes(contact.id))
          && mine(data.activityEvents).every((event) => created.eventIds.includes(event.id))
          && [data.opportunities, data.proposals, data.bookings, data.invoices, data.artworkRequirements, data.campaignFulfilments, data.tasks, data.renewalPrompts, data.productionRequests, data.inventoryReservations].every((rows) => mine(rows as never).length === 0);
      };
      const removable = created.advertiserIds.filter(pristine);
      const now = new Date();
      if (removable.length > 0) {
        const orgIds = data.advertisers.filter((advertiser) => removable.includes(advertiser.id)).map((advertiser) => advertiser.advertiserOrganisationId);
        await tx.update(advertiserActivityEvents).set({ deletedAt: now }).where(inArray(advertiserActivityEvents.advertiserId, removable));
        await tx.update(advertiserContacts).set({ deletedAt: now }).where(inArray(advertiserContacts.advertiserId, removable));
        await tx.update(advertisers).set({ deletedAt: now }).where(inArray(advertisers.id, removable));
        await tx.update(organisations).set({ deletedAt: now }).where(inArray(organisations.id, orgIds));
      }
      const leftAlone = created.advertiserIds.length - removable.length;
      await tx.update(advertiserImports).set({ status: "rolled_back", rolledBackAt: now, metadata: { ...meta, rollback: { removed: removable.length, leftAlone } } as never, updatedAt: now }).where(eq(advertiserImports.id, id));
      await audit(tx, actor, auditActions.advertiserImportRollback, id, record.territoryId, { removed: removable.length, leftAlone });
      return { alreadyDone: false as const, removed: removable.length, leftAlone };
    });
  } finally {
    await sql.end();
  }
}

export async function listAdvertiserImports(actor: ImportActor) {
  const { db, sql } = createDb();
  try {
    const all = await db.select().from(advertiserImports).orderBy(desc(advertiserImports.createdAt)).limit(100);
    const visible: Row[] = [];
    for (const record of all) {
      try {
        await authorise(actor, record.territoryId);
        visible.push(record);
      } catch {
        // not theirs: not listed
      }
    }
    return visible;
  } finally {
    await sql.end();
  }
}
