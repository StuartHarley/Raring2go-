import { auditActions } from "@raring2go/audit";
import { requirePermission, type PermissionData } from "@raring2go/permissions";
import { publishingCapabilities, type PublishingCapability } from "./permissions";
import type {
  EditionControlRoomRow,
  ContentAiTask,
  ContentChannelVariant,
  ContentChannelVariantVersion,
  ContentItem,
  ContentItemVersion,
  ContentLibraryItem,
  ContentLocalisation,
  ContentWebsitePublishingJob,
  EditionSummary,
  EditionContentItem,
  EditionPage,
  EditionPageRevision,
  MagazineTemplate,
  MagazineTemplateVersion,
  MasterEdition,
  PreflightCheck,
  PreflightFix,
  PreflightResult,
  PublicationOutput,
  PublishingActorContext,
  PublishingData,
  Season,
  SocialAccount,
  SocialPublication,
  SocialPublishJob,
  SocialPublishingProvider,
  SocialQueueItem,
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

export function listEditionControlRoom(
  context: PublishingActorContext,
  permissions: PermissionData,
  data: PublishingData
): EditionControlRoomRow[] {
  requirePublishingPermission(context, permissions, "editionView");
  const visibleTerritoryIds = visibleTerritories(context, data);

  return data.territoryEditions
    .filter((edition) => !edition.deletedAt)
    .filter((edition) => visibleTerritoryIds == null || visibleTerritoryIds.has(edition.territoryId))
    .map((edition) => {
      const season = requireSeason(data, edition.seasonId);
      const territory = data.territories.find((candidate) => candidate.id === edition.territoryId);
      const pages = data.editionPages.filter((page) => page.territoryEditionId === edition.id && !page.deletedAt);
      const pagesReady = pages.filter((page) => page.readiness === "ready").length;
      const blockedPages = pages.filter((page) => page.readiness === "blocked" || page.issues.length > 0).length;
      const missingLocalContent = pages.filter(
        (page) => page.sourceMarker === "local" && !page.assignedContentId
      ).length;
      const preflightFailures = data.preflightResults.filter(
        (result) =>
          result.territoryEditionId === edition.id &&
          result.status === "failed" &&
          !result.deletedAt
      ).length;
      const pagesTotal = Math.max(edition.pageCount, pages.length);
      const completionPercent = pagesTotal === 0 ? 0 : Math.round((pagesReady / pagesTotal) * 100);
      const hqActions = pages.filter((page) => page.status === "awaiting_hq").length + preflightFailures;
      const localActions = missingLocalContent + blockedPages;
      const riskStatus: EditionControlRoomRow["riskStatus"] = blockedPages > 0 || preflightFailures > 0
        ? "blocked"
        : completionPercent < 70
          ? "watch"
          : "on_track";

      return {
        territoryEdition: edition,
        territory,
        season,
        completionPercent,
        phase: editionPhase(edition),
        riskStatus,
        pagesReady,
        pagesTotal,
        blockedPages,
        missingLocalContent,
        preflightFailures,
        hqActions,
        localActions,
        nextDeadline: nextEditionDeadline(edition),
        printStatus: edition.printStatus,
        digitalStatus: edition.digitalStatus
      };
    })
    .sort((left, right) => left.territoryEdition.title.localeCompare(right.territoryEdition.title));
}

export function listContentLibrary(
  context: PublishingActorContext,
  permissions: PermissionData,
  data: PublishingData
): ContentLibraryItem[] {
  requirePublishingPermission(context, permissions, "contentView");
  const visibleTerritoryIds = visibleTerritories(context, data);
  return data.contentItems
    .filter((item) => !item.deletedAt)
    .filter((item) => contentVisible(item, visibleTerritoryIds, data))
    .map((item) => assembleContentLibraryItem(item, data))
    .sort((left, right) => left.item.title.localeCompare(right.item.title));
}

export function readContentWorkspace(
  context: PublishingActorContext,
  permissions: PermissionData,
  data: PublishingData,
  contentItemId: string
) {
  requirePublishingPermission(context, permissions, "contentView");
  const item = requireCanonicalContent(data, contentItemId);
  const visibleTerritoryIds = visibleTerritories(context, data);
  if (!contentVisible(item, visibleTerritoryIds, data)) {
    throw new Error("Content item is outside the active territory.");
  }
  return {
    libraryItem: assembleContentLibraryItem(item, data),
    versions: data.contentItemVersions.filter((version) => version.contentItemId === item.id && !version.deletedAt),
    variantVersions: data.contentChannelVariantVersions.filter((version) =>
      data.contentChannelVariants.some((variant) => variant.id === version.variantId && variant.contentItemId === item.id && !variant.deletedAt)
    ),
    aiTasks: data.contentAiTasks.filter((task) => task.contentItemId === item.id && !task.deletedAt),
    websiteJobs: data.contentWebsitePublishingJobs.filter((job) => job.contentItemId === item.id && !job.deletedAt),
    events: data.contentDomainEvents.filter((event) => event.contentItemId === item.id)
  };
}

export function listSocialQueue(
  context: PublishingActorContext,
  permissions: PermissionData,
  data: PublishingData
): SocialQueueItem[] {
  requirePublishingPermission(context, permissions, "socialView");
  const visibleTerritoryIds = visibleTerritories(context, data);
  return data.socialPublications
    .filter((publication) => !publication.deletedAt)
    .filter((publication) => visibleTerritoryIds == null || visibleTerritoryIds.has(publication.territoryId))
    .map((publication) => ({
      publication,
      account: data.socialAccounts.find((account) => account.id === publication.socialAccountId && !account.deletedAt),
      content: data.contentItems.find((item) => item.id === publication.contentItemId && !item.deletedAt),
      variant: publication.variantId ? data.contentChannelVariants.find((variant) => variant.id === publication.variantId && !variant.deletedAt) : undefined,
      job: data.socialPublishJobs.find((job) => job.publicationId === publication.id),
      warnings: socialWarnings(publication, data)
    }))
    .sort((left, right) => (left.publication.scheduledAt ?? "").localeCompare(right.publication.scheduledAt ?? ""));
}

export function socialContentGaps(data: PublishingData, nowIso = new Date().toISOString()) {
  const sevenDays = new Date(nowIso);
  sevenDays.setDate(sevenDays.getDate() + 7);
  return data.territories
    .filter((territory) => territory.status === "active")
    .map((territory) => {
      const upcoming = data.socialPublications.filter((publication) =>
        publication.territoryId === territory.id &&
        publication.publishState === "scheduled" &&
        publication.scheduledAt &&
        new Date(publication.scheduledAt) <= sevenDays
      );
      return {
        territoryId: territory.id,
        territoryName: territory.name,
        signals: [
          ...(upcoming.length === 0 ? ["no_social_scheduled_next_7_days"] : []),
          ...(data.socialPublications.some((publication) => publication.territoryId === territory.id && publication.publishState === "failed") ? ["scheduled_post_failed"] : []),
          ...(data.contentChannelVariants.some((variant) => variant.status === "approved" && !data.socialPublications.some((publication) => publication.variantId === variant.id)) ? ["approved_variants_not_queued"] : [])
        ]
      };
    });
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

export async function createCanonicalContentItem(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  item: ContentItem,
  version: ContentItemVersion
) {
  requirePublishingPermission(context, permissions, "contentCreate");
  if (item.territoryId) {
    ensureContextCanAccessTerritory(context, item.territoryId);
  }
  if (version.contentItemId !== item.id || version.versionNumber !== 1) {
    throw new Error("Initial content version must belong to the content item and start at version 1.");
  }
  data.contentItems.push(item);
  data.contentItemVersions.push(version);
  await recordContentAuditAndEvent(context, audit, data, auditActions.contentCreated, "content_item", item.id, {
    contentType: item.contentType,
    ownerLevel: item.ownerLevel
  }, item.territoryId);
  return item;
}

export async function distributeContentToNetwork(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  contentItemId: string,
  territoryIds: string[],
  input: {
    lockedFields: string[];
    editableFields: string[];
    masterVersionNumber: number;
  }
) {
  requirePublishingPermission(context, permissions, "contentDistributeNetwork");
  const item = requireCanonicalContent(data, contentItemId);
  if (item.ownerLevel !== "network") {
    throw new Error("Only network-owned content can be distributed to the network.");
  }
  const created: ContentLocalisation[] = [];
  for (const territoryId of [...new Set(territoryIds)]) {
    if (!data.territories.some((territory) => territory.id === territoryId)) {
      throw new Error("Distribution references an unknown territory.");
    }
    const existing = data.contentLocalisations.find((candidate) => candidate.masterContentItemId === item.id && candidate.territoryId === territoryId && !candidate.deletedAt);
    if (existing) {
      if (existing.masterVersionNumber < input.masterVersionNumber && existing.state !== "locally_overridden") {
        existing.masterVersionNumber = input.masterVersionNumber;
        existing.state = "master_updated";
      }
      continue;
    }
    const localisation: ContentLocalisation = {
      id: crypto.randomUUID(),
      masterContentItemId: item.id,
      territoryId,
      localContentItemId: null,
      state: "inherited",
      lockedFields: input.lockedFields,
      editableFields: input.editableFields,
      localOverrides: {},
      masterVersionNumber: input.masterVersionNumber,
      reviewedAt: null
    };
    data.contentLocalisations.push(localisation);
    created.push(localisation);
  }
  await recordContentAuditAndEvent(context, audit, data, auditActions.contentNetworkDistributed, "content_item", item.id, {
    territoryIds,
    createdCount: created.length
  }, null);
  return created;
}

export async function localiseContentForTerritory(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  localisationId: string,
  overrides: Record<string, unknown>
) {
  requirePublishingPermission(context, permissions, "contentLocalise");
  const localisation = requireContentLocalisation(data, localisationId);
  ensureContextCanAccessTerritory(context, localisation.territoryId);
  for (const field of Object.keys(overrides)) {
    if (localisation.lockedFields.includes(field)) {
      throw new Error("Locked HQ content fields cannot be locally overridden.");
    }
  }
  localisation.localOverrides = { ...localisation.localOverrides, ...overrides };
  localisation.state = "locally_overridden";
  localisation.reviewedAt = today();
  await recordContentAuditAndEvent(context, audit, data, auditActions.contentLocalised, "content_localisation", localisation.id, {
    masterContentItemId: localisation.masterContentItemId,
    overrideKeys: Object.keys(overrides)
  }, localisation.territoryId);
  return localisation;
}

export async function repurposeContentVariant(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  contentItemId: string,
  channel: string,
  input: {
    taskId: string;
    promptTemplateVersion: string;
    providerKey?: string | null;
    modelReference?: string | null;
  }
) {
  requirePublishingPermission(context, permissions, "contentAiGenerate");
  const item = requireCanonicalContent(data, contentItemId);
  if (item.territoryId) {
    ensureContextCanAccessTerritory(context, item.territoryId);
  }
  const sourceVersion = latestContentVersion(data, item.id);
  const output = deterministicChannelOutput(item, sourceVersion, channel);
  const task: ContentAiTask = {
    id: input.taskId,
    task: `content.repurpose.${channel}`,
    contentItemId: item.id,
    sourceVersionId: sourceVersion?.id ?? null,
    targetChannel: channel,
    status: "generated",
    providerKey: input.providerKey ?? "development",
    modelReference: input.modelReference ?? "deterministic-content-adapter",
    promptTemplateVersion: input.promptTemplateVersion,
    generatedOutput: output,
    generatedAt: today(),
    humanDecision: null,
    decidedByUserId: null,
    decidedAt: null,
    provenance: { generatedBy: "ai", source: "provider_neutral_task" }
  };
  data.contentAiTasks.push(task);
  const variant = upsertVariant(data, item.id, channel, item.territoryId ?? null);
  const nextVersionNumber = nextVariantVersionNumber(data, variant.id);
  const variantVersion: ContentChannelVariantVersion = {
    id: crypto.randomUUID(),
    variantId: variant.id,
    versionNumber: nextVersionNumber,
    status: "ai_draft",
    snapshot: output,
    generatedByTaskId: task.id,
    provenance: { generatedBy: "ai", taskId: task.id },
    createdByUserId: context.userId,
    approvedByUserId: null,
    approvedAt: null
  };
  data.contentChannelVariantVersions.push(variantVersion);
  variant.currentVersionId = variantVersion.id;
  variant.status = variant.status === "approved" || variant.status === "published" ? "needs_review" : "ai_draft";
  await recordContentAuditAndEvent(context, audit, data, auditActions.contentVariantGenerated, "content_channel_variant", variant.id, {
    contentItemId: item.id,
    channel,
    task: task.task
  }, item.territoryId);
  return { task, variant, version: variantVersion };
}

export async function repurposeEverywhere(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  contentItemId: string,
  channels = ["magazine", "website", "newsletter", "facebook", "instagram", "linkedin"]
) {
  const generated = [];
  for (const channel of channels) {
    generated.push(await repurposeContentVariant(context, permissions, audit, data, contentItemId, channel, {
      taskId: crypto.randomUUID(),
      promptTemplateVersion: "mkt-004.v1"
    }));
  }
  return generated;
}

export async function approveContentVariant(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  variantId: string
) {
  requirePublishingPermission(context, permissions, "contentAiApprove");
  const variant = requireContentVariant(data, variantId);
  const item = requireCanonicalContent(data, variant.contentItemId);
  if (item.territoryId) {
    ensureContextCanAccessTerritory(context, item.territoryId);
  }
  const version = variant.currentVersionId
    ? data.contentChannelVariantVersions.find((candidate) => candidate.id === variant.currentVersionId && !candidate.deletedAt)
    : undefined;
  if (!version) {
    throw new Error("Variant has no current version to approve.");
  }
  version.status = "approved";
  version.approvedByUserId = context.userId;
  version.approvedAt = today();
  variant.status = "approved";
  const task = version.generatedByTaskId ? data.contentAiTasks.find((candidate) => candidate.id === version.generatedByTaskId) : undefined;
  if (task) {
    task.humanDecision = "accepted";
    task.decidedByUserId = context.userId;
    task.decidedAt = today();
  }
  await recordContentAuditAndEvent(context, audit, data, auditActions.contentVariantApproved, "content_channel_variant", variant.id, {
    contentItemId: item.id,
    channel: variant.channel,
    versionNumber: version.versionNumber
  }, item.territoryId);
  return variant;
}

export async function restoreContentVersion(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  contentItemId: string,
  versionNumber: number
) {
  requirePublishingPermission(context, permissions, "contentEdit");
  const item = requireCanonicalContent(data, contentItemId);
  if (item.territoryId) {
    ensureContextCanAccessTerritory(context, item.territoryId);
  }
  const version = data.contentItemVersions.find((candidate) => candidate.contentItemId === item.id && candidate.versionNumber === versionNumber && !candidate.deletedAt);
  if (!version) {
    throw new Error("Content version was not found.");
  }
  const snapshot = version.snapshot;
  item.title = String(snapshot.title ?? item.title);
  item.standfirst = typeof snapshot.standfirst === "string" ? snapshot.standfirst : item.standfirst;
  item.provenance = { ...item.provenance, restoredFromVersion: versionNumber };
  data.contentItemVersions.push({
    id: crypto.randomUUID(),
    contentItemId: item.id,
    versionNumber: nextContentVersionNumber(data, item.id),
    status: "draft",
    snapshot,
    changeSummary: `Restored from version ${versionNumber}`,
    provenance: { restoredFromVersion: versionNumber },
    createdByUserId: context.userId
  });
  await recordContentAuditAndEvent(context, audit, data, auditActions.contentUpdated, "content_item", item.id, {
    action: "restore",
    restoredFromVersion: versionNumber
  }, item.territoryId);
  return item;
}

export async function prepareWebsitePublishing(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  variantId: string,
  idempotencyKey: string
) {
  requirePublishingPermission(context, permissions, "contentWebsitePublish");
  const existing = data.contentWebsitePublishingJobs.find((job) => job.idempotencyKey === idempotencyKey && !job.deletedAt);
  if (existing) {
    return existing;
  }
  const variant = requireContentVariant(data, variantId);
  if (variant.channel !== "website" || variant.status !== "approved") {
    throw new Error("Only approved website variants can be prepared for publishing.");
  }
  const item = requireCanonicalContent(data, variant.contentItemId);
  const version = variant.currentVersionId
    ? data.contentChannelVariantVersions.find((candidate) => candidate.id === variant.currentVersionId && !candidate.deletedAt)
    : undefined;
  if (!version) {
    throw new Error("Website variant has no approved version.");
  }
  const job: ContentWebsitePublishingJob = {
    id: crypto.randomUUID(),
    contentItemId: item.id,
    variantId: variant.id,
    providerKey: "development",
    status: "ready",
    preparedSnapshot: version.snapshot,
    providerMetadata: {},
    idempotencyKey,
    preparedAt: today()
  };
  data.contentWebsitePublishingJobs.push(job);
  await recordContentAuditAndEvent(context, audit, data, auditActions.contentWebsiteReady, "content_website_publishing_job", job.id, {
    contentItemId: item.id,
    variantId: variant.id
  }, item.territoryId);
  return job;
}

export async function registerSocialAccount(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  account: SocialAccount
) {
  requirePublishingPermission(context, permissions, "socialManageAccounts");
  if (account.territoryId) ensureContextCanAccessTerritory(context, account.territoryId);
  data.socialAccounts.push(account);
  await audit.record(auditEvent(context, auditActions.socialAccountChanged, "social_account", account.id, {
    channel: account.channel,
    connectionStatus: account.connectionStatus
  }, account.territoryId));
  return account;
}

export async function queueSocialPublication(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  input: {
    id: string;
    variantId: string;
    territoryId: string;
    socialAccountId: string;
    idempotencyKey: string;
    cta?: string | null;
    linkUrl?: string | null;
  }
) {
  requirePublishingPermission(context, permissions, "socialCreate");
  const existing = data.socialPublications.find((publication) => publication.idempotencyKey === input.idempotencyKey && !publication.deletedAt);
  if (existing) return existing;
  ensureContextCanAccessTerritory(context, input.territoryId);
  const account = requireSocialAccount(data, input.socialAccountId);
  if (account.territoryId !== input.territoryId) {
    throw new Error("Social account is outside the selected territory.");
  }
  const variant = requireContentVariant(data, input.variantId);
  if (variant.status !== "approved") {
    throw new Error("Only approved content variants can be queued for social publishing.");
  }
  if (variant.channel !== account.channel) {
    throw new Error("Social account channel must match the content variant channel.");
  }
  const item = requireCanonicalContent(data, variant.contentItemId);
  const version = variant.currentVersionId ? requireVariantVersion(data, variant.currentVersionId) : undefined;
  if (!version || version.status !== "approved") {
    throw new Error("Queued social publication requires an approved variant version.");
  }
  const publication: SocialPublication = {
    id: input.id,
    contentItemId: item.id,
    variantId: variant.id,
    variantVersionId: version.id,
    territoryId: input.territoryId,
    socialAccountId: account.id,
    channel: account.channel,
    approvalState: "draft",
    publishState: "draft",
    scheduledAt: null,
    timezone: "Europe/London",
    immutableSnapshot: { ...version.snapshot },
    mediaArtifactReferences: [],
    cta: input.cta ?? null,
    linkUrl: input.linkUrl ?? null,
    advertiserId: item.advertiserId ?? null,
    commercialBookingId: item.commercialBookingId ?? null,
    publishedExternalReference: null,
    retryCount: 0,
    maxRetries: 3,
    failureMetadata: {},
    createdByUserId: context.userId,
    approvedByUserId: null,
    scheduledByUserId: null,
    publishedByUserId: null,
    approvedAt: null,
    publishedAt: null,
    idempotencyKey: input.idempotencyKey
  };
  data.socialPublications.push(publication);
  await recordSocialAuditAndEvent(context, audit, data, auditActions.socialQueued, publication, { variantId: variant.id });
  return publication;
}

export async function approveSocialPublication(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  publicationId: string
) {
  requirePublishingPermission(context, permissions, "socialApprove");
  const publication = requireSocialPublication(data, publicationId);
  ensureContextCanAccessTerritory(context, publication.territoryId);
  if (publication.publishState !== "draft" && publication.publishState !== "needs_review") {
    throw new Error("Only draft or review social publications can be approved.");
  }
  publication.approvalState = "approved";
  publication.publishState = "approved";
  publication.approvedByUserId = context.userId;
  publication.approvedAt = now();
  await recordSocialAuditAndEvent(context, audit, data, auditActions.socialApproved, publication, {});
  return publication;
}

export async function scheduleSocialPublication(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  publicationId: string,
  scheduledAt: string,
  timezone = "Europe/London"
) {
  requirePublishingPermission(context, permissions, "socialSchedule");
  const publication = requireSocialPublication(data, publicationId);
  ensureContextCanAccessTerritory(context, publication.territoryId);
  if (publication.approvalState !== "approved") {
    throw new Error("Social publication must be approved before scheduling.");
  }
  if (publication.publishState !== "approved" && publication.publishState !== "scheduled") {
    throw new Error("Only approved or scheduled social publications can be scheduled.");
  }
  publication.scheduledAt = scheduledAt;
  publication.timezone = timezone;
  publication.publishState = "scheduled";
  publication.scheduledByUserId = context.userId;
  upsertSocialPublishJob(data, publication);
  await recordSocialAuditAndEvent(context, audit, data, auditActions.socialScheduled, publication, { scheduledAt, timezone });
  return publication;
}

export async function cancelSocialPublication(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  publicationId: string
) {
  requirePublishingPermission(context, permissions, "socialCancel");
  const publication = requireSocialPublication(data, publicationId);
  ensureContextCanAccessTerritory(context, publication.territoryId);
  if (publication.publishState === "published") {
    throw new Error("Published social publications cannot be cancelled.");
  }
  publication.publishState = "cancelled";
  data.socialPublishJobs
    .filter((job) => job.publicationId === publication.id && job.status === "queued")
    .forEach((job) => { job.status = "cancelled"; });
  await recordSocialAuditAndEvent(context, audit, data, auditActions.socialCancelled, publication, {});
  return publication;
}

export async function publishDueSocialJob(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  provider: SocialPublishingProvider,
  jobId: string
) {
  requirePublishingPermission(context, permissions, "socialPublish");
  const job = data.socialPublishJobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error("Social publish job was not found.");
  if (job.status === "completed") return requireSocialPublication(data, job.publicationId);
  const publication = requireSocialPublication(data, job.publicationId);
  ensureContextCanAccessTerritory(context, publication.territoryId);
  const account = requireSocialAccount(data, publication.socialAccountId);
  if (publication.publishState !== "scheduled" && publication.publishState !== "failed") {
    throw new Error("Only scheduled or retryable failed publications can be published.");
  }
  publication.publishState = "publishing";
  job.status = "running";
  job.attempts += 1;
  job.lockedAt = now();
  await recordSocialAuditAndEvent(context, audit, data, auditActions.socialPublishStarted, publication, { jobId: job.id });
  const result = await provider.publish({ publication, account });
  job.providerResponse = sanitizeProviderMetadata(result.metadata ?? {});
  job.completedAt = now();
  if (result.status === "published") {
    job.status = "completed";
    publication.publishState = "published";
    publication.publishedAt = now();
    publication.publishedByUserId = context.userId;
    publication.publishedExternalReference = result.externalReference ?? `dev-${publication.id}`;
    await recordSocialAuditAndEvent(context, audit, data, auditActions.socialPublished, publication, {
      externalReference: publication.publishedExternalReference
    });
  } else {
    job.status = job.attempts >= job.maxAttempts ? "failed" : "queued";
    publication.publishState = "failed";
    publication.retryCount += 1;
    publication.failureMetadata = sanitizeProviderMetadata(result.metadata ?? { reason: "provider_failure" });
    await recordSocialAuditAndEvent(context, audit, data, auditActions.socialPublishFailed, publication, {
      attempts: job.attempts
    });
  }
  return publication;
}

function sanitizeProviderMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set([
    "access_token",
    "token",
    "page_access_token",
    "app_secret",
    "client_secret",
    "authorization"
  ]);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blocked.has(key.toLowerCase()))
      .map(([key, item]) => [
        key,
        item && typeof item === "object" && !Array.isArray(item)
          ? sanitizeProviderMetadata(item as Record<string, unknown>)
          : item
      ])
  );
}

export async function createNetworkSocialQueueSuggestions(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  variantId: string,
  territoryIds: string[]
) {
  requirePublishingPermission(context, permissions, "socialNetworkDistribute");
  const created: SocialPublication[] = [];
  for (const territoryId of territoryIds) {
    const variant = requireContentVariant(data, variantId);
    const account = data.socialAccounts.find((candidate) => candidate.territoryId === territoryId && candidate.channel === variant.channel && candidate.active && !candidate.deletedAt);
    if (!account) continue;
    created.push(await queueSocialPublication(context, permissions, audit, data, {
      id: crypto.randomUUID(),
      variantId,
      territoryId,
      socialAccountId: account.id,
      idempotencyKey: `social:suggest:${variantId}:${territoryId}`
    }));
  }
  return created;
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

export async function runPagePreflight(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  pageId: string,
  artifact: Record<string, unknown>
) {
  requirePublishingPermission(context, permissions, "preflightOverride");
  const page = requireEditionPage(data, pageId);
  const edition = requireTerritoryEdition(data, page.territoryEditionId);
  ensureContextCanAccessEdition(context, edition);
  const checks = preflightChecks(artifact);
  const unfixableIssues = checks.filter((check) => check.severity === "error" && !check.fixable);
  const status = preflightStatus(checks);
  const result: PreflightResult = {
    id: crypto.randomUUID(),
    entityType: "edition_page",
    entityId: page.id,
    territoryEditionId: edition.id,
    status,
    checks,
    fixes: [],
    originalArtifact: { ...artifact },
    derivedArtifact: {},
    unfixableIssues,
    createdByUserId: context.userId
  };
  data.preflightResults.push(result);
  page.issues = checks.map((check) => ({
    type: check.code,
    severity: check.severity,
    fixable: check.fixable,
    message: check.message
  }));
  page.readiness = status === "passed" ? "ready" : "blocked";
  page.status = status === "passed" ? "print_ready" : "preflight_failed";
  await audit.record(auditEvent(context, auditActions.publishingPreflightOverride, "preflight_result", result.id, {
    action: "run",
    pageId: page.id,
    status,
    issueCount: checks.length
  }, edition.territoryId));
  return result;
}

export async function applySafePreflightFixes(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  resultId: string
) {
  requirePublishingPermission(context, permissions, "preflightOverride");
  const result = requirePreflightResult(data, resultId);
  if (result.entityType !== "edition_page") {
    throw new Error("Only edition page preflight results can be fixed in EDT-006.");
  }
  const page = requireEditionPage(data, result.entityId);
  const edition = requireTerritoryEdition(data, page.territoryEditionId);
  ensureContextCanAccessEdition(context, edition);
  const fixes: PreflightFix[] = result.checks
    .filter((check) => check.fixable)
    .map((check) => ({
      code: check.code,
      action: safeFixAction(check.code),
      applied: true
    }));
  result.fixes = fixes;
  result.derivedArtifact = {
    ...result.originalArtifact,
    derivedFromPreflightResultId: result.id,
    safeFixesApplied: fixes.map((fix) => fix.code)
  };
  result.unfixableIssues = result.checks.filter((check) => check.severity === "error" && !check.fixable);
  result.status = result.unfixableIssues.length > 0 ? "failed" : "fixed";
  page.issues = result.unfixableIssues.map((check) => ({
    type: check.code,
    severity: check.severity,
    fixable: false,
    message: check.message
  }));
  page.readiness = result.status === "fixed" ? "ready" : "blocked";
  page.status = result.status === "fixed" ? "print_ready" : "preflight_failed";
  await audit.record(auditEvent(context, auditActions.publishingPreflightOverride, "preflight_result", result.id, {
    action: "apply_safe_fixes",
    pageId: page.id,
    status: result.status,
    appliedFixes: fixes.map((fix) => fix.code),
    unfixableCount: result.unfixableIssues.length
  }, edition.territoryId));
  return result;
}

export async function generatePrintOutput(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  territoryEditionId: string,
  input: {
    idempotencyKey: string;
    artifact: Record<string, unknown>;
    preflightResultId?: string | null;
    corrections?: Array<Record<string, unknown>>;
  }
) {
  requirePublishingPermission(context, permissions, "generatePrint");
  const edition = requireTerritoryEdition(data, territoryEditionId);
  ensureContextCanAccessEdition(context, edition);
  const existing = findOutputByIdempotencyKey(data, input.idempotencyKey);
  if (existing) {
    return existing;
  }
  assertEditionReadyForOutput(data, edition, "print");
  const output = createPublicationOutput(context, data, edition, "print", input);
  edition.printStatus = "generated";
  await audit.record(auditEvent(context, auditActions.publishingPrintGenerate, "publication_output", output.id, {
    territoryEditionId: edition.id,
    version: output.version,
    pageCount: output.sourcePageSnapshot.length
  }, edition.territoryId));
  return output;
}

export async function generateDigitalOutput(
  context: PublishingActorContext,
  permissions: PermissionData,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  territoryEditionId: string,
  input: {
    idempotencyKey: string;
    artifact: Record<string, unknown>;
    corrections?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  }
) {
  requirePublishingPermission(context, permissions, "generateDigital");
  const edition = requireTerritoryEdition(data, territoryEditionId);
  ensureContextCanAccessEdition(context, edition);
  const existing = findOutputByIdempotencyKey(data, input.idempotencyKey);
  if (existing) {
    return existing;
  }
  assertEditionReadyForOutput(data, edition, "digital");
  const output = createPublicationOutput(context, data, edition, "digital", {
    ...input,
    metadata: {
      accessibility: "required",
      links: "tracked",
      ...input.metadata
    }
  });
  edition.digitalStatus = "generated";
  await audit.record(auditEvent(context, auditActions.publishingDigitalGenerate, "publication_output", output.id, {
    territoryEditionId: edition.id,
    version: output.version,
    pageCount: output.sourcePageSnapshot.length
  }, edition.territoryId));
  return output;
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

function requireCanonicalContent(data: PublishingData, contentItemId: string) {
  const item = data.contentItems.find((candidate) => candidate.id === contentItemId && !candidate.deletedAt);
  if (!item) {
    throw new Error("Content item was not found.");
  }
  return item;
}

function requireContentVariant(data: PublishingData, variantId: string) {
  const variant = data.contentChannelVariants.find((candidate) => candidate.id === variantId && !candidate.deletedAt);
  if (!variant) {
    throw new Error("Content channel variant was not found.");
  }
  return variant;
}

function requireVariantVersion(data: PublishingData, variantVersionId: string) {
  const version = data.contentChannelVariantVersions.find((candidate) => candidate.id === variantVersionId && !candidate.deletedAt);
  if (!version) {
    throw new Error("Content channel variant version was not found.");
  }
  return version;
}

function requireSocialAccount(data: PublishingData, accountId: string) {
  const account = data.socialAccounts.find((candidate) => candidate.id === accountId && candidate.active && !candidate.deletedAt);
  if (!account) {
    throw new Error("Social account was not found or is inactive.");
  }
  return account;
}

function requireSocialPublication(data: PublishingData, publicationId: string) {
  const publication = data.socialPublications.find((candidate) => candidate.id === publicationId && !candidate.deletedAt);
  if (!publication) {
    throw new Error("Social publication was not found.");
  }
  return publication;
}

function upsertSocialPublishJob(data: PublishingData, publication: SocialPublication) {
  const existing = data.socialPublishJobs.find((job) => job.publicationId === publication.id && job.status !== "completed");
  if (existing) {
    existing.runAfter = publication.scheduledAt ?? now();
    existing.providerRequest = { publicationId: publication.id, channel: publication.channel };
    return existing;
  }
  const job: SocialPublishJob = {
    id: crypto.randomUUID(),
    publicationId: publication.id,
    status: "queued",
    runAfter: publication.scheduledAt ?? now(),
    attempts: 0,
    maxAttempts: publication.maxRetries,
    providerKey: "development",
    providerRequest: { publicationId: publication.id, channel: publication.channel },
    providerResponse: {},
    lastError: null,
    lockedAt: null,
    completedAt: null,
    idempotencyKey: `social:publish:${publication.id}`
  };
  data.socialPublishJobs.push(job);
  return job;
}

function socialWarnings(publication: SocialPublication, data: PublishingData) {
  const warnings = [];
  if (publication.publishState === "failed") warnings.push("scheduled_post_failed");
  if (publication.commercialBookingId && publication.publishState !== "scheduled" && publication.publishState !== "published") warnings.push("advertiser_social_obligation_unscheduled");
  if (publication.approvalState !== "approved") warnings.push("content_waiting_approval");
  const duplicates = data.socialPublications.filter((candidate) =>
    candidate.id !== publication.id &&
    candidate.territoryId === publication.territoryId &&
    candidate.channel === publication.channel &&
    candidate.immutableSnapshot.postCopy === publication.immutableSnapshot.postCopy &&
    !candidate.deletedAt
  );
  if (duplicates.length > 0) warnings.push("duplicate_content_warning");
  return warnings;
}

async function recordSocialAuditAndEvent(
  context: PublishingActorContext,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  action: string,
  publication: SocialPublication,
  payload: Record<string, unknown>
) {
  await audit.record(auditEvent(context, action, "social_publication", publication.id, payload, publication.territoryId));
  data.contentDomainEvents.push({
    id: crypto.randomUUID(),
    eventType: action,
    contentItemId: publication.contentItemId,
    territoryId: publication.territoryId,
    payload: { publicationId: publication.id, ...payload },
    occurredAt: today(),
    idempotencyKey: `${action}:${publication.id}:${data.contentDomainEvents.length + 1}`,
    processedAt: null
  });
}

function now() {
  return new Date().toISOString();
}

function requireContentLocalisation(data: PublishingData, localisationId: string) {
  const localisation = data.contentLocalisations.find((candidate) => candidate.id === localisationId && !candidate.deletedAt);
  if (!localisation) {
    throw new Error("Content localisation was not found.");
  }
  return localisation;
}

function contentVisible(item: ContentItem, visibleTerritoryIds: Set<string> | null, data: PublishingData) {
  if (visibleTerritoryIds == null) {
    return true;
  }
  if (item.territoryId) {
    return visibleTerritoryIds.has(item.territoryId);
  }
  return data.contentLocalisations.some((localisation) =>
    localisation.masterContentItemId === item.id &&
    visibleTerritoryIds.has(localisation.territoryId) &&
    !localisation.deletedAt &&
    localisation.state !== "opted_out"
  );
}

function assembleContentLibraryItem(item: ContentItem, data: PublishingData): ContentLibraryItem {
  const variants = data.contentChannelVariants.filter((variant) => variant.contentItemId === item.id && !variant.deletedAt);
  const localisations = data.contentLocalisations.filter((localisation) => localisation.masterContentItemId === item.id && !localisation.deletedAt);
  const currentVersion = latestContentVersion(data, item.id);
  return {
    item,
    currentVersion,
    variants,
    localisations,
    health: contentHealth(item, variants, localisations),
    editionStatus: editionStatus(item, data)
  };
}

function contentHealth(item: ContentItem, variants: ContentChannelVariant[], localisations: ContentLocalisation[]) {
  const signals = [];
  if (Object.keys(item.heroArtifactReference).length === 0) signals.push("missing_image");
  if (!variants.some((variant) => variant.channel === "website")) signals.push("no_web_version");
  if (!variants.some((variant) => variant.channel === "newsletter")) signals.push("newsletter_variant_missing");
  if (!variants.some((variant) => variant.channel === "facebook" || variant.channel === "instagram")) signals.push("social_variants_missing");
  if (item.contentType === "event" && !item.relevantDates.endsAt) signals.push("approaching_event_expiry");
  if (item.advertiserId || item.commercialBookingId) signals.push("advertiser_obligation");
  if (localisations.some((localisation) => localisation.state === "master_updated" || localisation.state === "review_required")) signals.push("localisation_requires_review");
  return signals;
}

function editionStatus(item: ContentItem, data: PublishingData): ContentLibraryItem["editionStatus"] {
  if (!item.editionContentItemId) {
    return "unused";
  }
  const territoryContent = data.territoryEditionContent.filter((content) => content.sourceContentItemId === item.editionContentItemId && !content.deletedAt);
  if (territoryContent.length === 0) {
    return "assigned";
  }
  const assignedIds = new Set(territoryContent.map((content) => content.id));
  const pages = data.editionPages.filter((page) => page.assignedContentId && assignedIds.has(page.assignedContentId) && !page.deletedAt);
  if (pages.some((page) => page.status === "published")) return "published";
  if (pages.some((page) => page.readiness === "ready")) return "preflight_ready";
  if (pages.length > 0) return "placed";
  return "assigned";
}

function latestContentVersion(data: PublishingData, contentItemId: string) {
  return data.contentItemVersions
    .filter((version) => version.contentItemId === contentItemId && !version.deletedAt)
    .sort((left, right) => right.versionNumber - left.versionNumber)[0];
}

function nextContentVersionNumber(data: PublishingData, contentItemId: string) {
  return Math.max(0, ...data.contentItemVersions.filter((version) => version.contentItemId === contentItemId).map((version) => version.versionNumber)) + 1;
}

function nextVariantVersionNumber(data: PublishingData, variantId: string) {
  return Math.max(0, ...data.contentChannelVariantVersions.filter((version) => version.variantId === variantId).map((version) => version.versionNumber)) + 1;
}

function upsertVariant(data: PublishingData, contentItemId: string, channel: string, territoryId?: string | null): ContentChannelVariant {
  const existing = data.contentChannelVariants.find((variant) =>
    variant.contentItemId === contentItemId &&
    variant.channel === channel &&
    (variant.territoryId ?? null) === (territoryId ?? null) &&
    !variant.deletedAt
  );
  if (existing) {
    return existing;
  }
  const variant: ContentChannelVariant = {
    id: crypto.randomUUID(),
    contentItemId,
    channel,
    status: "not_created",
    currentVersionId: null,
    territoryId: territoryId ?? null,
    scheduledAt: null,
    publishedAt: null,
    provenance: {}
  };
  data.contentChannelVariants.push(variant);
  return variant;
}

function deterministicChannelOutput(item: ContentItem, version: ContentItemVersion | undefined, channel: string) {
  const snapshot = version?.snapshot ?? {};
  const body = String(snapshot.body ?? item.standfirst ?? item.title);
  if (channel === "magazine") {
    return {
      editorialHeadline: item.title,
      standfirst: item.standfirst,
      printBody: body,
      pullQuote: item.standfirst ?? item.title,
      wordCountTarget: 450
    };
  }
  if (channel === "website") {
    return {
      webHeadline: item.title,
      body,
      excerpt: item.standfirst,
      seoTitle: `${item.title} | Raring2go`,
      metaDescription: item.standfirst ?? item.title,
      slug: item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      cta: "Find more local family ideas"
    };
  }
  if (channel === "newsletter") {
    return {
      newsletterHeadline: item.title,
      summary: item.standfirst ?? body.slice(0, 140),
      cta: "Read more",
      block: { type: "article", contentItemId: item.id }
    };
  }
  if (channel === "instagram") {
    return {
      caption: `${item.title}. ${item.standfirst ?? ""}`.trim(),
      shortVariant: item.title,
      topics: item.tags.slice(0, 5),
      imageBrief: "Warm family editorial image suitable for Raring2go social."
    };
  }
  if (channel === "linkedin") {
    return {
      postCopy: `${item.title}: ${item.standfirst ?? "A Raring2go network update."}`,
      cta: "View the full update"
    };
  }
  return {
    postCopy: `${item.title}\n\n${item.standfirst ?? ""}`.trim(),
    cta: "Read more",
    alternateVersions: [item.title]
  };
}

function ensureContextCanAccessTerritory(context: PublishingActorContext, territoryId: string) {
  if (context.territoryId && context.territoryId !== territoryId) {
    throw new Error("Content item is outside the active territory.");
  }
}

async function recordContentAuditAndEvent(
  context: PublishingActorContext,
  audit: PublishingAuditRecorder,
  data: PublishingData,
  action: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
  territoryId?: string | null
) {
  await audit.record(auditEvent(context, action, entityType, entityId, payload, territoryId));
  const idempotencyKey = `${action}:${entityId}:${data.contentDomainEvents.length + 1}`;
  data.contentDomainEvents.push({
    id: crypto.randomUUID(),
    eventType: action,
    contentItemId: entityType === "content_item" ? entityId : typeof payload.contentItemId === "string" ? payload.contentItemId : null,
    territoryId: territoryId ?? null,
    payload,
    occurredAt: today(),
    idempotencyKey,
    processedAt: null
  });
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

function requirePreflightResult(data: PublishingData, resultId: string) {
  const result = data.preflightResults.find((candidate) => candidate.id === resultId && !candidate.deletedAt);
  if (!result) {
    throw new Error("Preflight result was not found.");
  }
  return result;
}

function findOutputByIdempotencyKey(data: PublishingData, idempotencyKey: string) {
  return data.publicationOutputs.find((candidate) => candidate.idempotencyKey === idempotencyKey && !candidate.deletedAt);
}

function assertEditionReadyForOutput(data: PublishingData, edition: TerritoryEdition, outputType: "print" | "digital") {
  if (edition.status !== "approved" && edition.status !== "published") {
    throw new Error("Only approved territory editions can generate outputs.");
  }
  const pages = data.editionPages.filter((page) => page.territoryEditionId === edition.id && !page.deletedAt);
  if (pages.length !== edition.pageCount) {
    throw new Error("Every edition page must exist before output generation.");
  }
  if (pages.some((page) => page.readiness !== "ready" || page.issues.length > 0)) {
    throw new Error("Every edition page must be ready and clear of issues before output generation.");
  }
  if (outputType === "print") {
    const latestPagePreflights = pages.map((page) =>
      data.preflightResults.find((result) => result.entityType === "edition_page" && result.entityId === page.id && !result.deletedAt)
    );
    if (latestPagePreflights.some((result) => !result || (result.status !== "passed" && result.status !== "fixed"))) {
      throw new Error("Print output requires successful preflight for every page.");
    }
  }
}

function createPublicationOutput(
  context: PublishingActorContext,
  data: PublishingData,
  edition: TerritoryEdition,
  outputType: "print" | "digital",
  input: {
    idempotencyKey: string;
    artifact: Record<string, unknown>;
    preflightResultId?: string | null;
    corrections?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  }
) {
  const version = Math.max(
    0,
    ...data.publicationOutputs
      .filter((output) => output.territoryEditionId === edition.id && output.outputType === outputType && !output.deletedAt)
      .map((output) => output.version)
  ) + 1;
  const pages = data.editionPages
    .filter((page) => page.territoryEditionId === edition.id && !page.deletedAt)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  const output: PublicationOutput = {
    id: crypto.randomUUID(),
    territoryEditionId: edition.id,
    outputType,
    status: "generated",
    version,
    sourcePageSnapshot: pages.map((page) => ({
      id: page.id,
      pageNumber: page.pageNumber,
      templateVersionId: page.templateVersionId,
      assignedContentId: page.assignedContentId,
      status: page.status,
      readiness: page.readiness
    })),
    artifact: input.artifact,
    preflightResultId: input.preflightResultId ?? null,
    idempotencyKey: input.idempotencyKey,
    corrections: input.corrections ?? [],
    metadata: input.metadata ?? {},
    generatedByUserId: context.userId,
    generatedAt: today()
  };
  data.publicationOutputs.push(output);
  return output;
}

function ensureContextCanAccessEdition(context: PublishingActorContext, edition: TerritoryEdition) {
  if (context.territoryId && context.territoryId !== edition.territoryId) {
    throw new Error("Edition is outside the active territory.");
  }
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

function preflightChecks(artifact: Record<string, unknown>): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  if (artifact.colourSpace !== "cmyk") {
    checks.push({
      code: "colour_space_rgb",
      severity: "error",
      message: "Artwork must use CMYK colour for print.",
      fixable: artifact.allowColourConversion === true
    });
  }
  if (typeof artifact.dpi === "number" && artifact.dpi < 300) {
    checks.push({
      code: "low_resolution",
      severity: "error",
      message: "Placed images must be at least 300dpi for print.",
      fixable: false
    });
  }
  if (artifact.bleedPresent !== true) {
    checks.push({
      code: "missing_bleed",
      severity: "error",
      message: "Artwork is missing print bleed.",
      fixable: artifact.allowBleedExtension === true
    });
  }
  if (artifact.linksChecked !== true) {
    checks.push({
      code: "unchecked_links",
      severity: "warning",
      message: "Digital links have not been checked.",
      fixable: true
    });
  }
  return checks;
}

function preflightStatus(checks: PreflightCheck[]) {
  if (checks.some((check) => check.severity === "error")) {
    return "failed";
  }
  if (checks.some((check) => check.severity === "warning")) {
    return "warning";
  }
  return "passed";
}

function editionPhase(edition: TerritoryEdition) {
  if (edition.status === "published") {
    return "Published";
  }
  if (edition.printStatus === "generated" || edition.digitalStatus === "generated") {
    return "Output generated";
  }
  if (edition.status === "approved") {
    return "Approved";
  }
  if (edition.status === "review") {
    return "HQ review";
  }
  if (edition.status === "localising") {
    return "Local editing";
  }
  return "Planning";
}

function nextEditionDeadline(edition: TerritoryEdition) {
  return (
    edition.editorialDeadline ??
    edition.proofDeadline ??
    edition.printDeadline ??
    edition.publicationDate ??
    null
  );
}

function safeFixAction(code: string) {
  if (code === "colour_space_rgb") {
    return "convert_to_cmyk_derived_copy";
  }
  if (code === "missing_bleed") {
    return "extend_bleed_on_derived_copy";
  }
  if (code === "unchecked_links") {
    return "mark_links_for_manual_review";
  }
  return "record_safe_fix";
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
