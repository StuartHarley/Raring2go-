import { randomInt, randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { auditActions } from "@raring2go/audit";
import { audienceContacts, competitionEntries, contentItems, createDb } from "@raring2go/db";
import { evaluatePermission } from "@raring2go/permissions";
import { getPublicCommercialDiscovery, resolvePublicTerritory } from "@raring2go/public";
import { and, eq, inArray } from "drizzle-orm";
import { ParentSignInRequiredError, resolveParentSession } from "./parent-runtime";
import { getPermissionData } from "./permission-source";
import { recordServerPublicEvent } from "./public-events";

/**
 * Public competitions: a signed-in parent enters once, while the competition is open; staff draw winners after it closes.
 * An entry is only who entered, when, and whether they won. Entering gives no marketing consent (that stays a separate,
 * explicit choice in the parent's preferences), and every entry is exported and erased with the rest of a person's data.
 */

export class CompetitionClosedError extends Error {
  constructor(message = "This competition is not open for entries.") {
    super(message);
    this.name = "CompetitionClosedError";
  }
}

export class CompetitionDrawError extends Error {
  constructor(readonly code: "still_open" | "no_end_date" | "already_drawn" | "no_entries" | "bad_count" | "not_found", message: string) {
    super(message);
    this.name = "CompetitionDrawError";
  }
}

export class CompetitionNotAllowedError extends Error {
  constructor() {
    super("No permission grant matched this request.");
    this.name = "CompetitionNotAllowedError";
  }
}

const today = (now: Date) => now.toISOString().slice(0, 10);

/** The date a competition closes, from its record: the end date, or the expiry if that is what was set. */
export function competitionClosingDate(relevantDates: Record<string, unknown>): string | null {
  const value = [relevantDates.endDate, relevantDates.expiresAt].find((candidate) => typeof candidate === "string" && /^\d{4}-\d{2}-\d{2}/.test(candidate)) as string | undefined;
  return value ? value.slice(0, 10) : null;
}

export type CompetitionState = "open" | "closed" | "no_end_date";

export function competitionState(closesOn: string | null, now: Date = new Date()): CompetitionState {
  if (!closesOn) return "no_end_date";
  return closesOn >= today(now) ? "open" : "closed";
}

/** A parent enters a competition that is listed publicly, has a closing date, and has not closed. One entry each. */
export async function enterCompetitionForParent(input: { sessionToken?: string | null; territorySlug: string; contentId: string }, now: Date = new Date()) {
  const parent = await resolveParentSession(input.sessionToken);
  if (!parent.authenticated) throw new ParentSignInRequiredError();
  const { db, sql } = createDb();
  try {
    const territory = await resolvePublicTerritory(db, input.territorySlug);
    if (!territory) throw new CompetitionClosedError("Unknown area.");
    const listed = (await getPublicCommercialDiscovery(db, input.territorySlug, "competitions"))?.items.find((item) => item.id === input.contentId);
    if (!listed || !listed.endDate || competitionState(listed.endDate.slice(0, 10), now) !== "open") throw new CompetitionClosedError();

    const inserted = await db
      .insert(competitionEntries)
      .values({ id: randomUUID(), contentItemId: listed.id, territoryId: territory.id, contactId: parent.contactId, enteredAt: now })
      .onConflictDoNothing({ target: [competitionEntries.contentItemId, competitionEntries.contactId] })
      .returning({ id: competitionEntries.id });
    const entered = inserted.length > 0;
    // The conversion is recorded once, when the entry is first made, and says nothing about who entered.
    if (entered) await recordServerPublicEvent(db, sql, territory.id, { eventType: "public_conversion", path: `/areas/${territory.slug}/competitions/${listed.slug}`, entityType: "content", entityId: listed.id, metadata: { conversionType: "competition_entry" } });
    return { entered, alreadyEntered: !entered };
  } finally {
    await sql.end();
  }
}

/** Whether this parent has already entered, for the button on the competition page. A visitor who is not signed in has not. */
export async function hasEnteredCompetition(sessionToken: string | null | undefined, contentId: string): Promise<boolean> {
  const parent = await resolveParentSession(sessionToken);
  if (!parent.authenticated) return false;
  const { db, sql } = createDb();
  try {
    const rows = await db.select({ id: competitionEntries.id }).from(competitionEntries).where(and(eq(competitionEntries.contentItemId, contentId), eq(competitionEntries.contactId, parent.contactId)));
    return rows.length > 0;
  } finally {
    await sql.end();
  }
}

export type CompetitionActor = { userId: string; organisationId?: string | null; territoryId?: string | null };

async function allowed(actor: CompetitionActor, module: string, action: string, territoryId?: string | null) {
  const permissions = await getPermissionData();
  return evaluatePermission({ userId: actor.userId, module, action, ...(territoryId ? { resource: { territoryId } } : { context: { organisationId: actor.organisationId ?? undefined, territoryId: actor.territoryId ?? undefined } }) }, permissions).allowed;
}

async function requireCompetition(db: ReturnType<typeof createDb>["db"], actor: CompetitionActor, contentId: string) {
  const [item] = await db.select().from(contentItems).where(eq(contentItems.id, contentId));
  if (!item || item.contentType !== "competition" || item.deletedAt) throw new CompetitionDrawError("not_found", "Competition was not found.");
  // A territory's competition is that territory's to run; a network one is for people who work across the network.
  if (item.territoryId ? actor.territoryId && actor.territoryId !== item.territoryId : actor.territoryId) throw new CompetitionNotAllowedError();
  return item;
}

/** Entry numbers and winners for staff. Winners' contact details are shown only to people who may draw. */
export async function readCompetitionEntries(actor: CompetitionActor, contentId: string, now: Date = new Date()) {
  const { db, sql } = createDb();
  try {
    const item = await requireCompetition(db, actor, contentId);
    if (!(await allowed(actor, "content", "view", item.territoryId))) throw new CompetitionNotAllowedError();
    const canDraw = await allowed(actor, "content.competition", "draw", item.territoryId);
    const entries = await db.select().from(competitionEntries).where(eq(competitionEntries.contentItemId, contentId));
    const closesOn = competitionClosingDate(item.relevantDates);
    const winnerEntries = entries.filter((entry) => entry.outcome === "winner");
    const contacts = canDraw && winnerEntries.length > 0 ? await db.select({ id: audienceContacts.id, email: audienceContacts.email }).from(audienceContacts).where(inArray(audienceContacts.id, winnerEntries.map((entry) => entry.contactId))) : [];
    return {
      title: item.title,
      closesOn,
      state: competitionState(closesOn, now),
      entryCount: entries.length,
      drawn: winnerEntries.length > 0,
      canDraw,
      winners: winnerEntries.map((entry) => ({ entryId: entry.id, drawnAt: entry.drawnAt, email: contacts.find((contact) => contact.id === entry.contactId)?.email ?? null }))
    };
  } finally {
    await sql.end();
  }
}

/** Fisher-Yates with a cryptographic source, so every entry has the same chance and no one can influence the pick. */
export function pickRandom<T>(items: T[], count: number, random: (max: number) => number = randomInt): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}

/**
 * Draws the winners once the competition has closed. It can be done once: a second attempt is refused, so a result is never
 * quietly redrawn. The draw, who ran it and how many entered are audited; the winning entries are marked, nothing else changes.
 */
export async function drawCompetitionWinners(actor: CompetitionActor, contentId: string, winnerCount: number, now: Date = new Date()) {
  const { db, sql } = createDb();
  try {
    return await db.transaction(async (tx) => {
      const item = await requireCompetition(tx as never, actor, contentId);
      if (!(await allowed(actor, "content.competition", "draw", item.territoryId))) throw new CompetitionNotAllowedError();
      if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 10) throw new CompetitionDrawError("bad_count", "Choose between 1 and 10 winners.");
      const closesOn = competitionClosingDate(item.relevantDates);
      const state = competitionState(closesOn, now);
      if (state === "no_end_date") throw new CompetitionDrawError("no_end_date", "This competition has no closing date, so it cannot be drawn.");
      if (state === "open") throw new CompetitionDrawError("still_open", `This competition is open until ${closesOn}.`);
      // Locking the entries serialises two people pressing Draw at once: the second waits, then sees the first result.
      const entries = await tx.select().from(competitionEntries).where(eq(competitionEntries.contentItemId, contentId)).for("update");
      if (entries.some((entry) => entry.outcome === "winner")) throw new CompetitionDrawError("already_drawn", "This competition has already been drawn.");
      if (entries.length === 0) throw new CompetitionDrawError("no_entries", "Nobody entered this competition.");
      const winners = pickRandom(entries, Math.min(winnerCount, entries.length));
      await tx.update(competitionEntries).set({ outcome: "winner", drawnAt: now, drawnByUserId: actor.userId, updatedAt: now }).where(inArray(competitionEntries.id, winners.map((winner) => winner.id)));
      await recordAuditEvent(tx, {
        action: auditActions.contentCompetitionDraw,
        actor: { type: "human", userId: actor.userId },
        entity: { type: "content_item", id: contentId },
        scope: { organisationId: actor.organisationId ?? undefined, territoryId: item.territoryId ?? undefined },
        after: { entrants: entries.length, winnersRequested: winnerCount, winnerEntryIds: winners.map((winner) => winner.id), closedOn: closesOn }
      });
      return { entrants: entries.length, winners: winners.length };
    });
  } finally {
    await sql.end();
  }
}
