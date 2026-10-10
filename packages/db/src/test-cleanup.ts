import { inArray } from "drizzle-orm";
import {
  audienceActivityEvents, competitionEntries, audienceConsentEvents, audienceContacts, audiencePreferenceProfiles, audienceSavedContent, audienceSuppressions, audienceTerritorySubscriptions,
  marketingJourneyAudienceEntries, marketingJourneyExecutions, marketingJourneyStepExecutions
} from "./schema";

type Db = {
  select(...args: any[]): any;
  delete(table: any): { where(condition: any): PromiseLike<unknown> };
};

/**
 * For tests that create audience contacts in a shared database. Anything attached to a contact has to go
 * first, and now that the journey engine enters new subscribers into journeys on its own, that includes
 * journey entries a test never asked for. Not for application code.
 */
export async function deleteAudienceContactsForTests(db: Db, contactIds: string[]) {
  if (contactIds.length === 0) return;
  const entries: Array<{ id: string }> = await db.select({ id: marketingJourneyAudienceEntries.id }).from(marketingJourneyAudienceEntries).where(inArray(marketingJourneyAudienceEntries.contactId, contactIds));
  if (entries.length > 0) {
    const entryIds = entries.map((entry) => entry.id);
    const executions: Array<{ id: string }> = await db.select({ id: marketingJourneyExecutions.id }).from(marketingJourneyExecutions).where(inArray(marketingJourneyExecutions.entryId, entryIds));
    if (executions.length > 0) await db.delete(marketingJourneyStepExecutions).where(inArray(marketingJourneyStepExecutions.executionId, executions.map((row) => row.id)));
    await db.delete(marketingJourneyExecutions).where(inArray(marketingJourneyExecutions.entryId, entryIds));
    await db.delete(marketingJourneyAudienceEntries).where(inArray(marketingJourneyAudienceEntries.id, entryIds));
  }
  await db.delete(competitionEntries).where(inArray(competitionEntries.contactId, contactIds));
  await db.delete(audienceConsentEvents).where(inArray(audienceConsentEvents.contactId, contactIds));
  await db.delete(audienceSavedContent).where(inArray(audienceSavedContent.contactId, contactIds));
  await db.delete(audiencePreferenceProfiles).where(inArray(audiencePreferenceProfiles.contactId, contactIds));
  await db.delete(audienceSuppressions).where(inArray(audienceSuppressions.contactId, contactIds));
  await db.delete(audienceActivityEvents).where(inArray(audienceActivityEvents.contactId, contactIds));
  await db.delete(audienceTerritorySubscriptions).where(inArray(audienceTerritorySubscriptions.contactId, contactIds));
  await db.delete(audienceContacts).where(inArray(audienceContacts.id, contactIds));
}
