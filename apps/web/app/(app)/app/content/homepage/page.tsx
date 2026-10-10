import Link from "next/link";
import type { Route } from "next";
import { HomepageTemplateError, homepageErrorText, homepageItemBounds, homepageKindLabels, homepageSlotKinds } from "@raring2go/public";
import type { PublicHomepageSlot } from "@raring2go/public";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readHomepageTemplates } from "../../../../../lib/homepage-template-runtime";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { discardDraftAction, publishDraftAction, saveDraftAction, startFromVersionAction } from "./actions";

const banners: Record<string, string> = {
  draft_saved: "Draft saved. It is not live until you publish it.",
  published: "Published. The new layout is live on every territory homepage.",
  discarded: "Draft discarded."
};

const sourceLabels: Record<PublicHomepageSlot["source"], string> = { local_then_network: "Local first, then network", local_only: "Local only", network: "Network only" };

export default async function HomepageTemplatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  let data;
  try {
    const shell = await requireShellPermission(request, { module: "public.homepage", action: "manage" });
    data = await readHomepageTemplates({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
  } catch (error) {
    if (error instanceof ShellAccessError) {
      return <main className={`app-outcome app-outcome-${error.kind}`}><section><h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1><p>{error.message}</p></section></main>;
    }
    throw error;
  }
  const working = data.draft?.slots ?? data.live?.slots ?? data.defaults;
  const message = code ? banners[code] ?? (homepageErrorText as Record<string, string>)[code] : undefined;
  const isError = Boolean(code && !banners[code]);
  const kinds: string[] = [...homepageSlotKinds];
  type Row = { kind: keyof typeof homepageKindLabels; heading: string; visible: boolean; itemCount: number; source: PublicHomepageSlot["source"] };
  const ordered: Row[] = [
    ...(working.filter((slot) => kinds.includes(slot.kind)) as Row[]),
    ...kinds.filter((kind) => !working.some((slot) => slot.kind === kind)).map((kind) => ({ kind: kind as Row["kind"], heading: homepageKindLabels[kind as Row["kind"]], visible: false, itemCount: homepageItemBounds[kind as Row["kind"]].min, source: "local_then_network" as const }))
  ];

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Content Studio", href: "/app/content" as Route }, { label: "Website homepage" }]} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Public website</p>
        <h2>Territory homepage layout</h2>
        <p>Choose which sections every territory homepage shows, in what order, with what heading and how many items. The top banner and the newsletter sign-up always stay. Offers, competitions and local businesses always carry their &quot;Sponsored&quot; label. Changes go live only when you publish, and a published layout is kept as history and never edited: a change is a new version.</p>
        {message ? <p role={isError ? "alert" : "status"}>{message}</p> : null}
        <p>
          Live now: {data.live ? `version ${data.live.version}, published ${data.live.publishedAt?.toISOString().slice(0, 10)}` : "the built-in default layout"}.
          {data.draft ? ` A draft (version ${data.draft.version}) is waiting.` : ""}
        </p>
      </section>

      <section className="app-panel franchise-panel" aria-label="Layout editor">
        <h2>{data.draft ? `Editing draft version ${data.draft.version}` : "Start a new draft"}</h2>
        <form action={saveDraftAction.bind(null, request, kinds)} className="franchise-form">
          <table>
            <thead><tr><th>Order</th><th>Section</th><th>Show</th><th>Heading</th><th>Items</th><th>Content from</th></tr></thead>
            <tbody>
              {ordered.map((slot, index) => {
                const bounds = homepageItemBounds[slot.kind];
                const fixed = bounds.min === bounds.max;
                const required = slot.kind === "hero" || slot.kind === "newsletter";
                return (
                  <tr key={slot.kind}>
                    <td><input name={`pos-${slot.kind}`} type="number" min={1} max={kinds.length} defaultValue={index + 1} aria-label={`${homepageKindLabels[slot.kind]} position`} size={2} /></td>
                    <td>{homepageKindLabels[slot.kind]}{["offers", "competitions", "advertisers"].includes(slot.kind) ? " (sponsored)" : ""}</td>
                    <td><input type="checkbox" name={`show-${slot.kind}`} defaultChecked={slot.visible || required} disabled={required} aria-label={`Show ${slot.kind}`} />{required ? <input type="hidden" name={`show-${slot.kind}`} value="on" /> : null}</td>
                    <td><input name={`heading-${slot.kind}`} defaultValue={slot.heading} maxLength={80} required aria-label={`${slot.kind} heading`} /></td>
                    <td>{fixed ? <><input type="hidden" name={`count-${slot.kind}`} value={bounds.min} />{bounds.min}</> : <input name={`count-${slot.kind}`} type="number" min={bounds.min} max={bounds.max} defaultValue={slot.itemCount} aria-label={`${slot.kind} item count`} size={3} />}</td>
                    <td>
                      <select name={`source-${slot.kind}`} defaultValue={slot.source} aria-label={`${slot.kind} content source`}>
                        {(Object.keys(sourceLabels) as Array<PublicHomepageSlot["source"]>).map((source) => (<option key={source} value={source}>{sourceLabels[source]}</option>))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <label>Note for the record (optional)<input name="notes" maxLength={500} defaultValue={data.draft?.notes ?? ""} /></label>
          <button type="submit">Save draft</button>
        </form>
        {data.draft ? (
          <>
            <form action={publishDraftAction.bind(null, request, data.draft.id)}><button type="submit">Publish this draft to every territory</button></form>
            <form action={discardDraftAction.bind(null, request, data.draft.id)}><button type="submit">Discard draft</button></form>
          </>
        ) : null}
      </section>

      {data.live || data.history.length > 0 ? (
        <section className="app-panel franchise-panel" aria-label="History">
          <h2>History</h2>
          <div className="franchise-list">
            {[...(data.live ? [data.live] : []), ...data.history].map((version) => (
              <div key={version.id}>
                <strong>Version {version.version} - {version.status}</strong>
                <span>{version.slots.filter((slot) => slot.visible).map((slot) => slot.heading).join(" / ")}</span>
                {version.notes ? <span className="muted">{version.notes}</span> : null}
                {!data.draft ? <form action={startFromVersionAction.bind(null, request, version.id)}><button type="submit">Start a draft from this</button></form> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <p><Link href={"/app/content" as Route}>Back to Content Studio</Link></p>
    </AppShell>
  );
}
