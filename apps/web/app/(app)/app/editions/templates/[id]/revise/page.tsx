import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../../../lib/app-shell";
import { templateSpecErrorText } from "@raring2go/publishing";
import { readTemplateForm } from "../../../../../../../lib/edition-runtime";
import { Breadcrumbs } from "../../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../../page";
import { reviseTemplateAction } from "../../actions";
import { TemplateForm } from "../../template-form";

export default async function ReviseTemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const { id } = await params;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  let loaded;
  try {
    const shell = await requireShellPermission(request, { module: "edition.template", action: "edit" });
    loaded = await readTemplateForm({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, id);
  } catch (error) {
    if (error instanceof ShellAccessError) return <main className={`app-outcome app-outcome-${error.kind}`}><section><h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1><p>{error.message}</p></section></main>;
    throw error;
  }
  const message = code ? (templateSpecErrorText as Record<string, string>)[code] : undefined;
  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Edition Factory", href: "/app/editions" }, { label: "Template library", href: "/app/editions/templates" as Route }, { label: `${loaded.template.name}: new version` }]} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Template library</p>
        <h2>{loaded.template.name}: version {loaded.latest.version + 1}</h2>
        <p>Starts from version {loaded.latest.version} ({loaded.latest.status}). Saving creates a new draft; existing versions are not changed.</p>
        {message ? <p role="alert">{message}</p> : null}
        <TemplateForm action={reviseTemplateAction.bind(null, request, id)} initial={loaded.form} withIdentity={false} submitLabel="Create new draft version" />
      </section>
    </AppShell>
  );
}
