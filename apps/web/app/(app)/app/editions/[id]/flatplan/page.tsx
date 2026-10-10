import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../../lib/app-shell";
import { readFlatplan } from "../../../../../../lib/edition-runtime";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { assignPageAction, createContentAction, movePageAction } from "./actions";

const banners: Record<string, string> = {
  page_saved: "Page saved.",
  page_moved: "Page moved.",
  content_created: "Content added to this edition. Assign it to a page below.",
  page_refused: "That page could not be changed. It may be locked, or the template or content is not available for this edition.",
  move_refused: "That page cannot move there. Locked pages stay where they are.",
  content_refused: "That content could not be added. Give it a title and a type."
};

export default async function FlatplanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const { id } = await params;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  let plan;
  let canEdit = false;
  let canAddContent = false;
  try {
    const shell = await requireShellPermission(request, { module: "edition", action: "view" });
    plan = await readFlatplan({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, id);
    canEdit = await requireShellPermission(request, { module: "edition.page", action: "edit" }).then(() => true, () => false);
    canAddContent = await requireShellPermission(request, { module: "edition.content", action: "edit_local" }).then(() => true, () => false);
  } catch (error) {
    if (error instanceof ShellAccessError) {
      return <main className={`app-outcome app-outcome-${error.kind}`}><section><h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1><p>{error.message}</p></section></main>;
    }
    return <main className="app-outcome"><section><h1>Edition not found</h1><p>It does not exist or is outside your territory.</p></section></main>;
  }
  const message = code ? banners[code] : undefined;
  const isError = Boolean(code?.endsWith("_refused"));
  const frozen = ["published", "approved"].includes(plan.edition.status);

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Edition Factory", href: "/app/editions" }, { label: plan.edition.title, href: `/app/editions/${id}` as Route }, { label: "Flatplan" }]} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Flatplan</p>
        <h2>{plan.edition.title}</h2>
        <p>Assign a published template and content to each page, and put the pages in order. Locked pages (such as the cover) cannot be moved or changed from a territory. {frozen ? `The edition is ${plan.edition.status}: reopen it from the edition page to change pages.` : ""}</p>
        {message ? <p role={isError ? "alert" : "status"}>{message}</p> : null}
        {plan.pages.length === 0 ? <p>No flatplan yet. Create it from the edition page.</p> : null}
      </section>
      {plan.pages.length > 0 ? (
        <section className="app-panel franchise-panel" aria-label="Pages">
          <div className="franchise-list">
            {plan.pages.map(({ page, templateName, contentTitle }, index) => (
              <div key={page.id} id={`page-${page.id}`}>
                <strong><Link href={`/app/editions/${id}/pages/${page.id}` as Route}>Page {page.pageNumber}</Link> <span className="muted">({page.side}, {page.status.replaceAll("_", " ")}{page.locked ? ", locked" : ""})</span></strong>
                <span>{templateName ?? "No template"} - {contentTitle ?? "No content"}</span>
                {canEdit && !frozen && !page.locked ? (
                  <>
                    <form action={assignPageAction.bind(null, request, id, page.id)}>
                      <label>Template
                        <select name="templateVersionId" defaultValue={page.templateVersionId ?? ""}>
                          <option value="">Keep current</option>
                          {plan.templates.map((template) => (<option key={template.id} value={template.id}>{template.label}</option>))}
                        </select>
                      </label>
                      <label>Content
                        <select name="assignedContentId" defaultValue={page.assignedContentId ?? ""}>
                          <option value="">Keep current</option>
                          {plan.content.map((entry) => (<option key={entry.id} value={entry.id}>{entry.title}{entry.usedOnPage && entry.usedOnPage !== page.pageNumber ? ` (on page ${entry.usedOnPage})` : ""}</option>))}
                        </select>
                      </label>
                      <button type="submit">Save page {page.pageNumber}</button>
                    </form>
                    <form action={movePageAction.bind(null, request, id, page.id, "up")}><button type="submit" disabled={index === 0}>Move up</button></form>
                    <form action={movePageAction.bind(null, request, id, page.id, "down")}><button type="submit" disabled={index === plan.pages.length - 1}>Move down</button></form>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section id="content" className="app-panel franchise-panel" aria-label="Edition content">
        <p className="eyebrow">Content</p>
        <h2>Content in this edition ({plan.content.length})</h2>
        <div className="franchise-list">
          {plan.content.map((entry) => (
            <div key={entry.id}>
              <strong>{entry.title}</strong>
              <span>{entry.state}{entry.locked ? " - locked" : ""}{entry.usedOnPage ? ` - page ${entry.usedOnPage}` : " - not placed"}</span>
            </div>
          ))}
        </div>
        {canAddContent && !frozen ? (
          <form action={createContentAction.bind(null, request, id)} className="franchise-form">
            <h3>Add local content</h3>
            <label>Title<input name="title" required maxLength={200} /></label>
            <label>Type
              <select name="contentType" defaultValue="article">
                {["article", "event", "offer", "competition", "advertorial", "house_page"].map((type) => (<option key={type} value={type}>{type.replaceAll("_", " ")}</option>))}
              </select>
            </label>
            <label>Headline<input name="headline" maxLength={300} /></label>
            <label>Body<textarea name="body" rows={5} maxLength={20000} /></label>
            <button type="submit">Add content</button>
          </form>
        ) : null}
        <p><Link href={`/app/editions/${id}` as Route}>Back to the edition</Link></p>
      </section>
    </AppShell>
  );
}
