import { recordAuditEvent } from "@raring2go/audit";
import { competitionEntries, contentItems, createDb, publicationOutputs, schoolHolidayPeriods, territoryEditions } from "@raring2go/db";
import { competitionClosingDate } from "./competition-runtime";
import { escapeHtml, formatHolidayDate, holidaysDueForCountdown, isoWeekKey } from "@raring2go/marketing";
import { getPublicDiscovery, territorySlug } from "@raring2go/public";
import {
  JourneyEntryNotEligibleError,
  advanceJourneyExecution,
  claimNextJourneyExecution,
  enterJourneyFromEvent,
  executeJourneyStep,
  findActiveJourneysForTrigger,
  findInactiveContactIds,
  insertEmailRecipientSnapshotRecord,
  insertEmailSendJobRecordIfMissing,
  insertJourneyAudienceEntryRecord,
  insertJourneyExecutionRecord,
  insertJourneyStepCampaignGraph,
  insertJourneyStepExecutionRecord,
  loadJourneyExecutionBundle,
  loadMarketingData,
  updateJourneyAudienceEntryRecord
} from "@raring2go/marketing";
import type { JourneyEntryContent, MarketingActorContext } from "@raring2go/marketing";
import type { PermissionData } from "@raring2go/permissions";
import { and, eq, gte, isNull } from "drizzle-orm";

type Db = ReturnType<typeof createDb>["db"];

// Dedicated system identity, isolated from the human-facing permission data: this worker never acts on a human's behalf.
const WORKER_ACTOR_ID = "journey-execute-worker";
const WORKER_ROLE_ID = "journey-execute-worker-role";
export const journeyWorkerContext: MarketingActorContext = { userId: WORKER_ACTOR_ID };

const grant = (module: string, action: string) => ({ roleId: WORKER_ROLE_ID, permission: { id: `journey-worker:${module}:${action}`, module, action }, scope: "network" });
export const journeyWorkerPermissions: PermissionData = {
  roleAssignments: [{ id: "journey-execute-worker-assignment", userId: WORKER_ACTOR_ID, roleId: WORKER_ROLE_ID }],
  rolePermissions: [
    grant("marketing.journey", "execute"),
    grant("marketing.audience", "view"),
    grant("marketing.email", "create"),
    grant("marketing.email", "approve"),
    grant("marketing.email", "schedule")
  ]
};

export function journeyWorkerAudit(db: Parameters<typeof recordAuditEvent>[0]) {
  return {
    record: async (input: { action: string; entityType: string; entityId?: string | null; organisationId?: string | null; territoryId?: string | null; payload?: Record<string, unknown> }) => {
      await recordAuditEvent(db, {
        action: input.action,
        actor: { type: "system", systemId: WORKER_ACTOR_ID },
        entity: { type: input.entityType, id: input.entityId ?? undefined },
        scope: { territoryId: input.territoryId ?? undefined },
        after: input.payload
      });
    }
  };
}

export type JourneyExecutionOutcome =
  | { claimed: false }
  | { claimed: true; executionId: string; status?: string; stepKey?: string; skipped?: boolean; error?: string };

/**
 * Runs the next due journey step. Claiming uses a skip-locked update, so concurrent workers never take the
 * same execution, and a step is idempotent by its key, so a crashed run that is re-claimed cannot email twice.
 */
export async function processNextJourneyExecution(db: Db): Promise<JourneyExecutionOutcome> {
  const claimed = await claimNextJourneyExecution(db);
  if (!claimed) return { claimed: false };

  const fail = async (reason: string, error: string): Promise<JourneyExecutionOutcome> => {
    await advanceJourneyExecution(db, claimed.id, { status: "failed", failureReason: reason });
    return { claimed: true, executionId: claimed.id, error };
  };

  const bundle = await loadJourneyExecutionBundle(db, claimed.id);
  if (!bundle) return fail("missing_bundle", "missing_bundle");
  if (bundle.journey.status !== "active") return fail("journey_not_active", "journey_not_active");
  const stepKey = bundle.execution.currentStepKey;
  if (!stepKey) return fail("no_current_step", "no_current_step");

  const data = await loadMarketingData(db);
  let execution;
  try {
    execution = await executeJourneyStep(journeyWorkerContext, journeyWorkerPermissions, journeyWorkerAudit(db), data, claimed.id, stepKey, new Date().toISOString());
  } catch (error) {
    // Whatever partial in-memory state the step left behind is not trusted: always persist a definite "failed".
    return fail(error instanceof Error ? error.message : "unknown_error", "step_failed");
  }

  const stepExecution = data.journeyStepExecutions.find((candidate) => candidate.executionId === execution.id && candidate.stepKey === stepKey)!;
  // Only a step that really sent has a campaign to persist; a step skipped by a frequency cap has none.
  if (stepExecution.actionType === "send_email" && stepExecution.status === "completed") {
    const output = stepExecution.output as { campaignId: string; campaignVersionId: string; snapshotId: string; jobId: string };
    const campaign = data.emailCampaigns.find((candidate) => candidate.id === output.campaignId)!;
    const version = data.emailCampaignVersions.find((candidate) => candidate.id === output.campaignVersionId)!;
    const snapshot = data.emailRecipientSnapshots.find((candidate) => candidate.id === output.snapshotId)!;
    const job = data.emailSendJobs.find((candidate) => candidate.id === output.jobId)!;
    await insertJourneyStepCampaignGraph(db, { campaign, version });
    await insertEmailRecipientSnapshotRecord(db, snapshot);
    await insertEmailSendJobRecordIfMissing(db, job);
  }

  await insertJourneyStepExecutionRecord(db, stepExecution);
  await advanceJourneyExecution(db, execution.id, {
    status: execution.status,
    currentStepKey: execution.currentStepKey,
    runAfter: execution.runAfter,
    completedAt: execution.completedAt,
    failureReason: execution.failureReason
  });
  if (execution.status === "completed") {
    const entry = data.journeyAudienceEntries.find((candidate) => candidate.id === execution.entryId)!;
    await updateJourneyAudienceEntryRecord(db, entry);
  }

  return { claimed: true, executionId: execution.id, status: execution.status, stepKey, skipped: stepExecution.status === "skipped" };
}

/** Drains due executions up to a limit, so one tick of the job runtime does real work rather than one step. */
export async function runDueJourneyExecutions(db: Db, limit = 25) {
  const summary = { processed: 0, skipped: 0, failed: 0 };
  for (let index = 0; index < limit; index += 1) {
    const outcome = await processNextJourneyExecution(db);
    if (!outcome.claimed) break;
    summary.processed += 1;
    if (outcome.error) summary.failed += 1;
    if (outcome.skipped) summary.skipped += 1;
  }
  return summary;
}

const SCAN_LIMIT = 500;
const REENGAGE_COOLDOWN_DAYS = 180;
const EDITION_NOTICE_DAYS = 14;
const NEW_SUBSCRIBER_DAYS = 3;

/**
 * Finds people who should enter a trigger-based journey and enters them. Each person enters a journey at most
 * once per trigger occurrence (the key says which), so a re-run of the scan, or two overlapping runs, adds no one twice.
 *  - Re-engagement: subscribers quiet for the journey's days; the key buckets time, so someone re-enters at most
 *    once per 180 days.
 *  - Digital magazine: an area's subscribers, once per edition published in the last 14 days (so activating the
 *    journey does not email about an old issue).
 */
export async function scanJourneyTriggers(db: Db, now: Date = new Date()) {
  const entered = { welcome: 0, reengagement: 0, magazine: 0, holiday: 0, digest: 0, competition: 0, notEligible: 0 };

  await db.transaction(async (tx) => {
    const data = await loadMarketingData(tx);
    const audit = journeyWorkerAudit(tx);
    let budget = SCAN_LIMIT;

    /** Returns true when this call created a new entry. */
    const enter = async (input: { journeyId: string; contactId: string; territoryId: string; sourceEventType: string; sourceEventId: string; idempotencyKey: string; content?: JourneyEntryContent }) => {
      if (budget <= 0) return false;
      if (data.journeyAudienceEntries.some((existing) => existing.idempotencyKey === input.idempotencyKey)) return false;
      try {
        const entry = await enterJourneyFromEvent(journeyWorkerContext, journeyWorkerPermissions, audit, data, { ...input, enteredAt: now.toISOString() });
        await insertJourneyAudienceEntryRecord(tx, entry);
        const execution = data.journeyExecutions.find((candidate) => candidate.entryId === entry.id);
        if (execution) await insertJourneyExecutionRecord(tx, execution);
        budget -= 1;
        return true;
      } catch (error) {
        if (error instanceof JourneyEntryNotEligibleError) {
          entered.notEligible += 1;
          return false;
        }
        // Someone suppressed or unsubscribed is skipped, not a reason to abandon everyone else in the scan.
        if (error instanceof Error && /Suppressed contacts|not subscribed in the target territory/.test(error.message)) return false;
        throw error;
      }
    };

    // New subscribers, whatever route they came in by (parent preferences, staff). Imported people are not welcomed:
    // they never asked for this list to start emailing them today. The key matches the one the
    // direct subscribe path uses, so a person who was entered immediately is not entered a second time here.
    const recentSince = now.getTime() - NEW_SUBSCRIBER_DAYS * 86_400_000;
    for (const { journey } of findActiveJourneysForTrigger(data, { type: "contact_subscribed_to_territory" })) {
      for (const subscription of data.subscriptions.filter((item) => item.status === "subscribed" && !item.deletedAt && !item.source.startsWith("import:") && item.subscribedAt && Date.parse(item.subscribedAt) >= recentSince && (!journey.territoryId || journey.territoryId === item.territoryId))) {
        if (await enter({ journeyId: journey.id, contactId: subscription.contactId, territoryId: subscription.territoryId, sourceEventType: "audience.subscribed", sourceEventId: subscription.id, idempotencyKey: `audience.subscribed:${subscription.id}:${journey.id}` })) entered.welcome += 1;
      }
    }

    for (const { journey, version } of findActiveJourneysForTrigger(data, { type: "contact_inactive", days: 0 })) {
      if (version.trigger.type !== "contact_inactive") continue;
      const bucket = Math.floor(now.getTime() / (REENGAGE_COOLDOWN_DAYS * 86_400_000));
      for (const { contactId, territoryId } of findInactiveContactIds(data, { days: version.trigger.days, territoryId: journey.territoryId, at: now })) {
        if (await enter({ journeyId: journey.id, contactId, territoryId, sourceEventType: "audience.inactive", sourceEventId: `${journey.id}:${bucket}`, idempotencyKey: `scan:inactive:${journey.id}:${contactId}:${bucket}` })) entered.reengagement += 1;
      }
    }

    const magazineJourneys = findActiveJourneysForTrigger(data, { type: "digital_edition_published" });
    if (magazineJourneys.length > 0) {
      const since = new Date(now.getTime() - EDITION_NOTICE_DAYS * 86_400_000);
      const editions = await tx
        .select({ id: territoryEditions.id, territoryId: territoryEditions.territoryId })
        .from(territoryEditions)
        .innerJoin(publicationOutputs, eq(publicationOutputs.territoryEditionId, territoryEditions.id))
        .where(and(eq(territoryEditions.status, "published"), eq(publicationOutputs.outputType, "digital"), eq(publicationOutputs.status, "generated"), gte(publicationOutputs.createdAt, since)));

      for (const edition of editions) {
        for (const { journey } of magazineJourneys.filter(({ journey: candidate }) => !candidate.territoryId || candidate.territoryId === edition.territoryId)) {
          for (const subscription of data.subscriptions.filter((item) => item.territoryId === edition.territoryId && item.status === "subscribed" && !item.deletedAt)) {
            if (await enter({ journeyId: journey.id, contactId: subscription.contactId, territoryId: edition.territoryId, sourceEventType: "edition.published", sourceEventId: edition.id, idempotencyKey: `scan:edition:${edition.id}:${journey.id}:${subscription.contactId}` })) entered.magazine += 1;
          }
        }
      }
    }

    // School-holiday countdown: each subscriber, once per holiday, when it starts within the journey's days. The copy is filled
    // in from the calendar entry (name, dates, days away), so two different holidays never share an email.
    const holidayJourneys = findActiveJourneysForTrigger(data, { type: "school_holiday_approaching", daysBefore: 0 });
    if (holidayJourneys.length > 0) {
      const periods = (await tx.select().from(schoolHolidayPeriods).where(isNull(schoolHolidayPeriods.deletedAt))).map((row) => ({
        id: row.id, territoryId: row.territoryId, name: row.name, startsOn: row.startsOn.toISOString().slice(0, 10), endsOn: row.endsOn.toISOString().slice(0, 10)
      }));
      for (const { journey, version } of holidayJourneys) {
        if (version.trigger.type !== "school_holiday_approaching") continue;
        for (const subscription of data.subscriptions.filter((item) => item.status === "subscribed" && !item.deletedAt && (!journey.territoryId || journey.territoryId === item.territoryId))) {
          const areaName = data.territories.find((territory) => territory.id === subscription.territoryId)?.name ?? "your area";
          for (const holiday of holidaysDueForCountdown(periods, subscription.territoryId, version.trigger.daysBefore, now)) {
            const content: JourneyEntryContent = {
              variantKey: `holiday:${holiday.id}:${subscription.territoryId}`,
              fields: {
                holiday_name: { value: holiday.name },
                holiday_starts: { value: formatHolidayDate(holiday.startsOn) },
                holiday_ends: { value: formatHolidayDate(holiday.endsOn) },
                days_until: { value: String(holiday.daysUntil) },
                area_name: { value: areaName }
              }
            };
            if (await enter({ journeyId: journey.id, contactId: subscription.contactId, territoryId: subscription.territoryId, sourceEventType: "calendar.school_holiday", sourceEventId: holiday.id, idempotencyKey: `scan:holiday:${holiday.id}:${journey.id}:${subscription.contactId}:${subscription.territoryId}`, content })) entered.holiday += 1;
          }
        }
      }
    }

    // Weekly local digest: on the journey's weekday, each area that has events coming up, once per subscriber per week.
    const digestJourneys = findActiveJourneysForTrigger(data, { type: "weekly_digest", weekday: 0 }).filter(({ version }) => version.trigger.type === "weekly_digest" && version.trigger.weekday === now.getUTCDay());
    if (digestJourneys.length > 0) {
      const week = isoWeekKey(now);
      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000")).replace(/\/$/, "");
      if (!siteUrl) console.error("Weekly digest skipped: NEXT_PUBLIC_SITE_URL is not set, so event links cannot be made absolute.");
      const eventsByTerritory = new Map<string, string | null>();
      const eventsFor = async (territoryId: string) => {
        if (eventsByTerritory.has(territoryId)) return eventsByTerritory.get(territoryId)!;
        const territory = data.territories.find((candidate) => candidate.id === territoryId);
        const found = territory?.name ? await getPublicDiscovery(tx as never, territorySlug(territory.name), "whats_on") : undefined;
        const today = now.toISOString().slice(0, 10);
        const limit = new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
        const upcoming = (found?.items ?? []).filter((item) => item.startDate && item.startDate.slice(0, 10) >= today && item.startDate.slice(0, 10) <= limit).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))).slice(0, 5);
        const html = upcoming.length === 0 ? null : `<ul>${upcoming.map((item) => `<li><a href="${escapeHtml(`${siteUrl}${item.href}`)}">${escapeHtml(item.title)}</a> - ${escapeHtml(formatHolidayDate(item.startDate!.slice(0, 10)))}</li>`).join("")}</ul>`;
        eventsByTerritory.set(territoryId, html);
        return html;
      };
      for (const { journey } of digestJourneys) {
        for (const subscription of data.subscriptions.filter((item) => item.status === "subscribed" && !item.deletedAt && (!journey.territoryId || journey.territoryId === item.territoryId))) {
          if (!siteUrl) break;
          const html = await eventsFor(subscription.territoryId);
          if (!html) continue; // nothing coming up here: no digest, never an empty one
          const areaName = data.territories.find((territory) => territory.id === subscription.territoryId)?.name ?? "your area";
          const content: JourneyEntryContent = { variantKey: `digest:${subscription.territoryId}:${week}`, fields: { area_name: { value: areaName }, local_events: { value: html, html: true } } };
          if (await enter({ journeyId: journey.id, contactId: subscription.contactId, territoryId: subscription.territoryId, sourceEventType: "schedule.weekly_digest", sourceEventId: `${subscription.territoryId}:${week}`, idempotencyKey: `scan:digest:${journey.id}:${week}:${subscription.contactId}:${subscription.territoryId}`, content })) entered.digest += 1;
        }
      }
    }

    // Competition follow-up: each entrant of a competition that closed in the last 14 days, once, if they also subscribe to the area.
    // Entering alone never signs anyone up: someone who is not subscribed is simply not entered into the journey.
    const competitionJourneys = findActiveJourneysForTrigger(data, { type: "competition_closed" });
    if (competitionJourneys.length > 0) {
      const today = now.toISOString().slice(0, 10);
      const earliest = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
      const closed = (await tx.select({ id: contentItems.id, title: contentItems.title, relevantDates: contentItems.relevantDates }).from(contentItems).where(and(eq(contentItems.contentType, "competition"), isNull(contentItems.deletedAt))))
        .map((item) => ({ ...item, closedOn: competitionClosingDate(item.relevantDates) }))
        .filter((item) => item.closedOn && item.closedOn < today && item.closedOn >= earliest);
      for (const competition of closed) {
        const entries = await tx.select().from(competitionEntries).where(eq(competitionEntries.contentItemId, competition.id));
        for (const { journey } of competitionJourneys) {
          for (const entry of entries.filter((candidate) => !journey.territoryId || journey.territoryId === candidate.territoryId)) {
            if (!data.subscriptions.some((subscription) => subscription.contactId === entry.contactId && subscription.territoryId === entry.territoryId && subscription.status === "subscribed" && !subscription.deletedAt)) continue;
            const areaName = data.territories.find((territory) => territory.id === entry.territoryId)?.name ?? "your area";
            const content: JourneyEntryContent = { variantKey: `competition:${competition.id}:${entry.territoryId}`, fields: { competition_title: { value: competition.title }, area_name: { value: areaName } } };
            if (await enter({ journeyId: journey.id, contactId: entry.contactId, territoryId: entry.territoryId, sourceEventType: "competition.closed", sourceEventId: competition.id, idempotencyKey: `scan:competition:${competition.id}:${journey.id}:${entry.contactId}`, content })) entered.competition += 1;
          }
        }
      }
    }
  });

  return entered;
}
