import type { Route } from "next";
import { requireShellPermission } from "../../../../../../lib/app-shell";
import { templateSpecErrorText } from "@raring2go/publishing";
import { Notice, PageHeader, Panel } from "../../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { createTemplateAction } from "../actions";
import { TemplateForm } from "../template-form";
import { protectedOutcome } from "../../../../../../lib/protected-outcome";

export const metadata = { title: "New template" };

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  try {
    await requireShellPermission(request, { module: "edition.template", action: "create" });
  } catch (error) {
    return protectedOutcome(error);
  }
  const message = code ? (templateSpecErrorText as Record<string, string>)[code] : undefined;
  return (
    <>
      <Breadcrumbs items={[{ label: "Edition Factory", href: "/app/editions" as Route }, { label: "Template library", href: "/app/editions/templates" as Route }, { label: "New template" }]} />
      <PageHeader
        eyebrow="Template library"
        title="New template"
        intro="Set the page geometry, lock the brand furniture and mark the zones local editors can fill. It is saved as a draft to approve and publish later."
      />
      <Panel>
        {message ? <Notice tone="error">{message}</Notice> : null}
        <TemplateForm action={createTemplateAction.bind(null, request)} withIdentity submitLabel="Create draft" />
      </Panel>
    </>
  );
}
