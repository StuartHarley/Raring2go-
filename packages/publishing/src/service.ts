import { auditActions } from "@raring2go/audit";
import { requirePermission, type PermissionData } from "@raring2go/permissions";
import { publishingCapabilities, type PublishingCapability } from "./permissions";
import type {
  EditionSummary,
  EditionContentItem,
  EditionPage,
  EditionPageRevision,
  MagazineTemplate,
  MagazineTemplateVersion,
  MasterEdition,
  PublishingActorContext,
  PublishingData,
  Season,
  TerritoryEdition,
  TerritoryEditionContent
} from "./types";

type PublishingAuditRecorder = {
  record(event: {
    action: string;
    actorUserId?: string | null;
    entityType: string;
    entityId?: string | null;
    organisationId?: string | null;
    territoryId?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void>;
};

export function listEditionSummaries(
  context: PublishingActorContext,
  permissions: PermissionData,
  data: PublishingData
): EditionSummary[] {
  requirePublishingPermission(context, permissions, "editionView");
  const visibleTerritoryIds = visibleTerritories(context, data);

  return data.masterEditions
    .filter((masterEdition) => !masterEdition.deletedAt)
    .map((masterEdition) => {
      const season = requireSeason(data, masterEdition.seasonId);
      const territoryEditions = data.territoryEditions
        .filter((edition) => edition.masterEditionId === masterEdition.id && !edition.deletedAt)
        .filter((edition) => visibleTerritoryIds == null || visibleTerritoryIds.has(edition.territoryId));
      return { season, masterEdition, territoryEditions };
    })
    .filter((summary) => summary.territoryEditions.length > 0 || visibleTerritoryIds == null);
}

export async function createSeasonWithMasterEdition(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  input: {
    season: Season;
    masterEdition: MasterEdition;
  }
) {
  requirePublishingPermission(context, permissions, "editionCreate");
  if (data.seasons.some((season) => season.key === input.season.key && !season.deletedAt)) {
    throw new Error("Season key already exists.");
  }
  if (input.masterEdition.seasonId !== input.season.id) {
    throw new Error("Master edition must reference the created season.");
  }
  data.seasons.push(input.season);
  data.masterEditions.push(input.masterEdition);
  await audit.record(auditEvent(context, auditActions.publishingEditionCreate, "master_edition", input.masterEdition.id, {
    seasonId: input.season.id,
    pageCount: input.masterEdition.pageCount,
    version: input.masterEdition.version
  }));
  return { season: input.season, masterEdition: input.masterEdition };
}

export async function generateTerritoryEditions(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  masterEditionId: string,
  territoryIds: string[]
) {
  requirePublishingPermission(context, permissions, "editionCreate");
  const masterEdition = requireMasterEdition(data, masterEditionId);
  const season = requireSeason(data, masterEdition.seasonId);
  const created: TerritoryEdition[] = [];

  for (const territoryId of territoryIds) {
    const territory = data.territories.find((candidate) => candidate.id === territoryId && candidate.status === "active");
    if (!territory) {
      throw new Error("Territory is not available for edition generation.");
    }
    const existing = data.territoryEditions.find(
      (edition) => edition.seasonId === season.id && edition.territoryId === territoryId && !edition.deletedAt
    );
    if (existing) {
      continue;
    }
    const edition: TerritoryEdition = {
      id: crypto.randomUUID(),
      masterEditionId: masterEdition.id,
      seasonId: season.id,
      territoryId,
      franchiseOrganisationId: territory.franchiseOrganisationId,
      title: `${season.name} ${territory.name}`,
      status: "draft",
      publicationDate: season.publicationDate,
      bookingDeadline: season.bookingDeadline,
      artworkDeadline: season.artworkDeadline,
      editorialDeadline: season.editorialDeadline,
      proofDeadline: season.proofDeadline,
      printDeadline: season.printDeadline,
      distributionDate: season.distributionDate,
      pageCount: masterEdition.pageCount,
      printStatus: "not_started",
      digitalStatus: "not_started",
      readiness: "not_ready",
      version: 1,
      publicationArchive: {},
      generatedFromMasterVersion: masterEdition.version
    };
    data.territoryEditions.push(edition);
    created.push(edition);
    await audit.record(auditEvent(context, auditActions.publishingEditionCreate, "territory_edition", edition.id, {
      masterEditionId: masterEdition.id,
      seasonId: season.id,
      territoryId,
      generatedFromMasterVersion: masterEdition.version
    }, territoryId));
  }

  return created;
}

export function listMagazineTemplates(
  context: PublishingActorContext,
  permissions: PermissionData,
  data: PublishingData
) {
  requirePublishingPermission(context, permissions, "templateEdit");
  return data.magazineTemplates
    .filter((template) => !template.deletedAt)
    .map((template) => ({
      template,
      versions: data.magazineTemplateVersions
        .filter((version) => version.templateId === template.id && !version.deletedAt)
        .sort((left, right) => right.version - left.version)
    }));
}

export async function createMagazineTemplate(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  input: {
    template: MagazineTemplate;
    version: MagazineTemplateVersion;
  }
) {
  requirePublishingPermission(context, permissions, "templateCreate");
  if (data.magazineTemplates.some((template) => template.key === input.template.key && !template.deletedAt)) {
    throw new Error("Magazine template key already exists.");
  }
  if (input.version.templateId !== input.template.id || input.version.version !== 1) {
    throw new Error("Initial magazine template version must be version 1 for the template.");
  }
  validateTemplateVersion(input.version);
  data.magazineTemplates.push(input.template);
  data.magazineTemplateVersions.push(input.version);
  await audit.record(auditEvent(context, auditActions.publishingTemplateChange, "magazine_template", input.template.id, {
    action: "create",
    category: input.template.category,
    version: input.version.version
  }));
  return input;
}

export async function createTemplateRevision(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  templateId: string,
  revision: MagazineTemplateVersion
) {
  requirePublishingPermission(context, permissions, "templateEdit");
  const template = requireMagazineTemplate(data, templateId);
  const currentVersions = data.magazineTemplateVersions.filter((version) => version.templateId === template.id && !version.deletedAt);
  const nextVersion = Math.max(0, ...currentVersions.map((version) => version.version)) + 1;
  if (revision.templateId !== template.id || revision.version !== nextVersion) {
    throw new Error("Template revision must use the next sequential version.");
  }
  validateTemplateVersion(revision);
  data.magazineTemplateVersions.push(revision);
  await audit.record(auditEvent(context, auditActions.publishingTemplateChange, "magazine_template_version", revision.id, {
    action: "revise",
    templateId,
    version: revision.version
  }));
  return revision;
}

export async function approveTemplateVersion(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  versionId: string
) {
  requirePublishingPermission(context, permissions, "templateApprove");
  const version = requireTemplateVersion(data, versionId);
  if (version.status !== "draft") {
    throw new Error("Only draft template versions can be approved.");
  }
  version.status = "approved";
  version.approvedByUserId = context.userId;
  version.approvedAt = today();
  await audit.record(auditEvent(context, auditActions.publishingTemplateChange, "magazine_template_version", version.id, {
    action: "approve",
    version: version.version
  }));
  return version;
}

export async function publishTemplateVersion(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  versionId: string
) {
  requirePublishingPermission(context, permissions, "templatePublish");
  const version = requireTemplateVersion(data, versionId);
  if (version.status !== "approved") {
    throw new Error("Only approved template versions can be published.");
  }
  version.status = "published";
  version.publishedAt = today();
  const template = requireMagazineTemplate(data, version.templateId);
  template.status = "approved";
  await audit.record(auditEvent(context, auditActions.publishingTemplateChange, "magazine_template_version", version.id, {
    action: "publish",
    templateId: template.id,
    version: version.version
  }));
  return version;
}

export async function createCentralContentItem(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  content: EditionContentItem
) {
  requirePublishingPermission(context, permissions, content.locked ? "lockedContentManage" : "localContentEdit");
  if (data.editionContentItems.some((item) => item.id === content.id && !item.deletedAt)) {
    throw new Error("Content item already exists.");
  }
  data.editionContentItems.push(content);
  await audit.record(auditEvent(context, auditActions.publishingContentOverride, "edition_content_item", content.id, {
    action: "create",
    inheritanceMode: content.inheritanceMode,
    sourceLevel: content.sourceLevel
  }));
  return content;
}

export async function distributeContentToTerritoryEditions(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  contentItemId: string,
  sourceVersion = 1
) {
  requirePublishingPermission(context, permissions, "lockedContentManage");
  const item = requireContentItem(data, contentItemId);
  const created: TerritoryEditionContent[] = [];
  for (const edition of data.territoryEditions.filter((candidate) => !candidate.deletedAt)) {
    if (!contentTargetsTerritory(item, edition.territoryId)) {
      continue;
    }
    const existing = data.territoryEditionContent.find(
      (content) => content.territoryEditionId === edition.id && content.sourceContentItemId === item.id && !content.deletedAt
    );
    if (existing) {
      continue;
    }
    const content: TerritoryEditionContent = {
      id: crypto.randomUUID(),
      territoryEditionId: edition.id,
      sourceContentItemId: item.id,
      sourceVersion,
      inheritanceState: "inherited",
      localOverride: {},
      effectiveContent: { ...item.body },
      locked: item.locked
    };
    data.territoryEditionContent.push(content);
    created.push(content);
  }
  await audit.record(auditEvent(context, auditActions.publishingContentOverride, "edition_content_item", item.id, {
    action: "distribute",
    createdCount: created.length,
    sourceVersion
  }));
  return created;
}

export async function applyLocalContentOverride(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  territoryContentId: string,
  localOverride: Record<string, unknown>
) {
  requirePublishingPermission(context, permissions, "localContentEdit");
  const content = requireTerritoryContent(data, territoryContentId);
  const edition = requireTerritoryEdition(data, content.territoryEditionId);
  if (context.territoryId && context.territoryId !== edition.territoryId) {
    throw new Error("Territory content is outside the active territory.");
  }
  if (content.locked) {
    throw new Error("Locked inherited content cannot be locally overridden.");
  }
  content.localOverride = localOverride;
  content.effectiveContent = { ...content.effectiveContent, ...localOverride };
  content.inheritanceState = "overridden";
  content.localisedByUserId = context.userId;
  content.localisedAt = today();
  await audit.record(auditEvent(context, auditActions.publishingContentOverride, "territory_edition_content", content.id, {
    action: "local_override",
    sourceContentItemId: content.sourceContentItemId
  }, edition.territoryId));
  return content;
}

export async function propagateMasterContentCorrection(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  contentItemId: string,
  nextBody: Record<string, unknown>,
  nextVersion: number
) {
  requirePublishingPermission(context, permissions, "lockedContentManage");
  const item = requireContentItem(data, contentItemId);
  item.body = nextBody;
  let updatedCount = 0;
  let skippedOverrides = 0;
  for (const content of data.territoryEditionContent.filter((candidate) => candidate.sourceContentItemId === item.id && !candidate.deletedAt)) {
    if (content.inheritanceState === "overridden" || content.inheritanceState === "detached") {
      skippedOverrides += 1;
      continue;
    }
    content.effectiveContent = { ...nextBody };
    content.sourceVersion = nextVersion;
    updatedCount += 1;
  }
  await audit.record(auditEvent(context, auditActions.publishingContentOverride, "edition_content_item", item.id, {
    action: "propagate_correction",
    nextVersion,
    updatedCount,
    skippedOverrides
  }));
  return { updatedCount, skippedOverrides };
}

export async function createEditionFlatplan(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  territoryEditionId: string
) {
  requirePublishingPermission(context, permissions, "pageEdit");
  const edition = requireTerritoryEdition(data, territoryEditionId);
  if (data.editionPages.some((page) => page.territoryEditionId === edition.id && !page.deletedAt)) {
    throw new Error("Edition flatplan already exists.");
  }
  const pages: EditionPage[] = Array.from({ length: edition.pageCount }, (_, index) => {
    const pageNumber = index + 1;
    return {
      id: crypto.randomUUID(),
      territoryEditionId: edition.id,
      pageNumber,
      spreadNumber: Math.ceil(pageNumber / 2),
      side: pageNumber === 1 ? "single" : pageNumber % 2 === 0 ? "left" : "right",
      status: "empty",
      advertiserInventoryState: "unassigned",
      ownerType: pageNumber <= 2 ? "hq" : "local",
      deadline: edition.editorialDeadline,
      sourceMarker: pageNumber <= 2 ? "central" : "local",
      locked: pageNumber === 1,
      readiness: "not_ready",
      comments: [],
      issues: []
    };
  });
  data.editionPages.push(...pages);
  await audit.record(auditEvent(context, auditActions.publishingPageAssign, "territory_edition", edition.id, {
    action: "create_flatplan",
    pageCount: pages.length
  }, edition.territoryId));
  return pages;
}

export async function assignPageTemplateAndContent(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  pageId: string,
  input: {
    templateVersionId?: string | null;
    assignedContentId?: string | null;
    status?: EditionPage["status"];
  }
) {
  requirePublishingPermission(context, permissions, "pageEdit");
  const page = requireEditionPage(data, pageId);
  const edition = requireTerritoryEdition(data, page.territoryEditionId);
  if (page.locked && context.territoryId) {
    throw new Error("Locked pages cannot be changed from local context.");
  }
  if (input.templateVersionId) {
    const templateVersion = requireTemplateVersion(data, input.templateVersionId);
    if (templateVersion.status !== "published") {
      throw new Error("Only published template versions can be assigned to edition pages.");
    }
  }
  if (input.assignedContentId) {
    const content = requireTerritoryContent(data, input.assignedContentId);
    if (content.territoryEditionId !== edition.id) {
      throw new Error("Assigned content belongs to another territory edition.");
    }
  }
  page.templateVersionId = input.templateVersionId ?? page.templateVersionId ?? null;
  page.assignedContentId = input.assignedContentId ?? page.assignedContentId ?? null;
  page.status = input.status ?? (page.assignedContentId ? "in_progress" : "needs_content");
  page.readiness = page.templateVersionId && page.assignedContentId ? "in_progress" : "not_ready";
  await audit.record(auditEvent(context, auditActions.publishingPageAssign, "edition_page", page.id, {
    action: "assign",
    templateVersionId: page.templateVersionId,
    assignedContentId: page.assignedContentId
  }, edition.territoryId));
  return page;
}

export async function reorderEditionPages(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  territoryEditionId: string,
  orderedPageIds: string[]
) {
  requirePublishingPermission(context, permissions, "pageEdit");
  const edition = requireTerritoryEdition(data, territoryEditionId);
  const pages = data.editionPages.filter((page) => page.territoryEditionId === edition.id && !page.deletedAt);
  if (orderedPageIds.length !== pages.length || new Set(orderedPageIds).size !== pages.length) {
    throw new Error("Reorder request must include every page exactly once.");
  }
  const pageById = new Map(pages.map((page) => [page.id, page]));
  orderedPageIds.forEach((pageId, index) => {
    const page = pageById.get(pageId);
    if (!page) {
      throw new Error("Reorder request includes a page outside the edition.");
    }
    if (page.locked && page.pageNumber !== index + 1) {
      throw new Error("Locked pages cannot be moved.");
    }
  });
  orderedPageIds.forEach((pageId, index) => {
    const page = pageById.get(pageId)!;
    const pageNumber = index + 1;
    page.pageNumber = pageNumber;
    page.spreadNumber = Math.ceil(pageNumber / 2);
    page.side = pageNumber === 1 ? "single" : pageNumber % 2 === 0 ? "left" : "right";
  });
  await audit.record(auditEvent(context, auditActions.publishingPageAssign, "territory_edition", edition.id, {
    action: "reorder_flatplan",
    pageCount: pages.length
  }, edition.territoryId));
  return pages.sort((left, right) => left.pageNumber - right.pageNumber);
}

export async function autosaveLocalPageContent(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  pageId: string,
  snapshot: Record<string, unknown>
) {
  requirePublishingPermission(context, permissions, "localContentEdit");
  const page = requireEditionPage(data, pageId);
  const edition = requireTerritoryEdition(data, page.territoryEditionId);
  if (context.territoryId && context.territoryId !== edition.territoryId) {
    throw new Error("Page is outside the active territory.");
  }
  if (page.locked) {
    throw new Error("Locked pages cannot be edited locally.");
  }
  const warnings = pageWarnings(snapshot);
  page.status = "in_progress";
  page.readiness = warnings.length > 0 ? "blocked" : "in_progress";
  const revision = addPageRevision(data, page, context.userId, "autosave", snapshot, warnings);
  await audit.record(auditEvent(context, auditActions.publishingPageAssign, "edition_page", page.id, {
    action: "autosave",
    revisionNumber: revision.revisionNumber,
    warningCount: warnings.length
  }, edition.territoryId));
  return { page, revision };
}

export async function submitPageForReview(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  pageId: string
) {
  requirePublishingPermission(context, permissions, "localContentEdit");
  const page = requireEditionPage(data, pageId);
  const edition = requireTerritoryEdition(data, page.territoryEditionId);
  if (page.readiness === "blocked" || page.issues.length > 0) {
    throw new Error("Page cannot be submitted while warnings or issues remain.");
  }
  page.status = "awaiting_hq";
  page.readiness = "ready";
  const revision = addPageRevision(data, page, context.userId, "submit_review", {
    pageId: page.id,
    status: page.status
  }, []);
  await audit.record(auditEvent(context, auditActions.publishingPageAssign, "edition_page", page.id, {
    action: "submit_review",
    revisionNumber: revision.revisionNumber
  }, edition.territoryId));
  return { page, revision };
}

function requirePublishingPermission(
  context: PublishingActorContext,
  permissions: PermissionData,
  capability: PublishingCapability
) {
  const permission = publishingCapabilities[capability];
  requirePermission({
    userId: context.userId,
    module: permission.module,
    action: permission.action,
    context: {
      organisationId: context.organisationId ?? undefined,
      territoryId: context.territoryId ?? undefined
    }
  }, permissions);
}

function visibleTerritories(context: PublishingActorContext, data: PublishingData) {
  if (!context.territoryId) {
    return null;
  }
  const territory = data.territories.find((candidate) => candidate.id === context.territoryId);
  if (!territory) {
    throw new Error("Active territory context is invalid.");
  }
  return new Set([territory.id]);
}

function requireSeason(data: PublishingData, seasonId: string) {
  const season = data.seasons.find((candidate) => candidate.id === seasonId && !candidate.deletedAt);
  if (!season) {
    throw new Error("Season was not found.");
  }
  return season;
}

function requireMasterEdition(data: PublishingData, masterEditionId: string) {
  const masterEdition = data.masterEditions.find((candidate) => candidate.id === masterEditionId && !candidate.deletedAt);
  if (!masterEdition) {
    throw new Error("Master edition was not found.");
  }
  return masterEdition;
}

function requireMagazineTemplate(data: PublishingData, templateId: string) {
  const template = data.magazineTemplates.find((candidate) => candidate.id === templateId && !candidate.deletedAt);
  if (!template) {
    throw new Error("Magazine template was not found.");
  }
  return template;
}

function requireTemplateVersion(data: PublishingData, versionId: string) {
  const version = data.magazineTemplateVersions.find((candidate) => candidate.id === versionId && !candidate.deletedAt);
  if (!version) {
    throw new Error("Magazine template version was not found.");
  }
  return version;
}

function requireTerritoryEdition(data: PublishingData, editionId: string) {
  const edition = data.territoryEditions.find((candidate) => candidate.id === editionId && !candidate.deletedAt);
  if (!edition) {
    throw new Error("Territory edition was not found.");
  }
  return edition;
}

function requireContentItem(data: PublishingData, contentItemId: string) {
  const item = data.editionContentItems.find((candidate) => candidate.id === contentItemId && !candidate.deletedAt);
  if (!item) {
    throw new Error("Edition content item was not found.");
  }
  return item;
}

function requireTerritoryContent(data: PublishingData, territoryContentId: string) {
  const content = data.territoryEditionContent.find((candidate) => candidate.id === territoryContentId && !candidate.deletedAt);
  if (!content) {
    throw new Error("Territory edition content was not found.");
  }
  return content;
}

function requireEditionPage(data: PublishingData, pageId: string) {
  const page = data.editionPages.find((candidate) => candidate.id === pageId && !candidate.deletedAt);
  if (!page) {
    throw new Error("Edition page was not found.");
  }
  return page;
}

function addPageRevision(
  data: PublishingData,
  page: EditionPage,
  actorUserId: string,
  changeType: EditionPageRevision["changeType"],
  snapshot: Record<string, unknown>,
  warnings: Array<Record<string, unknown>>
) {
  const revisionNumber = Math.max(
    0,
    ...data.editionPageRevisions
      .filter((revision) => revision.pageId === page.id && !revision.deletedAt)
      .map((revision) => revision.revisionNumber)
  ) + 1;
  const revision: EditionPageRevision = {
    id: crypto.randomUUID(),
    pageId: page.id,
    revisionNumber,
    actorUserId,
    changeType,
    snapshot,
    warnings
  };
  data.editionPageRevisions.push(revision);
  return revision;
}

function pageWarnings(snapshot: Record<string, unknown>) {
  const warnings: Array<Record<string, unknown>> = [];
  const text = typeof snapshot.body === "string" ? snapshot.body : "";
  if (text.split(/\s+/).filter(Boolean).length > 220) {
    warnings.push({ type: "copy_overflow", message: "Copy exceeds the current page guidance." });
  }
  if (snapshot.imageRequired === true && !snapshot.imageAssetId) {
    warnings.push({ type: "missing_image", message: "Required image is missing." });
  }
  return warnings;
}

function contentTargetsTerritory(item: EditionContentItem, territoryId: string) {
  if (item.targeting.excludedTerritoryIds?.includes(territoryId)) {
    return false;
  }
  if (item.targeting.territoryIds && item.targeting.territoryIds.length > 0) {
    return item.targeting.territoryIds.includes(territoryId);
  }
  return item.inheritanceMode !== "territory_only";
}

function validateTemplateVersion(version: MagazineTemplateVersion) {
  if (version.status !== "draft") {
    throw new Error("New template versions must start as draft.");
  }
  if (version.lockedElements.length === 0 || version.editableZones.length === 0) {
    throw new Error("Template versions require locked elements and editable zones.");
  }
}

function today() {
  return "2026-08-11";
}

function auditEvent(
  context: PublishingActorContext,
  action: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
  territoryId?: string | null
) {
  return {
    action,
    actorUserId: context.userId,
    entityType,
    entityId,
    organisationId: context.organisationId,
    territoryId: territoryId ?? context.territoryId,
    payload
  };
}
