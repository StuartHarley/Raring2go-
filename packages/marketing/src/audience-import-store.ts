import { randomUUID } from "node:crypto";
import {
  audienceConsentEvents,
  audienceContacts,
  audienceImports,
  audienceTerritorySubscriptions,
  emailRecipientSnapshots
} from "@raring2go/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { buildRejectReport, planAudienceImport } from "./audience-import";
import type { ImportConsentBasis, ImportPlan, ParsedImportRow } from "./audience-import";
import { loadMarketingData } from "./repository";

/**
 * Persistence for audience imports. A dry run stores the parsed rows with the import; committing re-plans those
 * rows against the database as it is at that moment (so a suppression made since the dry run is respected) and
 * applies the result in one transaction. Everything an import creates is recorded on the import so it can be rolled back.
 *
 * Statuses: dry_run -> importing -> committed -> rolling_back -> rolled_back. Each step is claimed with a single
 * conditional UPDATE, so a double click or two workers can never apply or reverse an import twice.
 */

type Db = any;

export type ImportSummary = ImportPlan["summary"];

export type StoredImport = {
  id: string;
  territoryId: string | null;
  source: string;
  status: string;
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  errorRows: number;
  createdAt: Date;
  metadata: {
    basis: ImportConsentBasis;
    fileHash: string;
    fileName: string;
    createdByUserId: string;
    rows?: ParsedImportRow[];
    summary?: ImportSummary;
    /** Rejected and pending rows with reasons, kept so staff can fix and re-upload after the raw file contents are dropped. */
    rejectReport?: string;
    committed?: { createdContactIds: string[]; subscriptionIds: string[]; consentEventIds: string[]; at: string; summary: ImportSummary };
    rollback?: { at: string; subscriptionsWithdrawn: number; leftAlone: number; alreadyEmailed: number };
  };
};

const chunk = <T>(items: T[], size = 500) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

export async function createImportDryRun(
  db: Db,
  input: { territoryId: string; source: string; basis: ImportConsentBasis; fileHash: string; fileName: string; rows: ParsedImportRow[]; plan: ImportPlan; createdByUserId: string }
): Promise<{ id: string; existing: boolean }> {
  return db.transaction(async (tx: Db) => {
    // Serialise uploads of the same file so two requests cannot both create it.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`audience-import:${input.territoryId}:${input.fileHash}:${input.basis}`}))`);
    const rows = await tx.select().from(audienceImports).where(and(eq(audienceImports.territoryId, input.territoryId)));
    const same = (rows as StoredImport[]).find((row) => row.metadata?.fileHash === input.fileHash && row.metadata?.basis === input.basis && ["dry_run", "importing", "committed"].includes(row.status));
    if (same) return { id: same.id, existing: true };

    const id = randomUUID();
    await tx.insert(audienceImports).values({
      id,
      territoryId: input.territoryId,
      source: input.source,
      status: "dry_run",
      totalRows: input.plan.summary.total,
      importedRows: 0,
      duplicateRows: input.plan.summary.alreadySubscribed,
      errorRows: input.plan.summary.rejected,
      metadata: { basis: input.basis, fileHash: input.fileHash, fileName: input.fileName, createdByUserId: input.createdByUserId, rows: input.rows, summary: input.plan.summary }
    });
    return { id, existing: false };
  });
}

export async function getImport(db: Db, importId: string): Promise<StoredImport | undefined> {
  const [row] = await db.select().from(audienceImports).where(eq(audienceImports.id, importId));
  return row as StoredImport | undefined;
}

export async function listImports(db: Db, territoryIds: string[] | null): Promise<StoredImport[]> {
  const rows = (await db.select().from(audienceImports)) as StoredImport[];
  return rows
    .filter((row) => territoryIds === null || (row.territoryId !== null && territoryIds.includes(row.territoryId)))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

/** Applies a dry run. Safe to call twice: the second call finds it already committed and changes nothing. */
export async function commitImport(db: Db, importId: string, actor: { userId: string; today: string }) {
  return db.transaction(async (tx: Db) => {
    const claimed = await tx
      .update(audienceImports)
      .set({ status: "importing" })
      .where(and(eq(audienceImports.id, importId), eq(audienceImports.status, "dry_run")))
      .returning();
    if (claimed.length === 0) {
      const current = await getImport(tx, importId);
      if (!current) throw new Error("Import was not found.");
      if (current.status === "committed" || current.status === "importing") return { alreadyDone: true as const, import: current };
      throw new Error("Only a dry run can be imported.");
    }

    const record = claimed[0] as StoredImport;
    const rows = record.metadata.rows ?? [];
    const territoryId = record.territoryId!;
    const data = await loadMarketingData(tx);
    const plan = planAudienceImport(data, { territoryId, basis: record.metadata.basis, rows, today: actor.today });

    const now = new Date();
    const contacts: Array<typeof audienceContacts.$inferInsert> = [];
    const subscriptions: Array<typeof audienceTerritorySubscriptions.$inferInsert> = [];
    const consents: Array<typeof audienceConsentEvents.$inferInsert> = [];
    const source = `import:${importId}`;

    for (const item of plan.rows) {
      const subscribed = Boolean(item.consent);
      let contactId = item.existingContactId;

      if (item.outcome === "create_subscribed" || item.outcome === "create_pending") {
        contactId = randomUUID();
        contacts.push({
          id: contactId,
          email: item.row.email.trim(),
          emailNormalised: item.row.email.trim().toLowerCase(),
          firstName: item.row.firstName,
          lastName: item.row.lastName,
          emailStatus: subscribed ? "subscribed" : "unconfirmed",
          tags: item.row.tags,
          metadata: { source: "import", importId, importLine: item.line }
        });
      } else if (item.outcome !== "add_subscription" && item.outcome !== "add_pending") continue;

      const subscriptionId = randomUUID();
      subscriptions.push({
        id: subscriptionId,
        contactId: contactId!,
        territoryId,
        status: subscribed ? "subscribed" : "pending_consent",
        source,
        preferences: {},
        subscribedAt: subscribed ? new Date(`${item.consent!.date}T00:00:00Z`) : null,
        unsubscribedAt: null
      });
      if (subscribed) {
        consents.push({
          id: randomUUID(),
          contactId: contactId!,
          territoryId,
          consentType: "email_marketing",
          action: "granted",
          source,
          occurredAt: new Date(`${item.consent!.date}T00:00:00Z`),
          actorUserId: actor.userId,
          evidence: { importId, importLine: item.line, consentDate: item.consent!.date, consentSource: item.consent!.source, basis: record.metadata.basis, importedOn: now.toISOString() }
        });
      }
    }

    // Contacts first: another request may have created the same address since the plan was made. Those are not ours.
    const createdContactIds: string[] = [];
    for (const part of chunk(contacts)) {
      const inserted = await tx.insert(audienceContacts).values(part).onConflictDoNothing().returning({ id: audienceContacts.id });
      createdContactIds.push(...inserted.map((row: { id: string }) => row.id));
    }
    const created = new Set(createdContactIds);
    const lostRace = new Set(contacts.filter((contact) => !created.has(contact.id!)).map((contact) => contact.id!));
    const keptSubscriptions = subscriptions.filter((subscription) => !lostRace.has(subscription.contactId));
    const keptConsents = consents.filter((consent) => !lostRace.has(consent.contactId));

    for (const part of chunk(keptSubscriptions)) await tx.insert(audienceTerritorySubscriptions).values(part).onConflictDoNothing();
    for (const part of chunk(keptConsents)) await tx.insert(audienceConsentEvents).values(part);

    const summary: ImportSummary = { ...plan.summary };
    await tx
      .update(audienceImports)
      .set({
        status: "committed",
        importedRows: keptSubscriptions.length,
        duplicateRows: plan.summary.alreadySubscribed + lostRace.size,
        errorRows: plan.summary.rejected,
        metadata: {
          ...record.metadata,
          // The raw rows are personal data, so they are dropped once applied; the report and the ids stay.
          rows: undefined,
          rejectReport: buildRejectReport(plan),
          committed: { createdContactIds, subscriptionIds: keptSubscriptions.map((subscription) => subscription.id!), consentEventIds: keptConsents.map((consent) => consent.id!), at: now.toISOString(), summary }
        }
      })
      .where(eq(audienceImports.id, importId));

    return { alreadyDone: false as const, createdContacts: createdContactIds.length, subscriptions: keptSubscriptions.length, subscribed: keptConsents.length, summary, plan };
  });
}

/**
 * Reverses a committed import without erasing history. Each subscription it created is withdrawn (status
 * `import_rolled_back`, which is not an unsubscribe, so a corrected file can be imported again) and a withdrawal is
 * appended to the consent history: consent events are never deleted. The contact records stay, with no active
 * subscription, so nothing is sent to them; removing the people themselves is an erasure request, which has its own
 * four-eyes flow. Anyone who has since confirmed or changed their subscription is left alone.
 */
export async function rollbackImport(db: Db, importId: string, actor: { userId: string }) {
  return db.transaction(async (tx: Db) => {
    const claimed = await tx
      .update(audienceImports)
      .set({ status: "rolling_back" })
      .where(and(eq(audienceImports.id, importId), eq(audienceImports.status, "committed")))
      .returning();
    if (claimed.length === 0) {
      const current = await getImport(tx, importId);
      if (!current) throw new Error("Import was not found.");
      if (current.status === "rolled_back" || current.status === "rolling_back") return { alreadyDone: true as const, import: current };
      throw new Error("Only a committed import can be rolled back.");
    }

    const record = claimed[0] as StoredImport;
    const committed = record.metadata.committed;
    if (!committed) throw new Error("This import has no record of what it created.");
    const now = new Date();
    let subscriptionsWithdrawn = 0;
    let leftAlone = 0;
    const contactIds = new Set<string>();

    for (const part of chunk(committed.subscriptionIds)) {
      const rows = await tx.select().from(audienceTerritorySubscriptions).where(inArray(audienceTerritorySubscriptions.id, part));
      for (const subscription of rows as Array<{ id: string; contactId: string; territoryId: string; status: string }>) {
        // Conditional on the row still being the import's own, in an import-owned state.
        const owned = await tx
          .update(audienceTerritorySubscriptions)
          .set({ status: "import_rolled_back", unsubscribedAt: now })
          .where(and(
            eq(audienceTerritorySubscriptions.id, subscription.id),
            eq(audienceTerritorySubscriptions.source, `import:${importId}`),
            inArray(audienceTerritorySubscriptions.status, ["subscribed", "pending_consent"])
          ))
          .returning({ id: audienceTerritorySubscriptions.id });
        if (owned.length === 0) {
          leftAlone += 1;
          continue;
        }
        subscriptionsWithdrawn += 1;
        contactIds.add(subscription.contactId);
        if (subscription.status === "subscribed") {
          await tx.insert(audienceConsentEvents).values({
            id: randomUUID(),
            contactId: subscription.contactId,
            territoryId: subscription.territoryId,
            consentType: "email_marketing",
            action: "withdrawn",
            source: "import_rollback",
            occurredAt: now,
            actorUserId: actor.userId,
            evidence: { importId, reason: "import_rolled_back" }
          });
        }
      }
    }

    // Worth telling staff: these people may already have been emailed, which a rollback cannot undo.
    let alreadyEmailed = 0;
    for (const contactId of contactIds) {
      const [emailed] = await tx.select({ count: sql<number>`count(*)::int` }).from(emailRecipientSnapshots).where(sql`${emailRecipientSnapshots.recipients} @> ${JSON.stringify([{ contactId }])}::jsonb`);
      if (emailed.count > 0) alreadyEmailed += 1;
    }

    await tx
      .update(audienceImports)
      .set({ status: "rolled_back", metadata: { ...record.metadata, rollback: { at: now.toISOString(), subscriptionsWithdrawn, leftAlone, alreadyEmailed } } })
      .where(eq(audienceImports.id, importId));
    return { alreadyDone: false as const, subscriptionsWithdrawn, leftAlone, alreadyEmailed };
  });
}
