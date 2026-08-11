import {
  editionContentItems,
  editionPageRevisions,
  editionPages,
  magazineTemplateVersions,
  magazineTemplates,
  masterEditions,
  preflightResults,
  publicationOutputs,
  seasons,
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
    territories: territoryRows as PublishingData["territories"]
  };
}

function dateString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return (value ?? null) as string | null;
}
