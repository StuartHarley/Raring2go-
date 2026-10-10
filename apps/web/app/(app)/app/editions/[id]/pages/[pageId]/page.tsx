import type { Route } from "next";
import { requireShellPermission } from "../../../../../../../lib/app-shell";
import { readStudioPage } from "../../../../../../../lib/edition-runtime";
import { formatCount, formatDateTime, formatLabel, formatLabels } from "../../../../../../../lib/format";
import { Actions, EmptyState, FactList, LinkButton, Notice, PageHeader, Panel, RecordCard, RecordList, StatusBadge } from "../../../../../../../lib/page-ui";
import { recordOutcome } from "../../../../../../../lib/protected-outcome";
import { Breadcrumbs } from "../../../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../../../page";
import { applyFixesAction, approvePageAction, autosavePageAction, returnPageAction, runPreflightAction, saveAndSubmitAction, saveOnlyAction } from "./actions";
import { AutosaveForm } from "./autosave-form";
import { ImagePicker } from "./image-picker";
import { listStudioImages } from "../../../../../../../lib/studio-images";

export const metadata = { title: "Page studio" };

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
  const result = await loadStudio(request, id, pageId);

  if ("error" in result) {
    return recordOutcome(result.error);
  }

  const { studio, library, can } = result;
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
  const flatplanHref = `/app/editions/${id}/flatplan` as Route;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Edition Factory", href: "/app/editions" as Route },
          { label: edition.title, href: `/app/editions/${id}` as Route },
          { label: "Flatplan", href: flatplanHref },
          { label: `Page ${page.pageNumber}` }
        ]}
      />
      <PageHeader
        eyebrow="Page studio"
        title={`Page ${page.pageNumber}: ${layout?.title ?? "No content yet"}`}
        intro={
          page.locked
            ? "This page is locked by Head Office: it can be read here but not changed from a territory."
            : frozen
              ? `The edition is ${formatLabel(edition.status).toLowerCase()}, so this page is read-only until it is reopened.`
              : "Fill each zone of the template, save as you go, and submit the page to HQ when it is ready."
        }
        actions={
          previous || next ? (
            <>
              {previous ? (
                <LinkButton href={previous} variant="secondary">
                  Previous page
                </LinkButton>
              ) : null}
              {next ? (
                <LinkButton href={next} variant="secondary">
                  Next page
                </LinkButton>
              ) : null}
            </>
          ) : undefined
        }
      >
        <FactList
          items={[
            { label: "Status", value: <StatusBadge status={page.status} /> },
            { label: "Readiness", value: <StatusBadge status={page.readiness} /> },
            { label: "Edition", value: <StatusBadge status={edition.status} /> },
            { label: "Locked", value: page.locked ? "Yes" : "No" },
            { label: "Saved revisions", value: formatCount(studio.revisionCount, "revision") }
          ]}
        />
      </PageHeader>

      {message ? <Notice tone={isError ? "error" : "success"}>{message}</Notice> : null}

      {page.comments.length > 0 ? (
        <Panel eyebrow="Review" title="Comments on this page">
          <RecordList>
            {page.comments.map((comment, index) => (
              <RecordCard key={index} title={formatLabel(String(comment.kind ?? "comment"))} lines={[String(comment.text ?? ""), formatDateTime(comment.at ? String(comment.at) : null, "")]} />
            ))}
          </RecordList>
        </Panel>
      ) : null}

      {layout === null ? (
        <Panel eyebrow="Content" title="Page content">
          <EmptyState
            title="This page has no template yet"
            action={
              <LinkButton href={flatplanHref} variant="primary">
                Assign one in the flatplan
              </LinkButton>
            }
          >
            Pick a published template for this page before writing its content.
          </EmptyState>
        </Panel>
      ) : (
        <Panel eyebrow="Content" title="Page content" intro="Each zone comes from the template. Limits are shown next to the zone name.">
          {layout.issues.length > 0 ? (
            <div role="alert" className="notice notice--warning">
              <strong>{formatCount(layout.issues.length, "thing")} to fix before this page can be submitted</strong>
              <ul>
                {layout.issues.map((issue, index) => (
                  <li key={index}>
                    {issue.zoneId}: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <AutosaveForm autosave={bound.autosave} disabled={!editable}>
            {layout.zones.map((zone) => {
              const limit = [zone.maxCharacters ? `up to ${zone.maxCharacters} characters` : "", zone.maxWords ? `up to ${zone.maxWords} words` : "", zone.maxItems ? `up to ${zone.maxItems} items` : ""].filter(Boolean).join(", ");
              if (zone.kind === "advertiser") {
                return (
                  <p key={zone.id} className="muted">
                    {zone.id}: advertiser slot, filled from the booking.
                  </p>
                );
              }
              if (zone.kind === "image") {
                return (
                  <fieldset key={zone.id} disabled={!editable}>
                    <legend>
                      {zone.id} (image{zone.minDpi ? `, at least ${zone.minDpi}dpi` : ""})
                    </legend>
                    <ImagePicker zoneId={zone.id} editionId={id} query={uploadQuery} options={library} selected={zone.image?.fileId ?? ""} zoneWidthMm={zone.width} minDpi={zone.minDpi} disabled={!editable} />
                    <label>
                      Description for screen readers
                      <input name={`alt-${zone.id}`} defaultValue={zone.image?.alt ?? ""} maxLength={300} />
                    </label>
                    <details>
                      <summary>Use a link instead of an upload</summary>
                      <label>
                        Image link (https)
                        <input name={`image-${zone.id}`} defaultValue={zone.image && !zone.image.fileId ? zone.image.url : ""} inputMode="url" />
                      </label>
                      <label>
                        Pixel width
                        <input name={`widthPx-${zone.id}`} defaultValue={zone.image && !zone.image.fileId ? zone.image.widthPx ?? "" : ""} inputMode="numeric" />
                      </label>
                      <label>
                        Pixel height
                        <input name={`heightPx-${zone.id}`} defaultValue={zone.image && !zone.image.fileId ? zone.image.heightPx ?? "" : ""} inputMode="numeric" />
                      </label>
                    </details>
                  </fieldset>
                );
              }
              const value = zone.kind === "list" ? (zone.items ?? []).join("\n") : zone.text ?? "";
              return (
                <label key={zone.id}>
                  {zone.id} ({formatLabel(zone.kind).toLowerCase()}
                  {limit ? `, ${limit}` : ""})
                  {zone.kind === "headline" ? (
                    <input name={`zone-${zone.id}`} defaultValue={value} disabled={!editable} />
                  ) : (
                    <textarea name={`zone-${zone.id}`} defaultValue={value} rows={zone.kind === "list" ? 4 : 8} disabled={!editable} />
                  )}
                </label>
              );
            })}
            {editable ? (
              <Actions>
                <button type="submit" className="r2-button r2-button--primary" formAction={bound.submit}>
                  Save and submit for review
                </button>
                <button type="submit" className="r2-button r2-button--secondary" formAction={bound.save}>
                  Save
                </button>
              </Actions>
            ) : null}
          </AutosaveForm>
        </Panel>
      )}

      {page.status === "awaiting_hq" && can.approve ? (
        <Panel eyebrow="HQ review" title="Approve or return this page" intro="Approving marks the page ready for the edition; returning sends it back to the editor with your comment.">
          <form action={approvePageAction.bind(null, request, id, pageId)}>
            <button type="submit" className="r2-button r2-button--primary">
              Approve page
            </button>
          </form>
          <form action={returnPageAction.bind(null, request, id, pageId)} className="franchise-form">
            <label>
              What needs to change
              <textarea name="comment" required maxLength={1000} rows={3} />
            </label>
            <button type="submit" className="r2-button r2-button--secondary">
              Return for changes
            </button>
          </form>
        </Panel>
      ) : null}

      <Panel eyebrow="Preflight" title="Print preflight" intro="The print checks for this page. A page is not print-ready until every unfixable finding is resolved.">
        {preflight ? (
          <>
            <p>
              Latest result: <StatusBadge status={preflight.status} />
            </p>
            {preflight.checks.length > 0 ? (
              <ul>
                {preflight.checks.map((check) => (
                  <li key={check.code}>
                    {formatLabel(check.severity)}: {check.message}
                    {check.fixable ? " (safe fix available)" : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            {preflight.fixes.length > 0 ? <p>Fixes applied: {formatLabels(preflight.fixes.map((fix) => fix.action))}.</p> : null}
            {preflight.unfixable.length > 0 ? (
              <Notice tone="warning">These cannot be fixed automatically and need a better source image or layout change. The page is not print-ready until they are resolved.</Notice>
            ) : null}
          </>
        ) : (
          <EmptyState title="No preflight has been run on this page">Run one once the page has a template and its content is in place.</EmptyState>
        )}
        <Actions>
          {preflight && can.preflight && preflight.checks.some((check) => check.fixable) && preflight.fixes.length === 0 ? (
            <form action={applyFixesAction.bind(null, request, id, pageId, preflight.id)}>
              <button type="submit" className="r2-button r2-button--primary">
                Apply safe fixes
              </button>
            </form>
          ) : null}
          {can.preflight && layout ? (
            <form action={runPreflightAction.bind(null, request, id, pageId)}>
              <button type="submit" className="r2-button r2-button--secondary">
                Run preflight
              </button>
            </form>
          ) : null}
        </Actions>
      </Panel>
    </>
  );
}

async function loadStudio(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, editionId: string, pageId: string) {
  try {
    const shell = await requireShellPermission(request, { module: "edition", action: "view" });
    const actor = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const studio = await readStudioPage(actor, editionId, pageId);
    const check = (module: string, action: string) => requireShellPermission(request, { module, action }).then(() => true, () => false);
    const can = {
      edit: await check("edition.content", "edit_local"),
      approve: await check("edition", "approve"),
      preflight: await check("edition.preflight", "override")
    };
    const library = await listStudioImages(actor, editionId).catch(() => [] as Awaited<ReturnType<typeof listStudioImages>>);
    return { studio, library, can };
  } catch (error) {
    return { error };
  }
}
