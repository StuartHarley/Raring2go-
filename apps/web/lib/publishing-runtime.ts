import { recordAuditEvent } from "@raring2go/audit";
import { createDrizzleAiRunStore, decideAiRun, getAiRunForActor, markAiRunApplied } from "@raring2go/ai";
import { createDb, fixtureIds, foundationSeed } from "@raring2go/db";
import {
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
import { aiRunPermissionData, runAiTaskAsActor } from "./ai-runtime";

export const publishingPermissionData: PermissionData = {
  roleAssignments: [
    {
      id: "fixture_assignment_superadmin",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.superAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_hq",
      userId: fixtureIds.users.superAdmin,
      roleId: fixtureIds.roles.hqAdmin,
      organisationId: fixtureIds.organisations.hq
    },
    {
      id: "fixture_assignment_franchisee",
      userId: fixtureIds.users.franchisee,
      roleId: fixtureIds.roles.franchisee,
      organisationId: fixtureIds.organisations.franchise,
      territoryId: fixtureIds.territories.suttonColdfield
    }
  ],
  rolePermissions: [
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.editionView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.editionPageEdit, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.editionPreflightOverride, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.editionGeneratePrint, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.editionGenerateDigital, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.contentView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.contentAiGenerate, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.eventSuggestionView, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.eventSuggestionDiscover, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.eventSuggestionDecide, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.contentCreate, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.contentEdit, "network"),
    grant(fixtureIds.roles.hqAdmin, fixtureIds.permissions.socialView, "network"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.editionView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.editionPageEdit, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.contentView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.contentAiGenerate, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.eventSuggestionView, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.eventSuggestionDiscover, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.eventSuggestionDecide, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.contentCreate, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.contentEdit, "own_territory"),
    grant(fixtureIds.roles.franchisee, fixtureIds.permissions.socialView, "own_territory")
  ],
  territories: foundationSeed.territories.map((territory) => ({
    id: territory.id,
    franchiseOrganisationId: territory.franchiseOrganisationId
  }))
};

export async function listEditionFactoryRows(
  context: PublishingActorContext
): Promise<EditionControlRoomRow[]> {
  const data = await readPublishingData();
  return listEditionControlRoom(context, publishingPermissionData, data);
}

export async function readTerritoryEdition(
  context: PublishingActorContext,
  territoryEditionId: string
) {
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
  const data = await readPublishingData();
  return listContentLibrary(context, publishingPermissionData, data);
}

export async function readContentWorkspaceView(
  context: PublishingActorContext,
  contentItemId: string
) {
  const data = await readPublishingData();
  return readContentWorkspace(context, publishingPermissionData, data, contentItemId);
}

export async function readSocialQueue(context: PublishingActorContext) {
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

function grant(roleId: string, permissionId: string, scope: string) {
  const permission = foundationSeed.permissions.find((candidate) => candidate.id === permissionId);

  if (!permission) {
    throw new Error("Publishing permission fixture is inconsistent.");
  }

  return {
    roleId,
    permission,
    scope,
    constraints: {}
  };
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
export function hasContentAiCapability(context: PublishingActorContext): boolean {
  return (["contentAiGenerate", "contentEdit"] as const).every((capability) => {
    const required = { contentAiGenerate: { module: "content.ai", action: "generate" }, contentEdit: { module: "content", action: "edit" } }[capability];
    return evaluatePermission(
      { userId: context.userId, module: required.module, action: required.action, context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } },
      publishingPermissionData
    ).allowed;
  });
}

export type ContentDraftRequest = { brief: string; contentType: string; contentItemId?: string | null };

const CONTENT_TYPES = ["article", "event", "offer", "guide", "announcement", "evergreen"];

/** Runs the content-draft task. Returns the run to review; nothing is written to content yet. */
export async function requestContentDraft(context: PublishingActorContext, request: ContentDraftRequest) {
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
  const { db, sql } = createDb();

  try {
    const run = await getAiRunForActor(context, aiRunPermissionData, createDrizzleAiRunStore(db), runId);
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
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) => {
      const handle = tx as unknown as Parameters<typeof createDrizzleAiRunStore>[0];
      const store = createDrizzleAiRunStore(handle);
      const audit = { record: (input: Parameters<typeof recordAuditEvent>[1]) => recordAuditEvent(tx, input) };
      const publishingAudit = publishingAuditFor(tx);
      const run = await getAiRunForActor(context, aiRunPermissionData, store, runId);

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
      await decideAiRun(context, aiRunPermissionData, audit, store, runId, { state: "approved", note: "Accepted in Content Studio" });
      await markAiRunApplied(context, aiRunPermissionData, audit, store, runId);
      return { contentItemId };
    });
  } finally {
    await sql.end();
  }
}

export async function rejectContentDraft(context: PublishingActorContext, runId: string) {
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) =>
      decideAiRun(
        context,
        aiRunPermissionData,
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

export function hasEventCapability(context: PublishingActorContext, action: "discover" | "decide") {
  return evaluatePermission(
    { userId: context.userId, module: "content.event_suggestion", action, context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } },
    publishingPermissionData
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
  const { db, sql } = createDb();

  try {
    return await listEventSuggestionsForActor(context, publishingPermissionData, createDrizzleEventSuggestionStore(db as never), { status, limit: 200 });
  } finally {
    await sql.end();
  }
}

/** Approving creates a DRAFT event content item and records the decision in one transaction. */
export async function approveEventSuggestionAsActor(context: PublishingActorContext, suggestionId: string, note: string | null) {
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
  const { db, sql } = createDb();

  try {
    return await db.transaction(async (tx) =>
      rejectEventSuggestion(context, publishingPermissionData, { record: (input) => recordAuditEvent(tx, input) }, createDrizzleEventSuggestionStore(tx as never), suggestionId, note)
    );
  } finally {
    await sql.end();
  }
}
