import { createHash } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { createDb } from "@raring2go/db";
import {
  IMPORT_MAX_BYTES,
  authoriseAudienceImport,
  buildRejectReport,
  commitImport,
  createImportDryRun,
  getImport,
  listImports,
  loadMarketingData,
  parseAudienceCsv,
  planAudienceImport,
  rollbackImport
} from "@raring2go/marketing";
import type { ImportConsentBasis, MarketingActorContext, StoredImport } from "@raring2go/marketing";
import { getPermissionData } from "./permission-source";

/** A problem with the uploaded file itself, shown to staff as-is (it never echoes file contents). */
export class ImportFileError extends Error {}

const today = () => new Date().toISOString().slice(0, 10);

function audit(db: Parameters<typeof recordAuditEvent>[0], context: MarketingActorContext, action: Parameters<typeof recordAuditEvent>[1]["action"], importId: string, territoryId: string | null, after: Record<string, unknown>) {
  return recordAuditEvent(db, {
    action,
    actor: { type: "human", userId: context.userId },
    entity: { type: "audience_import", id: importId },
    scope: { organisationId: context.organisationId ?? undefined, territoryId: territoryId ?? undefined },
    after
  });
}

/** Parses and plans the file and stores it as a dry run. Nothing in the audience changes. */
export async function previewAudienceImport(
  context: MarketingActorContext,
  input: { territoryId: string; source: string; basis: ImportConsentBasis; fileName: string; text: string }
) {
  const permissions = await getPermissionData();
  authoriseAudienceImport(context, permissions, input.territoryId);
  if (!["consent_evidenced", "no_consent_record"].includes(input.basis)) throw new ImportFileError("Choose how this list was collected.");
  if (!input.source.trim()) throw new ImportFileError("Say where this list came from.");
  if (Buffer.byteLength(input.text, "utf8") > IMPORT_MAX_BYTES) throw new ImportFileError("That file is larger than 2 MB. Split it and import in parts.");

  const parsed = parseAudienceCsv(input.text);
  if (parsed.fatal) throw new ImportFileError(parsed.fatal);
  if (parsed.rows.length === 0) throw new ImportFileError("The file has a header but no rows.");

  const { db, sql } = createDb();
  try {
    const plan = planAudienceImport(await loadMarketingData(db), { territoryId: input.territoryId, basis: input.basis, rows: parsed.rows, today: today() });
    const created = await createImportDryRun(db, {
      territoryId: input.territoryId,
      source: input.source.trim().slice(0, 200),
      basis: input.basis,
      fileHash: createHash("sha256").update(input.text).digest("hex"),
      fileName: input.fileName.slice(0, 200),
      rows: parsed.rows,
      plan,
      createdByUserId: context.userId
    });
    if (!created.existing) {
      await audit(db, context, "marketing.audience.import.dry_run", created.id, input.territoryId, { rows: plan.summary.total, rejected: plan.summary.rejected, basis: input.basis, source: input.source.trim().slice(0, 200) });
    }
    return created;
  } finally {
    await sql.end();
  }
}

async function authorisedImport(context: MarketingActorContext, db: ReturnType<typeof createDb>["db"], importId: string) {
  const record = await getImport(db, importId);
  // Not found and not yours look the same, so import ids cannot be probed across territories.
  if (!record?.territoryId) throw new Error("Import was not found.");
  try {
    authoriseAudienceImport(context, await getPermissionData(), record.territoryId);
  } catch {
    throw new Error("Import was not found.");
  }
  return record;
}

export async function readAudienceImport(context: MarketingActorContext, importId: string) {
  const { db, sql } = createDb();
  try {
    const record = await authorisedImport(context, db, importId);
    // A dry run is re-planned now, so staff see what would happen today rather than what would have happened at upload.
    const live = record.status === "dry_run" && record.metadata.rows
      ? planAudienceImport(await loadMarketingData(db), { territoryId: record.territoryId!, basis: record.metadata.basis, rows: record.metadata.rows, today: today() })
      : undefined;
    return {
      record,
      summary: live?.summary ?? record.metadata.committed?.summary ?? record.metadata.summary,
      sample: live?.rows.slice(0, 25).map((row) => ({ line: row.line, email: row.email, outcome: row.outcome, reason: row.reason })) ?? [],
      hasReport: Boolean(live ? live.rows.some((row) => row.outcome.startsWith("reject_") || row.outcome.endsWith("_pending")) : record.metadata.rejectReport)
    };
  } finally {
    await sql.end();
  }
}

export async function readImportReport(context: MarketingActorContext, importId: string) {
  const { db, sql } = createDb();
  try {
    const record = await authorisedImport(context, db, importId);
    if (record.status === "dry_run" && record.metadata.rows) {
      return buildRejectReport(planAudienceImport(await loadMarketingData(db), { territoryId: record.territoryId!, basis: record.metadata.basis, rows: record.metadata.rows, today: today() }));
    }
    return record.metadata.rejectReport ?? "line,email,outcome,reason\n";
  } finally {
    await sql.end();
  }
}

export async function commitAudienceImport(context: MarketingActorContext, importId: string) {
  const { db, sql } = createDb();
  try {
    const record = await authorisedImport(context, db, importId);
    const result = await commitImport(db, importId, { userId: context.userId, today: today() });
    if (!result.alreadyDone) {
      await audit(db, context, "marketing.audience.import.commit", importId, record.territoryId, { created: result.createdContacts, subscriptions: result.subscriptions, subscribedWithConsent: result.subscribed, rejected: result.summary.rejected });
    }
    return result;
  } finally {
    await sql.end();
  }
}

export async function rollbackAudienceImport(context: MarketingActorContext, importId: string) {
  const { db, sql } = createDb();
  try {
    const record = await authorisedImport(context, db, importId);
    const result = await rollbackImport(db, importId, { userId: context.userId });
    if (!result.alreadyDone) {
      await audit(db, context, "marketing.audience.import.rollback", importId, record.territoryId, { withdrawn: result.subscriptionsWithdrawn, leftAlone: result.leftAlone, alreadyEmailed: result.alreadyEmailed });
    }
    return result;
  } finally {
    await sql.end();
  }
}

export async function listAudienceImports(context: MarketingActorContext): Promise<StoredImport[]> {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();
  try {
    const all = await listImports(db, null);
    return all.filter((record) => {
      if (!record.territoryId) return false;
      try {
        authoriseAudienceImport(context, permissions, record.territoryId);
        return true;
      } catch {
        return false;
      }
    });
  } finally {
    await sql.end();
  }
}
