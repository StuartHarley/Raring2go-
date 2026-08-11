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

export type MagazineTemplate = {
  id: string;
  key: string;
  name: string;
  category:
    | "front_cover"
    | "contents"
    | "article"
    | "events"
    | "advertorial"
    | "competition"
    | "directory"
    | "house_page"
    | "campaign"
    | "full_page_ad"
    | "half_page_ad"
    | (string & {});
  status: "draft" | "approved" | "retired" | (string & {});
  createdByUserId?: string | null;
  deletedAt?: Date | null;
};

export type MagazineTemplateVersion = {
  id: string;
  templateId: string;
  version: number;
  status: "draft" | "approved" | "published" | "retired" | (string & {});
  pageDimensions: Record<string, unknown>;
  bleed: Record<string, unknown>;
  trim: Record<string, unknown>;
  margins: Record<string, unknown>;
  grid: Record<string, unknown>;
  lockedElements: Array<Record<string, unknown>>;
  editableZones: Array<Record<string, unknown>>;
  imageZones: Array<Record<string, unknown>>;
  copyZones: Array<Record<string, unknown>>;
  headlineZones: Array<Record<string, unknown>>;
  advertiserZones: Array<Record<string, unknown>>;
  footerFurniture: Record<string, unknown>;
  printRules: Record<string, unknown>;
  digitalEnhancements: Record<string, unknown>;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  publishedAt?: string | null;
  deletedAt?: Date | null;
};

export type EditionContentItem = {
  id: string;
  sourceLevel: "hq_master" | "region" | "campaign" | "territory" | "edition" | "channel" | (string & {});
  title: string;
  contentType: "article" | "event" | "offer" | "competition" | "advertorial" | "house_page" | (string & {});
  status: "draft" | "approved" | "retired" | (string & {});
  inheritanceMode: "mandatory" | "suggested" | "optional" | "regional" | "territory_only" | (string & {});
  locked: boolean;
  localisable: boolean;
  advertiserSpecific: boolean;
  body: Record<string, unknown>;
  targeting: {
    territoryIds?: string[];
    excludedTerritoryIds?: string[];
    regionKeys?: string[];
  };
  availableFrom?: string | null;
  expiresAt?: string | null;
  createdByUserId?: string | null;
  deletedAt?: Date | null;
};

export type TerritoryEditionContent = {
  id: string;
  territoryEditionId: string;
  sourceContentItemId: string;
  sourceVersion: number;
  inheritanceState: "inherited" | "overridden" | "detached" | (string & {});
  localOverride: Record<string, unknown>;
  effectiveContent: Record<string, unknown>;
  locked: boolean;
  localisedByUserId?: string | null;
  localisedAt?: string | null;
  deletedAt?: Date | null;
};

export type EditionPage = {
  id: string;
  territoryEditionId: string;
  pageNumber: number;
  spreadNumber: number;
  side: "left" | "right" | "single" | (string & {});
  status:
    | "empty"
    | "needs_content"
    | "in_progress"
    | "awaiting_local_review"
    | "awaiting_hq"
    | "preflight_failed"
    | "approved"
    | "locked"
    | "print_ready"
    | "published"
    | (string & {});
  templateVersionId?: string | null;
  assignedContentId?: string | null;
  advertiserInventoryState: string;
  ownerType: "central" | "local" | "advertiser" | "hq" | (string & {});
  deadline?: string | null;
  sourceMarker: "central" | "local" | "inherited" | (string & {});
  locked: boolean;
  readiness: "not_ready" | "in_progress" | "ready" | "blocked" | (string & {});
  comments: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
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
  magazineTemplates: MagazineTemplate[];
  magazineTemplateVersions: MagazineTemplateVersion[];
  editionContentItems: EditionContentItem[];
  territoryEditionContent: TerritoryEditionContent[];
  editionPages: EditionPage[];
  territories: PublishingTerritory[];
};

export type EditionSummary = {
  season: Season;
  masterEdition: MasterEdition;
  territoryEditions: TerritoryEdition[];
};
