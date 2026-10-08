import {
  editionContentItems,
  contentAiTasks,
  contentChannelVariantVersions,
  contentChannelVariants,
  contentDomainEvents,
  contentItemVersions,
  contentItems,
  contentLocalisations,
  contentWebsitePublishingJobs,
  editionPageRevisions,
  editionPages,
  magazineTemplateVersions,
  magazineTemplates,
  masterEditions,
  preflightResults,
  publicationOutputs,
  seasons,
  socialAccounts,
  socialProviderEvents,
  socialPublications,
  socialPublishJobs,
  territories,
  territoryEditionContent,
  territoryEditions
} from "@raring2go/db";
import { eq } from "drizzle-orm";
import type { PublishingData } from "./types";

type DrizzleDb = {
  select(): {
    from(table: unknown): Promise<Array<Record<string, unknown>>>;
  };
};

export async function loadPublishingData(db: DrizzleDb): Promise<PublishingData> {
  const [
    seasonRows,
    masterEditionRows,
    territoryEditionRows,
    templateRows,
    templateVersionRows,
    contentRows,
    territoryContentRows,
    pageRows,
    revisionRows,
    preflightRows,
    outputRows,
    contentItemRows,
    contentItemVersionRows,
    contentVariantRows,
    contentVariantVersionRows,
    contentLocalisationRows,
    contentAiTaskRows,
    contentWebsiteJobRows,
    contentDomainEventRows,
    socialAccountRows,
    socialPublicationRows,
    socialJobRows,
    socialProviderEventRows,
    territoryRows
  ] = await Promise.all([
    db.select().from(seasons),
    db.select().from(masterEditions),
    db.select().from(territoryEditions),
    db.select().from(magazineTemplates),
    db.select().from(magazineTemplateVersions),
    db.select().from(editionContentItems),
    db.select().from(territoryEditionContent),
    db.select().from(editionPages),
    db.select().from(editionPageRevisions),
    db.select().from(preflightResults),
    db.select().from(publicationOutputs),
    db.select().from(contentItems),
    db.select().from(contentItemVersions),
    db.select().from(contentChannelVariants),
    db.select().from(contentChannelVariantVersions),
    db.select().from(contentLocalisations),
    db.select().from(contentAiTasks),
    db.select().from(contentWebsitePublishingJobs),
    db.select().from(contentDomainEvents),
    db.select().from(socialAccounts),
    db.select().from(socialPublications),
    db.select().from(socialPublishJobs),
    db.select().from(socialProviderEvents),
    db.select().from(territories)
  ]);

  return {
    seasons: seasonRows.map((row) => ({
      ...row,
      publicationDate: dateString(row.publicationDate),
      bookingDeadline: dateString(row.bookingDeadline),
      artworkDeadline: dateString(row.artworkDeadline),
      editorialDeadline: dateString(row.editorialDeadline),
      proofDeadline: dateString(row.proofDeadline),
      printDeadline: dateString(row.printDeadline),
      distributionDate: dateString(row.distributionDate)
    })) as PublishingData["seasons"],
    masterEditions: masterEditionRows as PublishingData["masterEditions"],
    territoryEditions: territoryEditionRows.map((row) => ({
      ...row,
      publicationDate: dateString(row.publicationDate),
      bookingDeadline: dateString(row.bookingDeadline),
      artworkDeadline: dateString(row.artworkDeadline),
      editorialDeadline: dateString(row.editorialDeadline),
      proofDeadline: dateString(row.proofDeadline),
      printDeadline: dateString(row.printDeadline),
      distributionDate: dateString(row.distributionDate)
    })) as PublishingData["territoryEditions"],
    magazineTemplates: templateRows as PublishingData["magazineTemplates"],
    magazineTemplateVersions: templateVersionRows.map((row) => ({
      ...row,
      approvedAt: dateString(row.approvedAt),
      publishedAt: dateString(row.publishedAt)
    })) as PublishingData["magazineTemplateVersions"],
    editionContentItems: contentRows.map((row) => ({
      ...row,
      availableFrom: dateString(row.availableFrom),
      expiresAt: dateString(row.expiresAt)
    })) as PublishingData["editionContentItems"],
    territoryEditionContent: territoryContentRows.map((row) => ({
      ...row,
      localisedAt: dateString(row.localisedAt)
    })) as PublishingData["territoryEditionContent"],
    editionPages: pageRows.map((row) => ({
      ...row,
      deadline: dateString(row.deadline)
    })) as PublishingData["editionPages"],
    editionPageRevisions: revisionRows as PublishingData["editionPageRevisions"],
    preflightResults: preflightRows as PublishingData["preflightResults"],
    publicationOutputs: outputRows.map((row) => ({
      ...row,
      generatedAt: dateString(row.generatedAt)
    })) as PublishingData["publicationOutputs"],
    contentItems: contentItemRows.map((row) => ({
      ...row,
      approvedAt: dateString(row.approvedAt),
      publishedAt: dateString(row.publishedAt)
    })) as PublishingData["contentItems"],
    contentItemVersions: contentItemVersionRows as PublishingData["contentItemVersions"],
    contentChannelVariants: contentVariantRows.map((row) => ({
      ...row,
      scheduledAt: dateString(row.scheduledAt),
      publishedAt: dateString(row.publishedAt)
    })) as PublishingData["contentChannelVariants"],
    contentChannelVariantVersions: contentVariantVersionRows.map((row) => ({
      ...row,
      approvedAt: dateString(row.approvedAt)
    })) as PublishingData["contentChannelVariantVersions"],
    contentLocalisations: contentLocalisationRows.map((row) => ({
      ...row,
      reviewedAt: dateString(row.reviewedAt)
    })) as PublishingData["contentLocalisations"],
    contentAiTasks: contentAiTaskRows.map((row) => ({
      ...row,
      generatedAt: dateString(row.generatedAt),
      decidedAt: dateString(row.decidedAt)
    })) as PublishingData["contentAiTasks"],
    contentWebsitePublishingJobs: contentWebsiteJobRows.map((row) => ({
      ...row,
      preparedAt: dateString(row.preparedAt)
    })) as PublishingData["contentWebsitePublishingJobs"],
    contentDomainEvents: contentDomainEventRows.map((row) => ({
      ...row,
      occurredAt: dateString(row.occurredAt),
      processedAt: dateString(row.processedAt)
    })) as PublishingData["contentDomainEvents"],
    socialAccounts: socialAccountRows.map((row) => ({
      ...row,
      lastSyncedAt: dateTimeString(row.lastSyncedAt)
    })) as PublishingData["socialAccounts"],
    socialPublications: socialPublicationRows.map((row) => ({
      ...row,
      scheduledAt: dateTimeString(row.scheduledAt),
      approvedAt: dateTimeString(row.approvedAt),
      publishedAt: dateTimeString(row.publishedAt)
    })) as PublishingData["socialPublications"],
    socialPublishJobs: socialJobRows.map((row) => ({
      ...row,
      runAfter: dateTimeString(row.runAfter),
      lockedAt: dateTimeString(row.lockedAt),
      completedAt: dateTimeString(row.completedAt)
    })) as PublishingData["socialPublishJobs"],
    socialProviderEvents: socialProviderEventRows.map((row) => ({
      ...row,
      receivedAt: dateTimeString(row.receivedAt),
      processedAt: dateTimeString(row.processedAt)
    })) as PublishingData["socialProviderEvents"],
    territories: territoryRows as PublishingData["territories"]
  };
}

function dateString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return (value ?? null) as string | null;
}

function dateTimeString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return (value ?? null) as string | null;
}

// ---- Content writes (AI-002) --------------------------------------------------------

type WriteDb = {
  insert(table: unknown): { values(values: unknown): { onConflictDoNothing?(): Promise<unknown> } & PromiseLike<unknown> };
  update(table: unknown): { set(values: unknown): { where(condition: unknown): PromiseLike<unknown> } };
};

export async function insertContentItemWithVersion(
  db: WriteDb,
  item: PublishingData["contentItems"][number],
  version: PublishingData["contentItemVersions"][number]
) {
  await db.insert(contentItems).values({
    id: item.id,
    title: item.title,
    standfirst: item.standfirst ?? null,
    contentType: item.contentType,
    ownerLevel: item.ownerLevel,
    organisationId: item.organisationId ?? null,
    territoryId: item.territoryId ?? null,
    status: item.status,
    authorUserId: item.authorUserId ?? null,
    sourceType: item.sourceType,
    sourceReference: item.sourceReference ?? null,
    heroArtifactReference: item.heroArtifactReference,
    categories: item.categories,
    tags: item.tags,
    relevantDates: item.relevantDates,
    provenance: item.provenance,
    advertiserId: item.advertiserId ?? null,
    commercialBookingId: item.commercialBookingId ?? null,
    editionContentItemId: item.editionContentItemId ?? null,
    approvedByUserId: item.approvedByUserId ?? null,
    approvedAt: null,
    publishedAt: null
  });
  await insertContentItemVersionRecord(db, version);
}

export async function insertContentItemVersionRecord(db: WriteDb, version: PublishingData["contentItemVersions"][number]) {
  await db.insert(contentItemVersions).values({
    id: version.id,
    contentItemId: version.contentItemId,
    versionNumber: version.versionNumber,
    status: version.status,
    snapshot: version.snapshot,
    changeSummary: version.changeSummary ?? null,
    provenance: version.provenance,
    createdByUserId: version.createdByUserId ?? null
  });
}

/** Persists the fields a content revision may change; status and approval are never touched here. */
export async function updateContentItemDraftFields(
  db: WriteDb,
  item: Pick<PublishingData["contentItems"][number], "id" | "title" | "standfirst" | "provenance">
) {
  await db
    .update(contentItems)
    .set({ title: item.title, standfirst: item.standfirst ?? null, provenance: item.provenance, updatedAt: new Date() })
    .where(eq(contentItems.id, item.id));
}

export async function insertContentDomainEventRecords(db: WriteDb, events: PublishingData["contentDomainEvents"]) {
  for (const event of events) {
    await db.insert(contentDomainEvents).values({
      id: event.id,
      eventType: event.eventType,
      contentItemId: event.contentItemId ?? null,
      territoryId: event.territoryId ?? null,
      payload: event.payload,
      occurredAt: new Date(event.occurredAt),
      idempotencyKey: event.idempotencyKey,
      processedAt: event.processedAt ? new Date(event.processedAt) : null
    });
  }
}

// ---- Variant writes (AI-004) --------------------------------------------------------

type Variant = PublishingData["contentChannelVariants"][number];
type VariantVersion = PublishingData["contentChannelVariantVersions"][number];
type AiTask = PublishingData["contentAiTasks"][number];

const asDate = (value: string | null | undefined) => (value ? new Date(value) : null);

export async function insertContentAiTaskRecord(db: WriteDb, task: AiTask) {
  await db.insert(contentAiTasks).values({
    id: task.id,
    task: task.task,
    contentItemId: task.contentItemId,
    sourceVersionId: task.sourceVersionId ?? null,
    targetChannel: task.targetChannel ?? null,
    status: task.status,
    providerKey: task.providerKey ?? null,
    modelReference: task.modelReference ?? null,
    promptTemplateVersion: task.promptTemplateVersion,
    generatedOutput: task.generatedOutput,
    generatedAt: new Date(task.generatedAt),
    humanDecision: task.humanDecision ?? null,
    decidedByUserId: task.decidedByUserId ?? null,
    decidedAt: asDate(task.decidedAt),
    provenance: task.provenance
  });
}

export async function insertContentChannelVariantRecord(db: WriteDb, variant: Variant) {
  await db.insert(contentChannelVariants).values({
    id: variant.id,
    contentItemId: variant.contentItemId,
    channel: variant.channel,
    status: variant.status,
    currentVersionId: variant.currentVersionId ?? null,
    territoryId: variant.territoryId ?? null,
    scheduledAt: asDate(variant.scheduledAt),
    publishedAt: asDate(variant.publishedAt),
    provenance: variant.provenance
  });
}

export async function updateContentChannelVariantRecord(db: WriteDb, variant: Variant) {
  await db
    .update(contentChannelVariants)
    .set({ status: variant.status, currentVersionId: variant.currentVersionId ?? null, provenance: variant.provenance, updatedAt: new Date() })
    .where(eq(contentChannelVariants.id, variant.id));
}

export async function insertContentChannelVariantVersionRecord(db: WriteDb, version: VariantVersion) {
  await db.insert(contentChannelVariantVersions).values({
    id: version.id,
    variantId: version.variantId,
    versionNumber: version.versionNumber,
    status: version.status,
    snapshot: version.snapshot,
    generatedByTaskId: version.generatedByTaskId ?? null,
    provenance: version.provenance,
    createdByUserId: version.createdByUserId ?? null,
    approvedByUserId: version.approvedByUserId ?? null,
    approvedAt: asDate(version.approvedAt)
  });
}

export async function updateContentChannelVariantVersionApproval(db: WriteDb, version: VariantVersion) {
  await db
    .update(contentChannelVariantVersions)
    .set({ status: version.status, approvedByUserId: version.approvedByUserId ?? null, approvedAt: asDate(version.approvedAt), updatedAt: new Date() })
    .where(eq(contentChannelVariantVersions.id, version.id));
}

export async function updateContentAiTaskDecision(db: WriteDb, task: AiTask) {
  await db
    .update(contentAiTasks)
    .set({ humanDecision: task.humanDecision ?? null, decidedByUserId: task.decidedByUserId ?? null, decidedAt: asDate(task.decidedAt), updatedAt: new Date() })
    .where(eq(contentAiTasks.id, task.id));
}
