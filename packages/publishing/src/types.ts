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

export type EditionPageRevision = {
  id: string;
  pageId: string;
  revisionNumber: number;
  actorUserId?: string | null;
  changeType: "autosave" | "submit_review" | "comment" | "status" | (string & {});
  snapshot: Record<string, unknown>;
  warnings: Array<Record<string, unknown>>;
  deletedAt?: Date | null;
};

export type PreflightCheck = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  fixable: boolean;
};

export type PreflightFix = {
  code: string;
  action: string;
  applied: boolean;
};

export type PreflightResult = {
  id: string;
  entityType: "edition_page" | "territory_edition" | "asset" | (string & {});
  entityId: string;
  territoryEditionId?: string | null;
  status: "passed" | "warning" | "failed" | "fixed" | (string & {});
  checks: PreflightCheck[];
  fixes: PreflightFix[];
  originalArtifact: Record<string, unknown>;
  derivedArtifact: Record<string, unknown>;
  unfixableIssues: PreflightCheck[];
  createdByUserId?: string | null;
  deletedAt?: Date | null;
};

export type PublicationOutput = {
  id: string;
  territoryEditionId: string;
  outputType: "print" | "digital" | (string & {});
  status: "generated" | "superseded" | "failed" | (string & {});
  version: number;
  sourcePageSnapshot: Array<Record<string, unknown>>;
  artifact: Record<string, unknown>;
  preflightResultId?: string | null;
  idempotencyKey: string;
  corrections: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  generatedByUserId?: string | null;
  generatedAt?: string | null;
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
  editionPageRevisions: EditionPageRevision[];
  preflightResults: PreflightResult[];
  publicationOutputs: PublicationOutput[];
  contentItems: ContentItem[];
  contentItemVersions: ContentItemVersion[];
  contentChannelVariants: ContentChannelVariant[];
  contentChannelVariantVersions: ContentChannelVariantVersion[];
  contentLocalisations: ContentLocalisation[];
  contentAiTasks: ContentAiTask[];
  contentWebsitePublishingJobs: ContentWebsitePublishingJob[];
  contentDomainEvents: ContentDomainEvent[];
  socialAccounts: SocialAccount[];
  socialPublications: SocialPublication[];
  socialPublishJobs: SocialPublishJob[];
  socialProviderEvents: SocialProviderEvent[];
  territories: PublishingTerritory[];
};

export type EditionSummary = {
  season: Season;
  masterEdition: MasterEdition;
  territoryEditions: TerritoryEdition[];
};

export type EditionControlRoomRow = {
  territoryEdition: TerritoryEdition;
  territory?: PublishingTerritory;
  season: Season;
  completionPercent: number;
  phase: string;
  riskStatus: "on_track" | "watch" | "blocked";
  pagesReady: number;
  pagesTotal: number;
  blockedPages: number;
  missingLocalContent: number;
  preflightFailures: number;
  hqActions: number;
  localActions: number;
  nextDeadline?: string | null;
  printStatus: string;
  digitalStatus: string;
};

export type ContentItem = {
  id: string;
  title: string;
  standfirst?: string | null;
  contentType: "article" | "event" | "offer" | "competition" | "guide" | "advertiser_sponsored" | "announcement" | "evergreen" | (string & {});
  ownerLevel: "network" | "territory" | (string & {});
  organisationId?: string | null;
  territoryId?: string | null;
  status: "draft" | "approved" | "published" | "archived" | (string & {});
  authorUserId?: string | null;
  sourceType: "human" | "ai" | "external_gpt" | (string & {});
  sourceReference?: string | null;
  heroArtifactReference: Record<string, unknown>;
  categories: string[];
  tags: string[];
  relevantDates: Record<string, unknown>;
  provenance: Record<string, unknown>;
  advertiserId?: string | null;
  commercialBookingId?: string | null;
  editionContentItemId?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  publishedAt?: string | null;
  deletedAt?: Date | null;
};

export type ContentItemVersion = {
  id: string;
  contentItemId: string;
  versionNumber: number;
  status: string;
  snapshot: Record<string, unknown>;
  changeSummary?: string | null;
  provenance: Record<string, unknown>;
  createdByUserId?: string | null;
  deletedAt?: Date | null;
};

export type ContentChannelVariant = {
  id: string;
  contentItemId: string;
  channel: string;
  status: "not_created" | "ai_draft" | "human_edited" | "needs_review" | "approved" | "scheduled" | "published" | (string & {});
  currentVersionId?: string | null;
  territoryId?: string | null;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  provenance: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type ContentChannelVariantVersion = {
  id: string;
  variantId: string;
  versionNumber: number;
  status: string;
  snapshot: Record<string, unknown>;
  generatedByTaskId?: string | null;
  provenance: Record<string, unknown>;
  createdByUserId?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  deletedAt?: Date | null;
};

export type ContentLocalisation = {
  id: string;
  masterContentItemId: string;
  territoryId: string;
  localContentItemId?: string | null;
  state: "inherited" | "localised" | "locally_overridden" | "master_updated" | "review_required" | "opted_out" | (string & {});
  lockedFields: string[];
  editableFields: string[];
  localOverrides: Record<string, unknown>;
  masterVersionNumber: number;
  reviewedAt?: string | null;
  deletedAt?: Date | null;
};

export type ContentAiTask = {
  id: string;
  task: string;
  contentItemId: string;
  sourceVersionId?: string | null;
  targetChannel?: string | null;
  status: string;
  providerKey?: string | null;
  modelReference?: string | null;
  promptTemplateVersion: string;
  generatedOutput: Record<string, unknown>;
  generatedAt: string;
  humanDecision?: string | null;
  decidedByUserId?: string | null;
  decidedAt?: string | null;
  provenance: Record<string, unknown>;
  deletedAt?: Date | null;
};

export type ContentWebsitePublishingJob = {
  id: string;
  contentItemId: string;
  variantId?: string | null;
  providerKey: string;
  status: string;
  preparedSnapshot: Record<string, unknown>;
  providerMetadata: Record<string, unknown>;
  idempotencyKey: string;
  preparedAt: string;
  deletedAt?: Date | null;
};

export type ContentDomainEvent = {
  id: string;
  eventType: string;
  contentItemId?: string | null;
  territoryId?: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  idempotencyKey: string;
  processedAt?: string | null;
};

export type ContentLibraryItem = {
  item: ContentItem;
  currentVersion?: ContentItemVersion;
  variants: ContentChannelVariant[];
  localisations: ContentLocalisation[];
  health: string[];
  editionStatus: "unused" | "assigned" | "placed" | "preflight_ready" | "published";
};

export type SocialAccount = {
  id: string;
  channel: "facebook" | "instagram" | "linkedin" | (string & {});
  organisationId?: string | null;
  territoryId?: string | null;
  externalAccountReference: string;
  displayName: string;
  connectionStatus: string;
  connectionHealth: string;
  capabilityMetadata: Record<string, unknown>;
  providerMetadata: Record<string, unknown>;
  active: boolean;
  lastSyncedAt?: string | null;
  deletedAt?: Date | null;
};

export type SocialPublication = {
  id: string;
  contentItemId: string;
  variantId?: string | null;
  variantVersionId?: string | null;
  territoryId: string;
  socialAccountId: string;
  channel: string;
  approvalState: "draft" | "needs_review" | "approved" | (string & {});
  publishState: "draft" | "needs_review" | "approved" | "scheduled" | "publishing" | "published" | "failed" | "cancelled" | (string & {});
  scheduledAt?: string | null;
  timezone: string;
  immutableSnapshot: Record<string, unknown>;
  mediaArtifactReferences: Array<Record<string, unknown>>;
  cta?: string | null;
  linkUrl?: string | null;
  advertiserId?: string | null;
  commercialBookingId?: string | null;
  publishedExternalReference?: string | null;
  retryCount: number;
  maxRetries: number;
  failureMetadata: Record<string, unknown>;
  createdByUserId?: string | null;
  approvedByUserId?: string | null;
  scheduledByUserId?: string | null;
  publishedByUserId?: string | null;
  approvedAt?: string | null;
  publishedAt?: string | null;
  idempotencyKey: string;
  deletedAt?: Date | null;
};

export type SocialPublishJob = {
  id: string;
  publicationId: string;
  status: "queued" | "running" | "completed" | "failed" | (string & {});
  runAfter: string;
  attempts: number;
  maxAttempts: number;
  providerKey: string;
  providerRequest: Record<string, unknown>;
  providerResponse: Record<string, unknown>;
  lastError?: string | null;
  lockedAt?: string | null;
  completedAt?: string | null;
  idempotencyKey: string;
};

export type SocialProviderEvent = {
  id: string;
  publicationId?: string | null;
  providerKey: string;
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  receivedAt: string;
  processedAt?: string | null;
};

export type SocialQueueItem = {
  publication: SocialPublication;
  account?: SocialAccount;
  content?: ContentItem;
  variant?: ContentChannelVariant;
  job?: SocialPublishJob;
  warnings: string[];
};

export type SocialPublishingProvider = {
  key: string;
  publish(input: {
    publication: SocialPublication;
    account: SocialAccount;
  }): Promise<{ externalReference?: string | null; status: "published" | "failed"; metadata?: Record<string, unknown> }>;
  fetchStatus?(externalReference: string): Promise<Record<string, unknown>>;
  cancel?(externalReference: string): Promise<Record<string, unknown>>;
};
