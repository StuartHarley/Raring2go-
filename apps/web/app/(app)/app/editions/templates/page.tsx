import Link from "next/link";
import type { Route } from "next";
import { geometryOf } from "@raring2go/publishing";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readTemplateLibrary } from "../../../../../lib/edition-runtime";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { approveTemplateVersionAction, publishTemplateVersionAction } from "./actions";
import { ZonePreview } from "./zone-preview";

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
  if ("error" in loaded) return protectedOutcome(loaded.error);

  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const qs = query.size ? `?${query.toString()}` : "";

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Publishing", href: "/app/editions" }, { label: "Edition Factory", href: "/app/editions" }, { label: "Template library" }]} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Template library</p>
        <h2>Magazine templates</h2>
        <p>Covers and layouts with brand furniture locked and editable zones local editors can fill. A published version never changes: to alter it, make a new version.</p>
        {resultCode && banners[resultCode] ? <p role="status">{banners[resultCode]}</p> : null}
        <p><Link href={`/app/editions/templates/new${qs}` as Route}>New template</Link></p>
        {loaded.library.length === 0 ? <p>No templates yet.</p> : null}
      </section>
      {loaded.library.map(({ template, versions, inUse }) => (
        <section key={template.id} className="app-panel franchise-panel" aria-label={template.name}>
          <p className="eyebrow">{template.category.replaceAll("_", " ")}</p>
          <h2>{template.name}</h2>
          <p className="muted">{template.key}{inUse ? " - in use on edition pages" : ""}</p>
          <p><Link href={`/app/editions/templates/${template.id}/revise${qs}` as Route}>New version from latest</Link></p>
          <div className="franchise-list">
            {versions.map(({ version, zones }) => {
              const geometry = geometryOf(version);
              return (
                <div key={version.id}>
                  <strong>Version {version.version} - {version.status}</strong>
                  <span>{zones.length} zone(s), {version.lockedElements.length} locked element(s). {version.publishedAt ? `Published ${version.publishedAt}.` : version.approvedAt ? `Approved ${version.approvedAt}.` : "Not yet approved."}</span>
                  <ZonePreview width={geometry.trimWidth} height={geometry.trimHeight} margins={geometry.margins} zones={zones} label={`${template.name} version ${version.version} layout`} />
                  {version.status === "draft" && loaded.can.approve ? (
                    <form action={approveTemplateVersionAction.bind(null, request, version.id)}><button type="submit">Approve</button></form>
                  ) : null}
                  {version.status === "approved" && loaded.can.publish ? (
                    <form action={publishTemplateVersionAction.bind(null, request, version.id)}><button type="submit">Publish</button></form>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
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

function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return (
      <main className={`app-outcome app-outcome-${error.kind}`}>
        <section>
          <p className="eyebrow">{error.kind.replace("_", " ")}</p>
          <h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1>
          <p>{error.message}</p>
        </section>
      </main>
    );
  }
  throw error;
}
