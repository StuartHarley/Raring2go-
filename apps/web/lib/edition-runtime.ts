import { createDb } from "@raring2go/db";
import {
  applySafePreflightFixes,
  approvePageReview,
  autosaveLocalPageContent,
  buildRenderPage,
  derivePageArtifact,
  returnPageForChanges,
  runPagePreflight,
  safeImageUrl,
  submitPageForReview,
  assignPageTemplateAndContent,
  createEditionLocalContent,
  reorderEditionPages,
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
import { readTerritoryEdition } from "./publishing-runtime";
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

/** Everything the flatplan editor shows. Reading goes through the edition read, which proves the edition is in the actor's scope. */
export async function readFlatplan(context: PublishingActorContext, territoryEditionId: string) {
  const { row, pages, content } = await readTerritoryEdition(context, territoryEditionId);
  const { db, sql } = createDb();
  try {
    const data = await loadPublishingData(db);
    const versions = data.magazineTemplateVersions.filter((version) => version.status === "published" && !version.deletedAt);
    const templateName = (versionId: string | null | undefined) => {
      const version = data.magazineTemplateVersions.find((candidate) => candidate.id === versionId);
      const template = version ? data.magazineTemplates.find((candidate) => candidate.id === version.templateId) : undefined;
      return version && template ? `${template.name} v${version.version}` : null;
    };
    const contentTitle = (contentId: string | null | undefined) => {
      const entry = content.find((candidate) => candidate.id === contentId);
      return entry ? data.editionContentItems.find((item) => item.id === entry.sourceContentItemId)?.title ?? "Content" : null;
    };
    return {
      edition: row.territoryEdition,
      season: row.season,
      pages: pages.map((page) => ({ page, templateName: templateName(page.templateVersionId), contentTitle: contentTitle(page.assignedContentId) })),
      templates: versions.map((version) => ({ id: version.id, label: templateName(version.id) ?? version.id, category: data.magazineTemplates.find((t) => t.id === version.templateId)?.category ?? "" })).sort((a, b) => a.label.localeCompare(b.label)),
      content: content.map((entry) => ({ id: entry.id, title: contentTitle(entry.id) ?? "Content", state: entry.inheritanceState, locked: entry.locked, usedOnPage: pages.find((page) => page.assignedContentId === entry.id)?.pageNumber ?? null })),
      locked: pages.some((page) => page.locked)
    };
  } finally {
    await sql.end();
  }
}

export const assignPageAsActor = (context: PublishingActorContext, pageId: string, input: { templateVersionId?: string | null; assignedContentId?: string | null }) =>
  mutateEditions((data, audit, permissions) => assignPageTemplateAndContent(context, permissions, audit, data, pageId, input));

/** Moves a page one place earlier or later by swapping its position with its neighbour, through the same reorder rules (locked pages stay put). */
export const movePageAsActor = (context: PublishingActorContext, territoryEditionId: string, pageId: string, direction: "up" | "down") =>
  mutateEditions(async (data, audit, permissions) => {
    const ordered = data.editionPages.filter((page) => page.territoryEditionId === territoryEditionId && !page.deletedAt).sort((a, b) => a.pageNumber - b.pageNumber).map((page) => page.id);
    const index = ordered.indexOf(pageId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= ordered.length) throw new Error("That page cannot move any further.");
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    return reorderEditionPages(context, permissions, audit, data, territoryEditionId, ordered);
  });

export async function createLocalContentAsActor(context: PublishingActorContext, territoryEditionId: string, input: { title: string; contentType: string; headline: string; body: string }) {
  const allowed = ["article", "event", "offer", "competition", "advertorial", "house_page"];
  if (!allowed.includes(input.contentType)) throw new Error("Choose a content type.");
  const body: Record<string, unknown> = {};
  if (input.headline.trim()) body.headline = input.headline.trim().slice(0, 300);
  if (input.body.trim()) body.body = input.body.trim().slice(0, 20000);
  return mutateEditions((data, audit, permissions) => createEditionLocalContent(context, permissions, audit, data, territoryEditionId, { title: input.title, contentType: input.contentType, body }));
}

/** What the page studio shows for one page. Scope is proven by the edition read; the page must belong to that edition. */
export async function readStudioPage(context: PublishingActorContext, territoryEditionId: string, pageId: string) {
  const { row, pages } = await readTerritoryEdition(context, territoryEditionId);
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error("Page was not found in this edition.");
  const { db, sql } = createDb();
  try {
    const data = await loadPublishingData(db);
    const edition = data.territoryEditions.find((candidate) => candidate.id === territoryEditionId)!;
    let layout: ReturnType<typeof buildRenderPage> | null = null;
    try {
      layout = buildRenderPage(data, edition, page);
    } catch {
      layout = null;
    }
    const preflight = data.preflightResults
      .filter((result) => result.entityType === "edition_page" && result.entityId === page.id && !result.deletedAt)
      .at(-1);
    const revisions = data.editionPageRevisions.filter((revision) => revision.pageId === page.id && !revision.deletedAt).sort((a, b) => a.revisionNumber - b.revisionNumber);
    return {
      edition: row.territoryEdition,
      page,
      layout: layout?.page ?? null,
      geometry: layout?.geometry ?? null,
      preflight: preflight ? { id: preflight.id, status: preflight.status, checks: preflight.checks, fixes: preflight.fixes, unfixable: preflight.unfixableIssues } : null,
      revisionCount: revisions.length,
      neighbours: { previous: pages.find((candidate) => candidate.pageNumber === page.pageNumber - 1)?.id ?? null, next: pages.find((candidate) => candidate.pageNumber === page.pageNumber + 1)?.id ?? null }
    };
  } finally {
    await sql.end();
  }
}

const MAX_ZONE_TEXT = 20000;

/** Turns the studio form into a content snapshot. Only the template's own zone ids are read; everything else is ignored. */
export function snapshotFromForm(formData: FormData, zones: Array<{ id: string; kind: string }>): Record<string, unknown> {
  const text = (name: string) => String(formData.get(name) ?? "");
  const values: Record<string, string | string[]> = {};
  const images: Record<string, { url: string; alt: string; widthPx?: number; heightPx?: number }> = {};
  for (const zone of zones) {
    if (zone.kind === "image") {
      const url = text(`image-${zone.id}`).trim();
      if (!url) continue;
      if (!safeImageUrl(url)) throw new Error("Images must be https links or uploaded image data.");
      const dim = (name: string) => {
        const n = Number(text(name));
        return Number.isInteger(n) && n > 0 && n < 100000 ? n : undefined;
      };
      images[zone.id] = { url, alt: text(`alt-${zone.id}`).trim().slice(0, 300), widthPx: dim(`widthPx-${zone.id}`), heightPx: dim(`heightPx-${zone.id}`) };
    } else if (zone.kind === "list") {
      values[zone.id] = text(`zone-${zone.id}`).split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 50).map((line) => line.slice(0, 300));
    } else if (zone.kind !== "advertiser") {
      values[zone.id] = text(`zone-${zone.id}`).slice(0, MAX_ZONE_TEXT);
    }
  }
  return { zones: values, images };
}

export const savePageAsActor = (context: PublishingActorContext, pageId: string, snapshot: Record<string, unknown>) =>
  mutateEditions((data, audit, permissions) => autosaveLocalPageContent(context, permissions, audit, data, pageId, snapshot));

export const submitPageAsActor = (context: PublishingActorContext, pageId: string) =>
  mutateEditions((data, audit, permissions) => submitPageForReview(context, permissions, audit, data, pageId));

export const approvePageAsActor = (context: PublishingActorContext, pageId: string) =>
  mutateEditions((data, audit, permissions) => approvePageReview(context, permissions, audit, data, pageId));

export const returnPageAsActor = (context: PublishingActorContext, pageId: string, comment: string) =>
  mutateEditions((data, audit, permissions) => returnPageForChanges(context, permissions, audit, data, pageId, comment));

export const runPreflightAsActor = (context: PublishingActorContext, pageId: string) =>
  mutateEditions(async (data, audit, permissions) => {
    const page = data.editionPages.find((candidate) => candidate.id === pageId && !candidate.deletedAt);
    const edition = page ? data.territoryEditions.find((candidate) => candidate.id === page.territoryEditionId) : undefined;
    if (!page || !edition) throw new Error("Page was not found.");
    const artifact = derivePageArtifact(buildRenderPage(data, edition, page).page);
    return runPagePreflight(context, permissions, audit, data, pageId, artifact);
  });

export const applyPreflightFixesAsActor = (context: PublishingActorContext, resultId: string) =>
  mutateEditions((data, audit, permissions) => applySafePreflightFixes(context, permissions, audit, data, resultId));
