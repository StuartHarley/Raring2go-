import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../../../lib/app-shell";
import { readStudioPage } from "../../../../../../../lib/edition-runtime";
import { Breadcrumbs } from "../../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../../page";
import { applyFixesAction, approvePageAction, autosavePageAction, returnPageAction, runPreflightAction, saveAndSubmitAction, saveOnlyAction } from "./actions";
import { AutosaveForm } from "./autosave-form";
import { ImagePicker } from "./image-picker";
import { listStudioImages } from "../../../../../../../lib/studio-images";

const banners: Record<string, string> = {
  saved: "Saved.",
  submitted: "Submitted to HQ for review.",
  approved: "Page approved.",
  returned: "Page returned to the editor with your comment.",
  preflight_run: "Preflight run.",
  fixes_applied: "Safe fixes applied to a derived copy. Your original content is unchanged.",
  save_refused: "That could not be saved. The edition may be approved, the page locked, or an image link invalid.",
  submit_refused: "That could not be submitted. Fix the warnings shown below first.",
  approve_refused: "Only a page awaiting HQ review can be approved.",
  return_refused: "Say what needs to change, and the page must be awaiting HQ review.",
  preflight_refused: "Preflight could not run: the page needs a template.",
  fix_refused: "Those fixes could not be applied."
};

export default async function PageStudio({ params, searchParams }: { params: Promise<{ id: string; pageId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const { id, pageId } = await params;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  const can = { edit: false, approve: false, preflight: false };
  let studio;
  let library: Awaited<ReturnType<typeof listStudioImages>> = [];
  try {
    const shell = await requireShellPermission(request, { module: "edition", action: "view" });
    studio = await readStudioPage({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, id, pageId);
    const check = (module: string, action: string) => requireShellPermission(request, { module, action }).then(() => true, () => false);
    can.edit = await check("edition.content", "edit_local");
    can.approve = await check("edition", "approve");
    can.preflight = await check("edition.preflight", "override");
    library = await listStudioImages({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, id).catch(() => []);
  } catch (error) {
    if (error instanceof ShellAccessError) {
      return <main className={`app-outcome app-outcome-${error.kind}`}><section><h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1><p>{error.message}</p></section></main>;
    }
    return <main className="app-outcome"><section><h1>Page not found</h1><p>It does not exist or is outside your territory.</p></section></main>;
  }
  const { page, layout, edition, preflight } = studio;
  const frozen = ["approved", "published"].includes(edition.status) || page.locked;
  const editable = can.edit && !frozen && layout !== null;
  const message = code ? banners[code] : undefined;
  const isError = Boolean(code?.endsWith("_refused"));
  const bound = {
    autosave: autosavePageAction.bind(null, request, id, pageId),
    save: saveOnlyAction.bind(null, request, id, pageId),
    submit: saveAndSubmitAction.bind(null, request, id, pageId)
  };
  const uploadParams = new URLSearchParams();
  if (request.sessionKey) uploadParams.set("session", request.sessionKey);
  if (request.organisationId) uploadParams.set("organisationId", request.organisationId);
  if (request.territoryId) uploadParams.set("territoryId", request.territoryId);
  const uploadQuery = uploadParams.size ? `?${uploadParams.toString()}` : "";
  const link = (target: string | null) => (target ? (`/app/editions/${id}/pages/${target}` as Route) : null);
  const previous = link(studio.neighbours.previous);
  const next = link(studio.neighbours.next);

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Edition Factory", href: "/app/editions" }, { label: edition.title, href: `/app/editions/${id}` as Route }, { label: "Flatplan", href: `/app/editions/${id}/flatplan` as Route }, { label: `Page ${page.pageNumber}` }]} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Page studio</p>
        <h2>Page {page.pageNumber}: {layout?.title ?? "No content yet"}</h2>
        <p>Status: {page.status.replaceAll("_", " ")} - readiness: {page.readiness}{page.locked ? " - locked" : ""}{frozen && !page.locked ? ` - the edition is ${edition.status}` : ""}. {studio.revisionCount} saved revision(s).</p>
        {message ? <p role={isError ? "alert" : "status"}>{message}</p> : null}
        {previous || next ? <p>{previous ? <Link href={previous}>Previous page</Link> : null}{previous && next ? " - " : ""}{next ? <Link href={next}>Next page</Link> : null}</p> : null}
        {page.comments.length > 0 ? (
          <div className="franchise-list" aria-label="Comments">
            {page.comments.map((comment, index) => (<div key={index}><strong>{String(comment.kind ?? "comment")}</strong><span>{String(comment.text ?? "")}</span><span className="muted">{String(comment.at ?? "")}</span></div>))}
          </div>
        ) : null}
        {layout && layout.issues.length > 0 ? (
          <div role="alert">
            <strong>{layout.issues.length} thing(s) to fix before this page can be submitted</strong>
            <ul>{layout.issues.map((issue, index) => (<li key={index}>{issue.zoneId}: {issue.message}</li>))}</ul>
          </div>
        ) : null}
      </section>

      {layout === null ? (
        <section className="app-panel franchise-panel"><p>This page has no template yet. <Link href={`/app/editions/${id}/flatplan` as Route}>Assign one in the flatplan.</Link></p></section>
      ) : (
        <section className="app-panel franchise-panel" aria-label="Page content">
          <AutosaveForm autosave={bound.autosave} disabled={!editable}>
            {layout.zones.map((zone) => {
              const limit = [zone.maxCharacters ? `up to ${zone.maxCharacters} characters` : "", zone.maxWords ? `up to ${zone.maxWords} words` : "", zone.maxItems ? `up to ${zone.maxItems} items` : ""].filter(Boolean).join(", ");
              if (zone.kind === "advertiser") return <p key={zone.id} className="muted">{zone.id}: advertiser slot, filled from the booking.</p>;
              if (zone.kind === "image") {
                return (
                  <fieldset key={zone.id} disabled={!editable}>
                    <legend>{zone.id} (image{zone.minDpi ? `, at least ${zone.minDpi}dpi` : ""})</legend>
                    <ImagePicker zoneId={zone.id} editionId={id} query={uploadQuery} options={library} selected={zone.image?.fileId ?? ""} zoneWidthMm={zone.width} minDpi={zone.minDpi} disabled={!editable} />
                    <label>Description for screen readers<input name={`alt-${zone.id}`} defaultValue={zone.image?.alt ?? ""} maxLength={300} /></label>
                    <details>
                      <summary>Use a link instead of an upload</summary>
                      <label>Image link (https)<input name={`image-${zone.id}`} defaultValue={zone.image && !zone.image.fileId ? zone.image.url : ""} inputMode="url" /></label>
                      <label>Pixel width<input name={`widthPx-${zone.id}`} defaultValue={zone.image && !zone.image.fileId ? zone.image.widthPx ?? "" : ""} inputMode="numeric" /></label>
                      <label>Pixel height<input name={`heightPx-${zone.id}`} defaultValue={zone.image && !zone.image.fileId ? zone.image.heightPx ?? "" : ""} inputMode="numeric" /></label>
                    </details>
                  </fieldset>
                );
              }
              const value = zone.kind === "list" ? (zone.items ?? []).join("\n") : zone.text ?? "";
              return (
                <label key={zone.id}>
                  {zone.id} ({zone.kind}{limit ? `, ${limit}` : ""})
                  {zone.kind === "headline" ? <input name={`zone-${zone.id}`} defaultValue={value} disabled={!editable} /> : <textarea name={`zone-${zone.id}`} defaultValue={value} rows={zone.kind === "list" ? 4 : 8} disabled={!editable} />}
                </label>
              );
            })}
            {editable ? (
              <>
                <button type="submit" formAction={bound.save}>Save</button>
                <button type="submit" formAction={bound.submit}>Save and submit for review</button>
              </>
            ) : null}
          </AutosaveForm>
        </section>
      )}

      {page.status === "awaiting_hq" && can.approve ? (
        <section className="app-panel franchise-panel" aria-label="HQ review">
          <h2>HQ review</h2>
          <form action={approvePageAction.bind(null, request, id, pageId)}><button type="submit">Approve page</button></form>
          <form action={returnPageAction.bind(null, request, id, pageId)}>
            <label>What needs to change<textarea name="comment" required maxLength={1000} rows={3} /></label>
            <button type="submit">Return for changes</button>
          </form>
        </section>
      ) : null}

      <section className="app-panel franchise-panel" aria-label="Preflight">
        <h2>Print preflight</h2>
        {preflight ? (
          <>
            <p>Latest result: <strong>{preflight.status}</strong></p>
            <ul>{preflight.checks.map((check) => (<li key={check.code}>{check.severity}: {check.message}{check.fixable ? " (safe fix available)" : ""}</li>))}</ul>
            {preflight.fixes.length > 0 ? <p>Fixes applied: {preflight.fixes.map((fix) => fix.action).join(", ")}</p> : null}
            {can.preflight && preflight.checks.some((check) => check.fixable) && preflight.fixes.length === 0 ? (
              <form action={applyFixesAction.bind(null, request, id, pageId, preflight.id)}><button type="submit">Apply safe fixes</button></form>
            ) : null}
            {preflight.unfixable.length > 0 ? <p>These cannot be fixed automatically and need a better source image or layout change. The page is not print-ready until they are resolved.</p> : null}
          </>
        ) : <p>No preflight has been run on this page.</p>}
        {can.preflight && layout ? <form action={runPreflightAction.bind(null, request, id, pageId)}><button type="submit">Run preflight</button></form> : null}
      </section>
    </AppShell>
  );
}
