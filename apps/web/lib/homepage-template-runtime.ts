import { recordAuditEvent } from "@raring2go/audit";
import { auditActions } from "@raring2go/audit";
import { createDb, publicHomepageTemplates } from "@raring2go/db";
import { evaluatePermission } from "@raring2go/permissions";
import { HOMEPAGE_TEMPLATE_KEY, HomepageTemplateError, defaultHomepageSlots, usableHomepageSlots, validateHomepageSlots } from "@raring2go/public";
import type { PublicHomepageSlot } from "@raring2go/public";
import { and, desc, eq, ne } from "drizzle-orm";
import { getPermissionData } from "./permission-source";

export type HomepageActor = { userId: string; organisationId?: string | null; territoryId?: string | null };

export class HomepageNotAllowedError extends Error {
  constructor() {
    super("No permission grant matched this request.");
    this.name = "HomepageNotAllowedError";
  }
}

export class HomepageStateError extends Error {
  constructor(readonly code: "draft_exists" | "not_draft" | "not_found", message: string) {
    super(message);
    this.name = "HomepageStateError";
  }
}

async function requireManage(actor: HomepageActor) {
  const permissions = await getPermissionData();
  const decision = evaluatePermission({ userId: actor.userId, module: "public.homepage", action: "manage", context: { organisationId: actor.organisationId ?? undefined, territoryId: actor.territoryId ?? undefined } }, permissions);
  if (!decision.allowed) throw new HomepageNotAllowedError();
}

type Row = typeof publicHomepageTemplates.$inferSelect;

function view(row: Row) {
  return { id: row.id, version: row.version, status: row.status, notes: row.notes, publishedAt: row.publishedAt, createdAt: row.createdAt, slots: usableHomepageSlots(row.slots).slots };
}

/** The live layout, the working draft (if any) and the history, for the HQ editor. */
export async function readHomepageTemplates(actor: HomepageActor) {
  await requireManage(actor);
  const { db, sql } = createDb();
  try {
    const rows = await db.select().from(publicHomepageTemplates).where(eq(publicHomepageTemplates.key, HOMEPAGE_TEMPLATE_KEY)).orderBy(desc(publicHomepageTemplates.version));
    const live = rows.find((row) => row.status === "published");
    return {
      live: live ? view(live) : null,
      draft: rows.find((row) => row.status === "draft") ? view(rows.find((row) => row.status === "draft")!) : null,
      history: rows.filter((row) => row.status === "retired" || (row.status === "published" && row !== live)).map(view),
      defaults: defaultHomepageSlots()
    };
  } finally {
    await sql.end();
  }
}

async function audit(db: Parameters<typeof recordAuditEvent>[0], actor: HomepageActor, id: string, action: string, extra: Record<string, unknown>) {
  await recordAuditEvent(db, {
    action: auditActions.publicHomepageTemplateChange,
    actor: { type: "human", userId: actor.userId },
    entity: { type: "public_homepage_template", id },
    scope: { organisationId: actor.organisationId ?? undefined },
    after: { action, ...extra }
  });
}

/** Saves the layout as the single working draft: updates it if there is one, otherwise starts the next version. */
export async function saveHomepageDraft(actor: HomepageActor, input: unknown, notes?: string | null) {
  await requireManage(actor);
  const slots = validateHomepageSlots(input); // refuses anything the site cannot safely show
  const { db, sql } = createDb();
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx.select().from(publicHomepageTemplates).where(eq(publicHomepageTemplates.key, HOMEPAGE_TEMPLATE_KEY));
      const draft = rows.find((row) => row.status === "draft");
      const cleanNotes = notes?.trim().slice(0, 500) || null;
      if (draft) {
        await tx.update(publicHomepageTemplates).set({ slots: slots as never, notes: cleanNotes, updatedAt: new Date() }).where(eq(publicHomepageTemplates.id, draft.id));
        await audit(tx, actor, draft.id, "update_draft", { version: draft.version });
        return { id: draft.id, version: draft.version };
      }
      const version = Math.max(0, ...rows.map((row) => row.version)) + 1;
      const [created] = await tx.insert(publicHomepageTemplates).values({ key: HOMEPAGE_TEMPLATE_KEY, version, status: "draft", slots: slots as never, notes: cleanNotes, createdByUserId: actor.userId }).returning({ id: publicHomepageTemplates.id });
      await audit(tx, actor, created!.id, "create_draft", { version });
      return { id: created!.id, version };
    });
  } finally {
    await sql.end();
  }
}

/** Makes the draft live. The previous live version is kept, retired, as history; the published layout can never be edited. */
export async function publishHomepageDraft(actor: HomepageActor, versionId: string) {
  await requireManage(actor);
  const { db, sql } = createDb();
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select().from(publicHomepageTemplates).where(and(eq(publicHomepageTemplates.id, versionId), eq(publicHomepageTemplates.key, HOMEPAGE_TEMPLATE_KEY)));
      if (!row) throw new HomepageStateError("not_found", "That version was not found.");
      if (row.status !== "draft") throw new HomepageStateError("not_draft", "Only a draft can be published.");
      validateHomepageSlots(row.slots); // a draft that was valid when saved is checked again before it goes live
      await tx.update(publicHomepageTemplates).set({ status: "retired" }).where(and(eq(publicHomepageTemplates.key, HOMEPAGE_TEMPLATE_KEY), eq(publicHomepageTemplates.status, "published"), ne(publicHomepageTemplates.id, row.id)));
      await tx.update(publicHomepageTemplates).set({ status: "published", publishedAt: new Date(), publishedByUserId: actor.userId }).where(eq(publicHomepageTemplates.id, row.id));
      await audit(tx, actor, row.id, "publish", { version: row.version });
      return { version: row.version };
    });
  } finally {
    await sql.end();
  }
}

export async function discardHomepageDraft(actor: HomepageActor, versionId: string) {
  await requireManage(actor);
  const { db, sql } = createDb();
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(publicHomepageTemplates).where(and(eq(publicHomepageTemplates.id, versionId), eq(publicHomepageTemplates.key, HOMEPAGE_TEMPLATE_KEY)));
      if (!row) throw new HomepageStateError("not_found", "That version was not found.");
      if (row.status !== "draft") throw new HomepageStateError("not_draft", "Only a draft can be discarded.");
      await tx.delete(publicHomepageTemplates).where(eq(publicHomepageTemplates.id, row.id));
      await audit(tx, actor, row.id, "discard_draft", { version: row.version });
    });
  } finally {
    await sql.end();
  }
}

/** Copies an older version's layout into the working draft, so an earlier look can be brought back as a new version. */
export async function startHomepageDraftFrom(actor: HomepageActor, versionId: string) {
  await requireManage(actor);
  const { db, sql } = createDb();
  try {
    const rows = await db.select().from(publicHomepageTemplates).where(eq(publicHomepageTemplates.key, HOMEPAGE_TEMPLATE_KEY));
    const source = rows.find((row) => row.id === versionId);
    if (!source) throw new HomepageStateError("not_found", "That version was not found.");
    if (rows.some((row) => row.status === "draft")) throw new HomepageStateError("draft_exists", "There is already a draft.");
    return saveHomepageDraft(actor, source.slots, `Started from version ${source.version}`);
  } finally {
    await sql.end();
  }
}

export type { PublicHomepageSlot, HomepageTemplateError };
