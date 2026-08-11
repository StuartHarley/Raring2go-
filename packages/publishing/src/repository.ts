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
