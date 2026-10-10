import {
  audienceActivityEvents,
  audienceConsentEvents,
  audienceContacts,
  audiencePreferenceProfiles,
  audienceSavedContent,
  competitionEntries,
  audienceSegmentMembers,
  audienceSuppressions,
  audienceTerritorySubscriptions,
  emailDeliveryRecords,
  privacyRequests
} from "@raring2go/db";
import type { createDb } from "@raring2go/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DataCounts, NewPrivacyRequest, PrivacyRequestRecord, PrivacyStore, SubjectDataBundle } from "./types";

type Db = ReturnType<typeof createDb>["db"];

const toRecord = (row: typeof privacyRequests.$inferSelect): PrivacyRequestRecord => ({
  id: row.id,
  kind: row.kind as PrivacyRequestRecord["kind"],
  status: row.status as PrivacyRequestRecord["status"],
  subjectContactId: row.subjectContactId,
  subjectEmailHash: row.subjectEmailHash,
  requestedByUserId: row.requestedByUserId,
  requestNote: row.requestNote,
  dueAt: row.dueAt,
  decidedByUserId: row.decidedByUserId,
  decidedAt: row.decidedAt,
  decisionNote: row.decisionNote,
  completedAt: row.completedAt,
  resultSummary: row.resultSummary,
  createdAt: row.createdAt
});

/** The address that replaces a real one once the person is erased: unique, never deliverable. */
export const erasedEmail = (contactId: string) => `erased-${contactId}@erased.invalid`;

export function createDrizzlePrivacyStore(db: Db): PrivacyStore {
  return {
    async findContactByEmail(emailNormalised) {
      const [row] = await db.select({ id: audienceContacts.id }).from(audienceContacts).where(eq(audienceContacts.emailNormalised, emailNormalised));
      return row;
    },

    async findOpenRequest(kind, subjectEmailHash) {
      const [row] = await db
        .select()
        .from(privacyRequests)
        .where(and(eq(privacyRequests.kind, kind), eq(privacyRequests.subjectEmailHash, subjectEmailHash), eq(privacyRequests.status, "requested")));
      return row ? toRecord(row) : undefined;
    },

    async insertRequest(input: NewPrivacyRequest) {
      const [row] = await db.insert(privacyRequests).values(input).returning();
      return toRecord(row!);
    },

    async getRequest(id, options) {
      const query = db.select().from(privacyRequests).where(eq(privacyRequests.id, id));
      const [row] = options?.forUpdate ? await query.for("update") : await query;
      return row ? toRecord(row) : undefined;
    },

    async listRequests() {
      return (await db.select().from(privacyRequests).orderBy(desc(privacyRequests.createdAt)).limit(200)).map(toRecord);
    },

    async gatherSubjectData(contactId, now): Promise<SubjectDataBundle> {
      const [contact] = await db.select().from(audienceContacts).where(eq(audienceContacts.id, contactId));
      if (!contact) throw new Error("Contact not found.");
      const [subscriptions, preferences, consentEvents, suppressions, savedContent, entries, activity, segmentMemberships, emailDeliveries] = await Promise.all([
        db.select().from(audienceTerritorySubscriptions).where(eq(audienceTerritorySubscriptions.contactId, contactId)),
        db.select().from(audiencePreferenceProfiles).where(eq(audiencePreferenceProfiles.contactId, contactId)),
        db.select().from(audienceConsentEvents).where(eq(audienceConsentEvents.contactId, contactId)),
        db.select().from(audienceSuppressions).where(eq(audienceSuppressions.contactId, contactId)),
        db.select().from(audienceSavedContent).where(eq(audienceSavedContent.contactId, contactId)),
        db.select().from(competitionEntries).where(eq(competitionEntries.contactId, contactId)),
        db.select().from(audienceActivityEvents).where(eq(audienceActivityEvents.contactId, contactId)),
        db.select().from(audienceSegmentMembers).where(eq(audienceSegmentMembers.contactId, contactId)),
        db
          .select({ campaignId: emailDeliveryRecords.campaignId, status: emailDeliveryRecords.status, eventType: emailDeliveryRecords.eventType, eventAt: emailDeliveryRecords.eventAt, createdAt: emailDeliveryRecords.createdAt })
          .from(emailDeliveryRecords)
          .where(eq(emailDeliveryRecords.contactId, contactId))
      ]);
      return {
        generatedAt: now.toISOString(),
        subject: { contactId },
        contact: contact,
        subscriptions,
        preferences: preferences[0] ?? null,
        consentEvents,
        suppressions,
        savedContent,
        competitionEntries: entries,
        activity,
        segmentMemberships,
        emailDeliveries
      };
    },

    async settleRequest(id, input, now) {
      const [row] = await db
        .update(privacyRequests)
        .set({ status: input.status, decidedByUserId: input.decidedByUserId, decisionNote: input.decisionNote, decidedAt: now, completedAt: input.status === "completed" ? now : null, resultSummary: input.resultSummary, updatedAt: now })
        .where(and(eq(privacyRequests.id, id), eq(privacyRequests.status, "requested")))
        .returning();
      return row ? toRecord(row) : undefined;
    },

    async eraseContact(contactId, now): Promise<DataCounts> {
      const [contact] = await db.select().from(audienceContacts).where(eq(audienceContacts.id, contactId)).for("update");
      if (!contact) throw new Error("Contact not found.");
      const placeholder = erasedEmail(contactId);
      // Already erased (a retry): nothing left to do, and nothing is counted twice.
      if (contact.emailNormalised === placeholder) return { alreadyErased: 1 };

      // Keep the address on the suppression list so a later import or sign-up cannot quietly
      // re-subscribe someone who asked to be forgotten. This is the one place the address survives,
      // and it is the minimum needed to honour the request.
      const [active] = await db
        .select({ id: audienceSuppressions.id })
        .from(audienceSuppressions)
        .where(and(eq(audienceSuppressions.contactId, contactId), eq(audienceSuppressions.active, true), isNullTerritory()));
      if (!active) {
        await db.insert(audienceSuppressions).values({ contactId, emailNormalised: contact.emailNormalised, reason: "erasure_request", source: "privacy", active: true, suppressedAt: now, metadata: {} });
      }

      const counts: DataCounts = {};
      const deleted = async (query: Promise<unknown[]>) => (await query).length;

      counts.activity = await deleted(db.delete(audienceActivityEvents).where(eq(audienceActivityEvents.contactId, contactId)).returning({ id: audienceActivityEvents.id }));
      counts.savedContent = await deleted(db.delete(audienceSavedContent).where(eq(audienceSavedContent.contactId, contactId)).returning({ id: audienceSavedContent.id }));
      counts.competitionEntries = await deleted(db.delete(competitionEntries).where(eq(competitionEntries.contactId, contactId)).returning({ id: competitionEntries.id }));
      counts.preferences = await deleted(db.delete(audiencePreferenceProfiles).where(eq(audiencePreferenceProfiles.contactId, contactId)).returning({ id: audiencePreferenceProfiles.id }));
      counts.segmentMemberships = await deleted(db.delete(audienceSegmentMembers).where(eq(audienceSegmentMembers.contactId, contactId)).returning({ id: audienceSegmentMembers.id }));

      // Consent history is kept as proof of what was agreed and when, but stripped of anything
      // that could identify the person (IP, user agent) and no longer linked to a real identity.
      counts.consentEvents = await deleted(db.update(audienceConsentEvents).set({ evidence: {}, updatedAt: now }).where(eq(audienceConsentEvents.contactId, contactId)).returning({ id: audienceConsentEvents.id }));

      counts.subscriptions = await deleted(
        db
          .update(audienceTerritorySubscriptions)
          .set({ status: "unsubscribed", unsubscribedAt: now, preferences: {}, deletedAt: now, updatedAt: now })
          .where(eq(audienceTerritorySubscriptions.contactId, contactId))
          .returning({ id: audienceTerritorySubscriptions.id })
      );

      // Delivery history stays for campaign reporting, minus the address and provider metadata.
      counts.emailDeliveries = await deleted(
        db.update(emailDeliveryRecords).set({ emailNormalised: placeholder, metadata: {}, updatedAt: now }).where(eq(emailDeliveryRecords.contactId, contactId)).returning({ id: emailDeliveryRecords.id })
      );

      // Frozen send lists embed the recipient's name and address. Rewrite just that entry, keeping
      // the array order, because in-flight sends address recipients by position.
      const snapshots = (await db.execute(sql`
        UPDATE email_recipient_snapshots
        SET recipients = (
          SELECT COALESCE(jsonb_agg(
            CASE WHEN r.value->>'contactId' = ${contactId}
              THEN r.value || jsonb_build_object('emailNormalised', ${placeholder}::text, 'firstName', NULL, 'lastName', NULL)
              ELSE r.value END
            ORDER BY r.ordinality), '[]'::jsonb)
          FROM jsonb_array_elements(recipients) WITH ORDINALITY AS r(value, ordinality)
        )
        WHERE recipients @> jsonb_build_array(jsonb_build_object('contactId', ${contactId}::text))
        RETURNING id`)) as unknown as unknown[];
      counts.recipientSnapshots = snapshots.length;

      await db
        .update(audienceContacts)
        .set({ email: placeholder, emailNormalised: placeholder, firstName: null, lastName: null, emailStatus: "erased", tags: [], metadata: {}, deletedAt: now, updatedAt: now })
        .where(eq(audienceContacts.id, contactId));
      counts.contact = 1;

      return counts;
    }
  };
}

// An active suppression that applies to the whole network (no territory), the broadest one.
function isNullTerritory() {
  return sql`${audienceSuppressions.territoryId} IS NULL`;
}
