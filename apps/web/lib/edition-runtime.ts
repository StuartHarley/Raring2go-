import { createDb } from "@raring2go/db";
import {
  approveTemplateVersion,
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
import type { MagazineTemplate, MagazineTemplateVersion, PublishingActorContext, PublishingData, TemplateSpecInput } from "@raring2go/publishing";
import type { PermissionData } from "@raring2go/permissions";
import { randomUUID } from "node:crypto";
import { editionAuditFor } from "./edition-output";
import { getPermissionData } from "./permission-source";

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
