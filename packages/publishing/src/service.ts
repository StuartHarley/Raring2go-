import { auditActions } from "@raring2go/audit";
import { requirePermission, type PermissionData } from "@raring2go/permissions";
import { publishingCapabilities, type PublishingCapability } from "./permissions";
import type {
  EditionSummary,
  MasterEdition,
  PublishingActorContext,
  PublishingData,
  Season,
  TerritoryEdition
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
