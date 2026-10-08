import { recordAuditEvent } from "@raring2go/audit";
import { createDrizzleAiRunStore, decideAiRun, getAiRunForActor, markAiRunApplied } from "@raring2go/ai";
import { createDb, foundationSeed } from "@raring2go/db";
import {
  approveContentVariant,
  contentRepurposeTask,
  findUnsupportedFacts,
  insertContentAiTaskRecord,
  insertContentChannelVariantRecord,
  insertContentChannelVariantVersionRecord,
  repurposeChannels,
  repurposeContentVariant,
  updateContentAiTaskDecision,
  updateContentChannelVariantRecord,
  updateContentChannelVariantVersionApproval,
  createDraftEventContentFromSuggestion,
  createDrizzleEventSuggestionStore,
  EventAccessError,
  eventsDiscoverTask,
  ingestDiscoveredEvents,
  listEventSuggestionsForActor,
  recordEventApproval,
  rejectEventSuggestion,
  requireApprovableSuggestion,
  contentDraftTask,
  createContentItemFromAiDraft,
  insertContentDomainEventRecords,
  insertContentItemVersionRecord,
  insertContentItemWithVersion,
  reviseDraftContentFromAi,
  updateContentItemDraftFields,
  listEditionControlRoom,
  listContentLibrary,
  listSocialQueue,
  socialContentGaps,
  readContentWorkspace,
  loadPublishingData
} from "@raring2go/publishing";
import type {
  EditionControlRoomRow,
  PublishingActorContext,
  PublishingData
} from "@raring2go/publishing";
import { evaluatePermission } from "@raring2go/permissions";
import type { PermissionData } from "@raring2go/permissions";
import { runAiTaskAsActor } from "./ai-runtime";
import { AiRunFailedError } from "@raring2go/ai";
import { getPermissionData } from "./permission-source";

export async function listEditionFactoryRows(
  context: PublishingActorContext
): Promise<EditionControlRoomRow[]> {
  const publishingPermissionData = await getPermissionData();
  const data = await readPublishingData();
  return listEditionControlRoom(context, publishingPermissionData, data);
}

export async function readTerritoryEdition(
  context: PublishingActorContext,
  territoryEditionId: string
) {
  const publishingPermissionData = await getPermissionData();
  const data = await readPublishingData();
  const rows = listEditionControlRoom(context, publishingPermissionData, data);
  const row = rows.find((candidate) => candidate.territoryEdition.id === territoryEditionId);

  if (!row) {
    throw new Error("Edition was not found or is outside the active context.");
  }

  return {
    row,
    pages: data.editionPages
      .filter((page) => page.territoryEditionId === territoryEditionId && !page.deletedAt)
      .sort((left, right) => left.pageNumber - right.pageNumber),
    content: data.territoryEditionContent.filter(
      (content) => content.territoryEditionId === territoryEditionId && !content.deletedAt
    ),
    outputs: data.publicationOutputs.filter(
      (output) => output.territoryEditionId === territoryEditionId && !output.deletedAt
    )
  };
}

export async function listContentLibraryItems(context: PublishingActorContext) {
  const publishingPermissionData = await getPermissionData();
  const data = await readPublishingData();
  return listContentLibrary(context, publishingPermissionData, data);
}

export async function readContentWorkspaceView(
  context: PublishingActorContext,
  contentItemId: string
) {
  const publishingPermissionData = await getPermissionData();
  const data = await readPublishingData();
  return readContentWorkspace(context, publishingPermissionData, data, contentItemId);
}

export async function readSocialQueue(context: PublishingActorContext) {
  const publishingPermissionData = await getPermissionData();
  const data = await readPublishingData();
  return {
    queue: listSocialQueue(context, publishingPermissionData, data),
    gaps: socialContentGaps(data)
  };
}

async function readPublishingData(): Promise<PublishingData> {
  const { db, sql } = createDb();

  try {
    return await loadPublishingData(db);
  } finally {
    await sql.end();
  }
}

// ---- AI content drafts (AI-002) ----------------------------------------------------

/** The publishing domain records flat audit events; map them onto the standard audit shape. */
function publishingAuditFor(db: Parameters<typeof recordAuditEvent>[0]) {
  return {
    record: (event: { action: string; actorUserId?: string | null; entityType: string; entityId?: string | null; organisationId?: string | null; territoryId?: string | null; payload?: Record<string, unknown> }) =>
      recordAuditEvent(db, {
        action: event.action,
        actor: { type: "human", userId: event.actorUserId ?? "" },
        entity: { type: event.entityType, id: event.entityId ?? undefined },
        scope: { organisationId: event.organisationId ?? undefined, territoryId: event.territoryId ?? undefined },
        after: event.payload
      }).then(() => undefined)
  };
}

/** Non-throwing check for showing the AI affordances: AI generate plus the right to create/edit content. */
export function hasContentAiCapability(permissions: PermissionData, context: PublishingActorContext): boolean {
  return (["contentAiGenerate", "contentEdit"] as const).every((capability) => {
    const required = { contentAiGenerate: { module: "content.ai", action: "generate" }, contentEdit: { module: "content", action: "edit" } }[capability];
    return evaluatePermission(
      { userId: context.userId, module: required.module, action: required.action, context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } },
      permissions
    ).allowed;
  });
}

export type ContentDraftRequest = { brief: string; contentType: string; contentItemId?: string | null };

const CONTENT_TYPES = ["article", "event", "offer", "guide", "announcement", "evergreen"];

/** Runs the content-draft task. Returns the run to review; nothing is written to content yet. */
export async function requestContentDraft(context: PublishingActorContext, request: ContentDraftRequest) {
  const publishingPermissionData = await getPermissionData();
  const brief = request.brief.trim();
  if (brief.length < 10) throw new Error("Write a little more in the brief (at least a sentence).");
  if (brief.length > 3000) throw new Error("Keep the brief under 3,000 characters.");
  if (!CONTENT_TYPES.includes(request.contentType)) throw new Error("Choose a content type.");

  const data = await readPublishingData();
  const territoryName = context.territoryId ? data.territories.find((territory) => territory.id === context.territoryId)?.name ?? null : null;
  let existing: { title: string; standfirst: string | null; body: string | null } | null = null;

  if (request.contentItemId) {
    // The workspace read enforces content.view and territory scope for this actor.
    const workspace = readContentWorkspace(context, publishingPermissionData, data, request.contentItemId);
    const item = workspace.libraryItem.item;
    if (item.status !== "draft") throw new Error("Only draft content can be revised with AI.");
    const latest = [...workspace.versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
    existing = { title: item.title, standfirst: item.standfirst ?? null, body: typeof latest?.snapshot.body === "string" ? latest.snapshot.body : null };
  }

  const { run } = await runAiTaskAsActor(
    context,
    publishingPermissionData,
    contentDraftTask,
    {
      input: { brief, contentType: request.contentType, territoryName, existing },
      subject: request.contentItemId ? { type: "content_item", id: request.contentItemId } : undefined
    }
  );
  return run;
}

export async function readContentDraftRun(context: PublishingActorContext, runId: string) {
  const publishingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    const run = await getAiRunForActor(context, publishingPermissionData, createDrizzleAiRunStore(db), runId);
    if (run.taskKey !== contentDraftTask.key) throw new Error("This AI run is not a content draft.");
    return run;
  } finally {
    await sql.end();
  }
}

/**
 * Accepting is one transaction: the content record (or revision), the run's approval and
 * the "applied" mark commit together, so a failure never leaves content without its
 * provenance or a run marked used that was not.
 */
export async function acceptContentDraft(context: PublishingActorContext, runId: string) {
  const publishingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const handle = tx as unknown as Parameters<typeof createDrizzleAiRunStore>[0];
      const store = createDrizzleAiRunStore(handle);
      const audit = { record: (input: Parameters<typeof recordAuditEvent>[1]) => recordAuditEvent(tx, input) };
      const publishingAudit = publishingAuditFor(tx);
      const run = await getAiRunForActor(context, publishingPermissionData, store, runId);

      if (run.taskKey !== contentDraftTask.key || run.status !== "succeeded") throw new Error("This AI run has no content draft to accept.");
      if (run.approvalState !== "pending") throw new Error(`This draft was already ${run.approvalState.replace("_", " ")}.`);

      const output = contentDraftTask.fromStructured!(run.output, { brief: "", contentType: "article" });
      const draft = { title: output.title, standfirst: output.standfirst, body: output.body, notes: output.notes };
      const data = await loadPublishingData(tx);
      const eventsBefore = data.contentDomainEvents.length;
      const versionId = crypto.randomUUID();
      let contentItemId: string;

      if (run.subjectType === "content_item" && run.subjectId) {
        const { item, version } = await reviseDraftContentFromAi(context, publishingPermissionData, publishingAudit, data, run.subjectId, { versionId, draft, aiRunId: run.id });
        await insertContentItemVersionRecord(tx, version);
        await updateContentItemDraftFields(tx, item);
        contentItemId = item.id;
      } else {
        const contentType = typeof run.input.contentType === "string" ? run.input.contentType : "article";
        const { item, version } = await createContentItemFromAiDraft(context, publishingPermissionData, publishingAudit, data, {
          itemId: crypto.randomUUID(),
          versionId,
          contentType,
          draft,
          aiRunId: run.id,
          territoryId: context.territoryId ?? null,
          organisationId: context.organisationId
        });
        await insertContentItemWithVersion(tx, item, version);
        contentItemId = item.id;
      }

      await insertContentDomainEventRecords(tx, data.contentDomainEvents.slice(eventsBefore));
      await decideAiRun(context, publishingPermissionData, audit, store, runId, { state: "approved", note: "Accepted in Content Studio" });
      await markAiRunApplied(context, publishingPermissionData, audit, store, runId);
      return { contentItemId };
    });
  } finally {
    await sql.end();
  }
}

export async function rejectContentDraft(context: PublishingActorContext, runId: string) {
  const publishingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) =>
      decideAiRun(
        context,
        publishingPermissionData,
        { record: (input) => recordAuditEvent(tx, input) },
        createDrizzleAiRunStore(tx as unknown as Parameters<typeof createDrizzleAiRunStore>[0]),
        runId,
        { state: "rejected", note: "Rejected in Content Studio" }
      )
    );
  } finally {
    await sql.end();
  }
}


// ---- AI event discovery (AI-003) ---------------------------------------------------

export type EventDiscoveryRequest = { territoryId: string; from: string; to: string; interests?: string[]; maxResults?: number };

const MAX_RANGE_DAYS = 90;
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

export function hasEventCapability(permissions: PermissionData, context: PublishingActorContext, action: "discover" | "decide") {
  return evaluatePermission(
    { userId: context.userId, module: "content.event_suggestion", action, context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } },
    permissions
  ).allowed;
}

export function listDiscoverableTerritories(context: PublishingActorContext) {
  return foundationSeed.territories
    .filter((territory) => !context.territoryId || territory.id === context.territoryId)
    .map((territory) => ({ id: territory.id, name: territory.name }));
}

/**
 * Runs the events workflow for one territory and queues what it finds as pending suggestions.
 * Nothing here creates or publishes content: that needs a person to approve each suggestion.
 */
export async function discoverEvents(context: PublishingActorContext, request: EventDiscoveryRequest) {
  const publishingPermissionData = await getPermissionData();
  if (!isDate(request.from) || !isDate(request.to)) throw new Error("Choose a valid date range.");
  const days = (new Date(`${request.to}T00:00:00Z`).getTime() - new Date(`${request.from}T00:00:00Z`).getTime()) / 86_400_000;
  if (days < 0) throw new Error("The end date must be after the start date.");
  if (days > MAX_RANGE_DAYS) throw new Error(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);
  const maxResults = Math.min(Math.max(Math.floor(request.maxResults ?? 10), 1), 20);

  const territory = foundationSeed.territories.find((candidate) => candidate.id === request.territoryId);
  if (!territory) throw new EventAccessError("Territory not found.");
  // Scope is verified by the domain (ingest) as well, but fail early before any model spend.
  if (!evaluatePermission({ userId: context.userId, module: "content.event_suggestion", action: "discover", resource: { territoryId: territory.id } }, publishingPermissionData).allowed) {
    throw new EventAccessError("You do not have permission to discover events for this territory.");
  }

  const interests = (request.interests ?? []).map((interest) => interest.trim()).filter(Boolean).slice(0, 8);
  const { run, output } = await runAiTaskAsActor(
    context,
    publishingPermissionData,
    eventsDiscoverTask,
    {
      input: { territoryId: territory.id, territoryName: territory.name, from: request.from, to: request.to, interests, maxResults },
      subject: { type: "territory", id: territory.id }
    }
  );

  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadPublishingData(tx);
      const existing = data.contentItems
        .filter((item) => item.contentType === "event" && item.territoryId === territory.id && !item.deletedAt)
        .map((item) => ({
          id: item.id,
          kind: "content" as const,
          title: item.title,
          startsAt: typeof item.relevantDates.startsAt === "string" ? new Date(item.relevantDates.startsAt) : null,
          sourceUrl: item.sourceReference ?? null
        }));
      const result = await ingestDiscoveredEvents(
        context,
        publishingPermissionData,
        { record: (input) => recordAuditEvent(tx, input) },
        createDrizzleEventSuggestionStore(tx as never),
        existing,
        { territoryId: territory.id, aiRunId: run.id, rawEvents: output.events, from: request.from, to: request.to, maxResults }
      );
      return { runId: run.id, territoryName: territory.name, created: result.created.length, duplicates: result.duplicates, invalid: result.invalid.length };
    });
  } finally {
    await sql.end();
  }
}

export async function readEventSuggestions(context: PublishingActorContext, status?: "pending" | "approved" | "rejected") {
  const publishingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await listEventSuggestionsForActor(context, publishingPermissionData, createDrizzleEventSuggestionStore(db as never), { status, limit: 200 });
  } finally {
    await sql.end();
  }
}

/** Approving creates a DRAFT event content item and records the decision in one transaction. */
export async function approveEventSuggestionAsActor(context: PublishingActorContext, suggestionId: string, note: string | null) {
  const publishingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const store = createDrizzleEventSuggestionStore(tx as never);
      const suggestion = await requireApprovableSuggestion(context, publishingPermissionData, store, suggestionId);
      const data = await loadPublishingData(tx);
      const eventsBefore = data.contentDomainEvents.length;
      const { item, version } = await createDraftEventContentFromSuggestion(context, publishingPermissionData, publishingAuditFor(tx), data, {
        itemId: crypto.randomUUID(),
        versionId: crypto.randomUUID(),
        organisationId: context.organisationId,
        suggestion
      });
      await insertContentItemWithVersion(tx, item, version);
      await insertContentDomainEventRecords(tx, data.contentDomainEvents.slice(eventsBefore));
      await recordEventApproval(context, { record: (input) => recordAuditEvent(tx, input) }, store, suggestion, { contentItemId: item.id, note });
      return { contentItemId: item.id };
    });
  } finally {
    await sql.end();
  }
}

export async function rejectEventSuggestionAsActor(context: PublishingActorContext, suggestionId: string, note: string | null) {
  const publishingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) =>
      rejectEventSuggestion(context, publishingPermissionData, { record: (input) => recordAuditEvent(tx, input) }, createDrizzleEventSuggestionStore(tx as never), suggestionId, note)
    );
  } finally {
    await sql.end();
  }
}


// ---- AI repurposing (AI-004) -------------------------------------------------------

export type RepurposeResult = {
  created: Array<{ channel: string; variantId: string; unsupportedFacts: string[] }>;
  failed: Array<{ channel: string; message: string }>;
};

/**
 * Generates a variant per channel from APPROVED source content. Each channel is its own AI
 * run (recorded in AI Runs); all successful variants are then written in one transaction.
 * Variants land as `ai_draft` with a link to the source version and run, and need approval
 * before use. One channel failing never discards the others.
 */
export async function repurposeContentWithAi(context: PublishingActorContext, contentItemId: string, channels: string[]): Promise<RepurposeResult> {
  const publishingPermissionData = await getPermissionData();
  const wanted = [...new Set(channels)].filter((channel): channel is (typeof repurposeChannels)[number] => (repurposeChannels as readonly string[]).includes(channel));
  if (wanted.length === 0) throw new Error("Choose at least one channel.");

  const data = await readPublishingData();
  // Enforces content.view and territory scope for this actor.
  const workspace = readContentWorkspace(context, publishingPermissionData, data, contentItemId);
  const item = workspace.libraryItem.item;
  if (item.status !== "approved" && item.status !== "published") throw new Error(`Only approved content can be repurposed with AI; this item is ${item.status}.`);

  const latest = [...workspace.versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
  const body = typeof latest?.snapshot.body === "string" ? latest.snapshot.body : item.standfirst ?? item.title;
  const sourceText = [item.title, item.standfirst ?? "", body, ...item.tags].join("\n");
  const territoryName = context.territoryId ? data.territories.find((territory) => territory.id === context.territoryId)?.name ?? null : null;

  const generated: Array<{ channel: string; run: Awaited<ReturnType<typeof runAiTaskAsActor>>["run"]; output: Record<string, unknown>; unsupportedFacts: string[] }> = [];
  const failed: RepurposeResult["failed"] = [];

  for (const channel of wanted) {
    try {
      const { run, output } = await runAiTaskAsActor(
        context,
        publishingPermissionData,
        contentRepurposeTask,
        { input: { channel, contentItemId: item.id, title: item.title, standfirst: item.standfirst ?? null, body, tags: item.tags, territoryName }, subject: { type: "content_item", id: item.id } }
      );
      generated.push({ channel, run, output, unsupportedFacts: findUnsupportedFacts(sourceText, output) });
    } catch (error) {
      // Config, permission and rate/spend problems affect every channel: stop and report them.
      if (!(error instanceof AiRunFailedError)) throw error;
      failed.push({ channel, message: error.message });
    }
  }

  const created: RepurposeResult["created"] = [];

  if (generated.length > 0) {
    const { db, sql } = createDb();

    try {
      await db.transaction(async (tx) => {
        const fresh = await loadPublishingData(tx);
        const eventsBefore = fresh.contentDomainEvents.length;
        const audit = publishingAuditFor(tx);

        for (const entry of generated) {
          const knownVariantIds = new Set(fresh.contentChannelVariants.map((variant) => variant.id));
          const { task, variant, version } = await repurposeContentVariant(context, publishingPermissionData, audit, fresh, item.id, entry.channel, {
            taskId: crypto.randomUUID(),
            promptTemplateVersion: entry.run.promptVersion,
            providerKey: entry.run.providerKey,
            modelReference: entry.run.modelReference,
            generated: { output: entry.output, aiRunId: entry.run.id, unsupportedFacts: entry.unsupportedFacts }
          });

          // The variant must exist before its version and task rows can reference it.
          if (knownVariantIds.has(variant.id)) await updateContentChannelVariantRecord(tx, variant);
          else await insertContentChannelVariantRecord(tx, { ...variant, currentVersionId: null });
          await insertContentAiTaskRecord(tx, task);
          await insertContentChannelVariantVersionRecord(tx, version);
          await updateContentChannelVariantRecord(tx, variant);
          created.push({ channel: entry.channel, variantId: variant.id, unsupportedFacts: entry.unsupportedFacts });
        }
        await insertContentDomainEventRecords(tx, fresh.contentDomainEvents.slice(eventsBefore));
      });
    } finally {
      await sql.end();
    }
  }

  return { created, failed };
}

/** Approves a variant's current version; also approves and applies the AI run that produced it. */
export async function approveContentVariantAsActor(context: PublishingActorContext, variantId: string) {
  const publishingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const data = await loadPublishingData(tx);
      const eventsBefore = data.contentDomainEvents.length;
      const variant = await approveContentVariant(context, publishingPermissionData, publishingAuditFor(tx), data, variantId);
      const version = data.contentChannelVariantVersions.find((candidate) => candidate.id === variant.currentVersionId)!;
      const task = version.generatedByTaskId ? data.contentAiTasks.find((candidate) => candidate.id === version.generatedByTaskId) : undefined;

      await updateContentChannelVariantRecord(tx, variant);
      await updateContentChannelVariantVersionApproval(tx, version);
      if (task) await updateContentAiTaskDecision(tx, task);
      await insertContentDomainEventRecords(tx, data.contentDomainEvents.slice(eventsBefore));

      const aiRunId = typeof version.provenance.aiRunId === "string" ? version.provenance.aiRunId : null;
      if (aiRunId) {
        const store = createDrizzleAiRunStore(tx as unknown as Parameters<typeof createDrizzleAiRunStore>[0]);
        const audit = { record: (input: Parameters<typeof recordAuditEvent>[1]) => recordAuditEvent(tx, input) };
        const run = await store.get(aiRunId);
        // Best effort: the run may already have been decided from the AI Runs console.
        if (run?.approvalState === "pending") {
          await decideAiRun(context, publishingPermissionData, audit, store, aiRunId, { state: "approved", note: "Variant approved in Content Studio" });
          await markAiRunApplied(context, publishingPermissionData, audit, store, aiRunId);
        }
      }
      return variant;
    });
  } finally {
    await sql.end();
  }
}
