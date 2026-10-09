import { createDb } from "@raring2go/db";
import {
  approveMasterEdition,
  approveTemplateVersion,
  approveTerritoryEdition,
  buildSeasonAndMaster,
  createEditionFlatplan,
  createSeasonWithMasterEdition,
  generateTerritoryEditions,
  releaseTerritoryEdition,
  reopenTerritoryEdition,
  submitEditionForReview,
  buildTemplateSpec,
  createMagazineTemplate,
  createTemplateRevision,
  listMagazineTemplates,
  loadPublishingData,
  persistEditionChanges,
  publishTemplateVersion,
  snapshotPublishingData,
  specToForm,
  TemplateSpecError,
  zonesOf
} from "@raring2go/publishing";
import type { SeasonFormInput } from "@raring2go/publishing";
import type { MagazineTemplate, MagazineTemplateVersion, PublishingActorContext, PublishingData, TemplateSpecInput } from "@raring2go/publishing";
import type { PermissionData } from "@raring2go/permissions";
import { randomUUID } from "node:crypto";
import { editionAuditFor } from "./edition-output";
import { getPermissionData } from "./permission-source";
import { evaluatePermission } from "@raring2go/permissions";

type Audit = ReturnType<typeof editionAuditFor>;

/** One Edition Factory change: load, run the domain function (which checks permission, scope and writes the audit), persist the difference, commit together. */
export async function mutateEditions<T>(work: (data: PublishingData, audit: Audit, permissions: PermissionData) => Promise<T>) {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();
  try {
    return await db.transaction(async (tx) => {
      const data = await loadPublishingData(tx);
      const before = snapshotPublishingData(data);
      const result = await work(data, editionAuditFor(tx), permissions);
      await persistEditionChanges(tx, before, data);
      return result;
    });
  } finally {
    await sql.end();
  }
}

export async function readTemplateLibrary(context: PublishingActorContext) {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();
  try {
    const data = await loadPublishingData(db);
    return listMagazineTemplates(context, permissions, data).map(({ template, versions }) => ({
      template,
      versions: versions.map((version) => ({ version, zones: zonesOf(version) })),
      inUse: data.editionPages.some((page) => !page.deletedAt && versions.some((version) => version.id === page.templateVersionId))
    }));
  } finally {
    await sql.end();
  }
}

export async function readTemplateForm(context: PublishingActorContext, templateId: string) {
  const library = await readTemplateLibrary(context);
  const entry = library.find((candidate) => candidate.template.id === templateId);
  const latest = entry?.versions[0]?.version;
  if (!entry || !latest) throw new Error("Template was not found.");
  return { template: entry.template, latest, form: specToForm(latest) };
}

export type NewTemplateInput = { key: string; name: string; category: string; spec: TemplateSpecInput };

export async function createTemplateAsActor(context: PublishingActorContext, input: NewTemplateInput) {
  const key = input.key.trim();
  if (!/^[a-z][a-z0-9-]{1,59}$/.test(key)) throw new TemplateSpecError("The key must be lower-case letters, digits and hyphens.", "template_key");
  if (!input.name.trim()) throw new TemplateSpecError("Give the template a name.", "template_name");
  const spec = buildTemplateSpec(input.spec);
  const template: MagazineTemplate = { id: randomUUID(), key, name: input.name.trim(), category: input.category, status: "draft", createdByUserId: context.userId };
  const version = { id: randomUUID(), templateId: template.id, version: 1, status: "draft", ...spec } as MagazineTemplateVersion;
  await mutateEditions((data, audit, permissions) => createMagazineTemplate(context, permissions, audit, data, { template, version }));
  return template.id;
}

export async function reviseTemplateAsActor(context: PublishingActorContext, templateId: string, specInput: TemplateSpecInput) {
  const spec = buildTemplateSpec(specInput);
  return mutateEditions(async (data, audit, permissions) => {
    const next = Math.max(0, ...data.magazineTemplateVersions.filter((version) => version.templateId === templateId && !version.deletedAt).map((version) => version.version)) + 1;
    const revision = { id: randomUUID(), templateId, version: next, status: "draft", ...spec } as MagazineTemplateVersion;
    return createTemplateRevision(context, permissions, audit, data, templateId, revision);
  });
}

export const approveTemplateVersionAsActor = (context: PublishingActorContext, versionId: string) =>
  mutateEditions((data, audit, permissions) => approveTemplateVersion(context, permissions, audit, data, versionId));

export const publishTemplateVersionAsActor = (context: PublishingActorContext, versionId: string) =>
  mutateEditions((data, audit, permissions) => publishTemplateVersion(context, permissions, audit, data, versionId));

export async function readSeasonPlanner(context: PublishingActorContext) {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();
  try {
    const data = await loadPublishingData(db);
    // Reading the planner is an edition-creation concern: the same grant as making a season.
    requireEditionCreateGrant(context, permissions);
    const territories = data.territories.filter((territory) => territory.status === "active");
    return data.seasons
      .filter((season) => !season.deletedAt)
      .map((season) => {
        const masters = data.masterEditions.filter((master) => master.seasonId === season.id && !master.deletedAt);
        const editions = data.territoryEditions.filter((edition) => edition.seasonId === season.id && !edition.deletedAt);
        return {
          season,
          masters: masters.map((master) => ({
            master,
            editions: editions.filter((edition) => edition.masterEditionId === master.id).map((edition) => ({ edition, territoryName: territories.find((t) => t.id === edition.territoryId)?.name ?? "Territory" })),
            missing: territories.filter((territory) => !editions.some((edition) => edition.territoryId === territory.id))
          }))
        };
      })
      .sort((a, b) => b.season.year - a.season.year || a.season.name.localeCompare(b.season.name));
  } finally {
    await sql.end();
  }
}

export async function createSeasonAsActor(context: PublishingActorContext, input: SeasonFormInput) {
  if (!context.organisationId) throw new Error("A season is created within an organisation.");
  const built = buildSeasonAndMaster(input, { seasonId: randomUUID(), masterId: randomUUID(), organisationId: context.organisationId, userId: context.userId });
  await mutateEditions((data, audit, permissions) => createSeasonWithMasterEdition(context, permissions, audit, data, built));
  return built.season.id;
}

export const approveMasterAsActor = (context: PublishingActorContext, masterId: string) =>
  mutateEditions((data, audit, permissions) => approveMasterEdition(context, permissions, audit, data, masterId));

export async function generateEditionsAsActor(context: PublishingActorContext, masterId: string, territoryIds: string[]) {
  if (territoryIds.length === 0) throw new Error("Choose at least one territory.");
  return mutateEditions(async (data, audit, permissions) => {
    const master = data.masterEditions.find((candidate) => candidate.id === masterId && !candidate.deletedAt);
    if (!master || master.status !== "approved") throw new Error("Approve the master edition before generating territory editions.");
    return generateTerritoryEditions(context, permissions, audit, data, masterId, territoryIds);
  });
}

export const createFlatplanAsActor = (context: PublishingActorContext, editionId: string) =>
  mutateEditions((data, audit, permissions) => createEditionFlatplan(context, permissions, audit, data, editionId));

export const submitEditionAsActor = (context: PublishingActorContext, editionId: string) =>
  mutateEditions((data, audit, permissions) => submitEditionForReview(context, permissions, audit, data, editionId));

export const approveEditionAsActor = (context: PublishingActorContext, editionId: string) =>
  mutateEditions((data, audit, permissions) => approveTerritoryEdition(context, permissions, audit, data, editionId));

export const reopenEditionAsActor = (context: PublishingActorContext, editionId: string, reason: string) =>
  mutateEditions((data, audit, permissions) => reopenTerritoryEdition(context, permissions, audit, data, editionId, reason));

export const releaseEditionAsActor = (context: PublishingActorContext, editionId: string) =>
  mutateEditions((data, audit, permissions) => releaseTerritoryEdition(context, permissions, audit, data, editionId));

function requireEditionCreateGrant(context: PublishingActorContext, permissions: PermissionData) {
  const decision = evaluatePermission({ userId: context.userId, module: "edition", action: "create", context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } }, permissions);
  if (!decision.allowed) throw new Error("No permission grant matched this request.");
}
