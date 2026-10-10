import type { Route } from "next";
import { geometryOf } from "@raring2go/publishing";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readTemplateLibrary } from "../../../../../lib/edition-runtime";
import { formatCount, formatDate, formatLabel } from "../../../../../lib/format";
import { EmptyState, LinkButton, Notice, PageHeader, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { approveTemplateVersionAction, publishTemplateVersionAction } from "./actions";
import { ZonePreview } from "./zone-preview";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Template library" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const banners: Record<string, string> = {
  template_created: "Template created as a draft.",
  revision_created: "New draft version created.",
  version_approved: "Version approved. It can now be published.",
  version_published: "Version published. It can be assigned to edition pages and is now fixed: changes need a new version."
};

export default async function TemplateLibraryPage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const loaded = await load(request);
  if ("error" in loaded) return protectedOutcome(loaded.error, request);

  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const qs = query.size ? `?${query.toString()}` : "";

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Edition Factory", href: "/app/editions" as Route }, { label: "Template library" }]} />
      <PageHeader
        eyebrow="Edition Factory"
        title="Template library"
        intro="Covers and page layouts with the brand furniture locked and the zones local editors can fill. A published version never changes: to alter it, make a new version."
        actions={<LinkButton href={`/app/editions/templates/new${qs}` as Route}>New template</LinkButton>}
      />
      {resultCode && banners[resultCode] ? <Notice tone="success">{banners[resultCode]}</Notice> : null}
      {loaded.library.length === 0 ? (
        <Panel>
          <EmptyState
            title="No templates yet"
            action={<LinkButton href={`/app/editions/templates/new${qs}` as Route} variant="secondary">Create the first template</LinkButton>}
          >
            Templates you create appear here with every version and its approval state.
          </EmptyState>
        </Panel>
      ) : null}
      {loaded.library.map(({ template, versions, inUse }) => (
        <Panel
          key={template.id}
          eyebrow={formatLabel(template.category)}
          title={template.name}
          intro={`${template.key}${inUse ? " · In use on edition pages" : ""}`}
          actions={<LinkButton href={`/app/editions/templates/${template.id}/revise${qs}` as Route} variant="secondary">New version from latest</LinkButton>}
        >
          <RecordList>
            {versions.map(({ version, zones }) => {
              const geometry = geometryOf(version);
              return (
                <RecordCard
                  key={version.id}
                  title={`Version ${version.version}`}
                  status={version.status}
                  lines={[
                    `${formatCount(zones.length, "zone")}, ${formatCount(version.lockedElements.length, "locked element")}.`,
                    version.publishedAt ? `Published ${formatDate(version.publishedAt)}.` : version.approvedAt ? `Approved ${formatDate(version.approvedAt)}.` : "Not yet approved."
                  ]}
                >
                  <ZonePreview width={geometry.trimWidth} height={geometry.trimHeight} margins={geometry.margins} zones={zones} label={`${template.name} version ${version.version} layout`} />
                  {version.status === "draft" && loaded.can.approve ? (
                    <form action={approveTemplateVersionAction.bind(null, request, version.id)}>
                      <button type="submit" className="r2-button r2-button--secondary">Approve</button>
                    </form>
                  ) : null}
                  {version.status === "approved" && loaded.can.publish ? (
                    <form action={publishTemplateVersionAction.bind(null, request, version.id)}>
                      <button type="submit" className="r2-button r2-button--secondary">Publish</button>
                    </form>
                  ) : null}
                </RecordCard>
              );
            })}
          </RecordList>
        </Panel>
      ))}
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "edition.template", action: "edit" });
    const actor = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const can = { approve: await allowed(request, "approve"), publish: await allowed(request, "publish") };
    return { library: await readTemplateLibrary(actor), can };
  } catch (error) {
    return { error };
  }
}

async function allowed(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, action: "approve" | "publish") {
  try {
    await requireShellPermission(request, { module: "edition.template", action });
    return true;
  } catch (error) {
    if (error instanceof ShellAccessError) return false;
    throw error;
  }
}
