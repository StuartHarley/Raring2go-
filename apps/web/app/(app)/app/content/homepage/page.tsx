import type { Route } from "next";
import { homepageErrorText, homepageItemBounds, homepageKindLabels, homepageSlotKinds } from "@raring2go/public";
import type { PublicHomepageSlot } from "@raring2go/public";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readHomepageTemplates } from "../../../../../lib/homepage-template-runtime";
import { formatDate } from "../../../../../lib/format";
import { Actions, LinkButton, Notice, PageHeader, Panel, RecordCard, RecordList, Table } from "../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import { discardDraftAction, publishDraftAction, saveDraftAction, startFromVersionAction } from "./actions";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Website homepage" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const banners: Record<string, string> = {
  draft_saved: "Draft saved. It is not live until you publish it.",
  published: "Published. The new layout is live on every territory homepage.",
  discarded: "Draft discarded."
};

const sourceLabels: Record<PublicHomepageSlot["source"], string> = { local_then_network: "Local first, then network", local_only: "Local only", network: "Network only" };

export default async function HomepageTemplatePage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  const result = await load(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { data } = result;
  const working = data.draft?.slots ?? data.live?.slots ?? data.defaults;
  const message = code ? banners[code] ?? (homepageErrorText as Record<string, string>)[code] : undefined;
  const isError = Boolean(code && !banners[code]);
  const kinds: string[] = [...homepageSlotKinds];
  type Row = { kind: keyof typeof homepageKindLabels; heading: string; visible: boolean; itemCount: number; source: PublicHomepageSlot["source"] };
  const ordered: Row[] = [
    ...(working.filter((slot) => kinds.includes(slot.kind)) as Row[]),
    ...kinds.filter((kind) => !working.some((slot) => slot.kind === kind)).map((kind) => ({ kind: kind as Row["kind"], heading: homepageKindLabels[kind as Row["kind"]], visible: false, itemCount: homepageItemBounds[kind as Row["kind"]].min, source: "local_then_network" as const }))
  ];
  const liveNow = data.live ? `version ${data.live.version}, published ${formatDate(data.live.publishedAt)}` : "the built-in default layout";
  const versions = [...(data.live ? [data.live] : []), ...data.history];

  return (
    <>
      <Breadcrumbs items={[{ label: "Content Studio", href: "/app/content" as Route }, { label: "Website homepage" }]} />
      <PageHeader
        eyebrow="Public website"
        title="Territory homepage layout"
        intro={
          <>
            Choose which sections every territory homepage shows, in what order, with what heading and how many items. The top banner and the newsletter sign-up always
            stay. Offers, competitions and local businesses always carry their &quot;Sponsored&quot; label. Changes go live only when you publish, and a published layout
            is kept as history and never edited: a change is a new version. Live now: {liveNow}.{data.draft ? ` A draft (version ${data.draft.version}) is waiting.` : ""}
          </>
        }
        actions={
          <LinkButton href={"/app/content" as Route} variant="secondary">
            Back to Content Studio
          </LinkButton>
        }
      />

      {message ? <Notice tone={isError ? "error" : "success"}>{message}</Notice> : null}

      <Panel eyebrow="Layout" title={data.draft ? `Editing draft version ${data.draft.version}` : "Start a new draft"} id="editor">
        <form action={saveDraftAction.bind(null, request, kinds)} className="franchise-form">
          <Table caption="Homepage sections, in the order they appear">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Section</th>
                <th scope="col">Show</th>
                <th scope="col">Heading</th>
                <th scope="col">Items</th>
                <th scope="col">Content from</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((slot, index) => {
                const bounds = homepageItemBounds[slot.kind];
                const fixed = bounds.min === bounds.max;
                const required = slot.kind === "hero" || slot.kind === "newsletter";
                return (
                  <tr key={slot.kind}>
                    <td><input name={`pos-${slot.kind}`} type="number" min={1} max={kinds.length} defaultValue={index + 1} aria-label={`${homepageKindLabels[slot.kind]} position`} size={2} /></td>
                    <th scope="row">{homepageKindLabels[slot.kind]}{["offers", "competitions", "advertisers"].includes(slot.kind) ? " (sponsored)" : ""}</th>
                    <td><input type="checkbox" name={`show-${slot.kind}`} defaultChecked={slot.visible || required} disabled={required} aria-label={`Show ${slot.kind}`} />{required ? <input type="hidden" name={`show-${slot.kind}`} value="on" /> : null}</td>
                    <td><input name={`heading-${slot.kind}`} defaultValue={slot.heading} maxLength={80} required aria-label={`${slot.kind} heading`} /></td>
                    <td>{fixed ? <><input type="hidden" name={`count-${slot.kind}`} value={bounds.min} />{bounds.min}</> : <input name={`count-${slot.kind}`} type="number" min={bounds.min} max={bounds.max} defaultValue={slot.itemCount} aria-label={`${slot.kind} item count`} size={3} />}</td>
                    <td>
                      <select name={`source-${slot.kind}`} defaultValue={slot.source} aria-label={`${slot.kind} content source`}>
                        {(Object.keys(sourceLabels) as Array<PublicHomepageSlot["source"]>).map((source) => (
                          <option key={source} value={source}>{sourceLabels[source]}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <label>
            Note for the record (optional)
            <input name="notes" maxLength={500} defaultValue={data.draft?.notes ?? ""} />
          </label>
          <button type="submit" className="r2-button r2-button--primary">
            Save draft
          </button>
        </form>
        {data.draft ? (
          <Actions>
            <form action={publishDraftAction.bind(null, request, data.draft.id)}>
              <button type="submit" className="r2-button r2-button--primary">
                Publish this draft to every territory
              </button>
            </form>
            <form action={discardDraftAction.bind(null, request, data.draft.id)}>
              <button type="submit" className="r2-button r2-button--danger">
                Discard draft
              </button>
            </form>
          </Actions>
        ) : null}
      </Panel>

      {versions.length > 0 ? (
        <Panel eyebrow="History" title="Published layouts" intro="Every published layout is kept. Start a draft from any of them when there is no draft waiting." id="history">
          <RecordList>
            {versions.map((version) => (
              <RecordCard
                key={version.id}
                title={`Version ${version.version}`}
                status={version.status}
                lines={[version.slots.filter((slot) => slot.visible).map((slot) => slot.heading).join(" / "), version.notes ?? null]}
              >
                {!data.draft ? (
                  <form action={startFromVersionAction.bind(null, request, version.id)}>
                    <button type="submit" className="r2-button r2-button--secondary">
                      Start a draft from this
                    </button>
                  </form>
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        </Panel>
      ) : null}
    </>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "public.homepage", action: "manage" });
    const data = await readHomepageTemplates({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
    return { data };
  } catch (error) {
    return { error };
  }
}
