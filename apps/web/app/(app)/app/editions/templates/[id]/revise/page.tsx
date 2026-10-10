import type { Route } from "next";
import { requireShellPermission } from "../../../../../../../lib/app-shell";
import { templateSpecErrorText } from "@raring2go/publishing";
import { readTemplateForm } from "../../../../../../../lib/edition-runtime";
import { formatLabel } from "../../../../../../../lib/format";
import { Notice, PageHeader, Panel } from "../../../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../../page";
import { reviseTemplateAction } from "../../actions";
import { TemplateForm } from "../../template-form";
import { protectedOutcome } from "../../../../../../../lib/protected-outcome";

export const metadata = { title: "New template version" };

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
    return protectedOutcome(error, request);
  }
  const message = code ? (templateSpecErrorText as Record<string, string>)[code] : undefined;
  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Edition Factory", href: "/app/editions" as Route }, { label: "Template library", href: "/app/editions/templates" as Route }, { label: `${loaded.template.name}: new version` }]} />
      <PageHeader
        eyebrow="Template library"
        title={`${loaded.template.name}: version ${loaded.latest.version + 1}`}
        intro={`Starts from version ${loaded.latest.version} (${formatLabel(loaded.latest.status).toLowerCase()}). Saving creates a new draft; existing versions are not changed.`}
      />
      <Panel>
        {message ? <Notice tone="error">{message}</Notice> : null}
        <TemplateForm action={reviseTemplateAction.bind(null, request, id)} initial={loaded.form} withIdentity={false} submitLabel="Create new draft version" />
      </Panel>
    </AppShell>
  );
}
