import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../../lib/app-shell";
import { templateSpecErrorText } from "@raring2go/publishing";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { createTemplateAction } from "../actions";
import { TemplateForm } from "../template-form";

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  try {
    await requireShellPermission(request, { module: "edition.template", action: "create" });
  } catch (error) {
    if (error instanceof ShellAccessError) return <main className={`app-outcome app-outcome-${error.kind}`}><section><h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1><p>{error.message}</p></section></main>;
    throw error;
  }
  const message = code ? (templateSpecErrorText as Record<string, string>)[code] : undefined;
  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Edition Factory", href: "/app/editions" }, { label: "Template library", href: "/app/editions/templates" as Route }, { label: "New template" }]} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Template library</p>
        <h2>New template</h2>
        {message ? <p role="alert">{message}</p> : null}
        <TemplateForm action={createTemplateAction.bind(null, request)} withIdentity submitLabel="Create draft" />
      </section>
    </AppShell>
  );
}
