export type PublishingActorContext = {
  userId: string;
  organisationId?: string | null;
  territoryId?: string | null;
};

export type Season = {
  id: string;
  key: string;
  name: string;
  year: number;
  season: "spring" | "summer" | "autumn" | "winter" | (string & {});
  status: "planned" | "active" | "archived" | (string & {});
  accent: string;
  publicationDate?: string | null;
  bookingDeadline?: string | null;
  artworkDeadline?: string | null;
  editorialDeadline?: string | null;
  proofDeadline?: string | null;
  printDeadline?: string | null;
  distributionDate?: string | null;
  deletedAt?: Date | null;
};

export type MasterEdition = {
  id: string;
  seasonId: string;
  organisationId: string;
  title: string;
  status: "draft" | "approved" | "distributed" | "archived" | (string & {});
  pageCount: number;
  version: number;
  readiness: "not_ready" | "in_progress" | "ready" | (string & {});
  publicationArchive: Record<string, unknown>;
  locked: boolean;
  createdByUserId?: string | null;
  deletedAt?: Date | null;
};

export type TerritoryEdition = {
  id: string;
  masterEditionId: string;
  seasonId: string;
  territoryId: string;
  franchiseOrganisationId?: string | null;
  editorUserId?: string | null;
  title: string;
  status: "draft" | "localising" | "review" | "approved" | "published" | (string & {});
  publicationDate?: string | null;
  bookingDeadline?: string | null;
  artworkDeadline?: string | null;
  editorialDeadline?: string | null;
  proofDeadline?: string | null;
  printDeadline?: string | null;
  distributionDate?: string | null;
  pageCount: number;
  printStatus: string;
  digitalStatus: string;
  readiness: string;
  version: number;
  publicationArchive: Record<string, unknown>;
  generatedFromMasterVersion: number;
  deletedAt?: Date | null;
};

export type PublishingTerritory = {
  id: string;
  franchiseOrganisationId?: string | null;
  code: string;
  name: string;
  status: string;
};

export type PublishingData = {
  seasons: Season[];
  masterEditions: MasterEdition[];
  territoryEditions: TerritoryEdition[];
  territories: PublishingTerritory[];
};

export type EditionSummary = {
  season: Season;
  masterEdition: MasterEdition;
  territoryEditions: TerritoryEdition[];
};
