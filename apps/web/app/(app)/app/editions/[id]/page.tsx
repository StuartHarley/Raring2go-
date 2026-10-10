import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readPreflightPanel, readTerritoryEdition } from "../../../../../lib/publishing-runtime";
import { AiPreparedNote, AssistantBanner, fixabilityLabels } from "../../../../../lib/assistant-ui";
import { explainPreflightAction, generateOutputAction, lifecycleAction } from "./actions";
import { readOutputReadiness } from "../../../../../lib/edition-output";
import { formatCount, formatDate, formatLabel } from "../../../../../lib/format";
import { EmptyState, Metrics, Notice, PageHeader, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { Breadcrumbs, RelatedRecords } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Edition" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditionStudioPage({ params, searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const { id } = await params;
  const result = await loadEdition(request, id);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const pagesNeedingAttention = result.pages.filter((page) => page.readiness !== "ready").length;
  const outputQuery = new URLSearchParams();
  if (request.sessionKey) outputQuery.set("session", request.sessionKey);
  if (request.organisationId) outputQuery.set("organisationId", request.organisationId);
  if (request.territoryId) outputQuery.set("territoryId", request.territoryId);

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[
        { label: "Edition Factory", href: "/app/editions" as Route },
        { label: result.row.territoryEdition.title }
      ]} />
      <PageHeader
        eyebrow="Edition"
        title={result.row.territoryEdition.title}
        intro="The flatplan and readiness of this territory edition: the one record that drives its print and digital output."
      />

      <Panel>
        <Metrics
          items={[
            { label: "Season", value: result.row.season.name },
            { label: "Readiness", value: `${result.row.completionPercent}%`, tone: result.row.completionPercent === 100 ? "success" : undefined },
            { label: "Print", value: formatLabel(result.row.printStatus), tone: result.row.printStatus === "generated" ? "success" : undefined },
            { label: "Digital", value: formatLabel(result.row.digitalStatus), tone: result.row.digitalStatus === "generated" ? "success" : undefined }
          ]}
        />
      </Panel>

      <RelatedRecords
        title="Edition workflow"
        records={[
          {
            label: "Content",
            title: formatCount(result.content.length, "content item"),
            description: "Inherited and local content assigned to this edition",
            href: "/app/content"
          },
          {
            label: "Commercial",
            title: "Advertiser inventory and artwork",
            description: "Bookings and artwork readiness feed page placement",
            href: "/app/advertisers"
          },
          {
            label: "Preflight",
            title: `${formatCount(pagesNeedingAttention, "page")} need readiness attention`,
            description: "Print readiness checks before output generation",
            href: "#preflight",
            status: result.pages.some((page) => page.readiness === "blocked") ? "blocked" : "clear"
          },
          {
            label: "Outputs",
            title: formatCount(result.outputs.length, "publication output"),
            description: "Print and digital files from the same edition snapshot",
            href: "#outputs"
          }
        ]}
      />

      <Panel eyebrow="Flatplan" title="Page assembly">
        {result.pages.length === 0 ? (
          <EmptyState title="No pages yet">Pages appear here once the flatplan has been built from the master edition.</EmptyState>
        ) : (
          <div className="edition-flatplan">
            {result.pages.map((page) => (
              <article key={page.id} className={`edition-page-tile edition-page-${page.readiness}`}>
                <span>Page {page.pageNumber}</span>
                <strong>{formatLabel(page.status)}</strong>
                <small>{formatLabel(page.sourceMarker)} · {formatLabel(page.side)} page</small>
                <small>{page.assignedContentId ? "Content assigned" : "Needs content"}</small>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        id="preflight"
        eyebrow="Preflight"
        title="Print readiness"
        intro="What the print checks found, in plain English. The findings and the fix verdicts come straight from the preflight, and a failing file is never described as print-ready. An optional AI explanation can reword them for the person preparing the artwork."
      >
        <AssistantBanner code={resultCode} />
        {result.preflight.results.length === 0 ? (
          <EmptyState title="No preflight has been run on this edition yet">Results for each page appear here after the first preflight.</EmptyState>
        ) : (
          <RecordList>
            {result.preflight.results.map((entry) => (
              <RecordCard
                key={entry.id}
                title={entry.pageNumber ? `Page ${entry.pageNumber}` : "Edition artwork"}
                status={entry.analysis.readyForPrint ? "ready for print" : "not ready for print"}
                tone={entry.analysis.readyForPrint ? "success" : "danger"}
                lines={[entry.ai ? entry.ai.output.summary : entry.analysis.summary]}
              >
                {entry.ai ? <AiPreparedNote run={entry.ai.run} /> : null}
                {entry.analysis.items.map((item) => {
                  const said = entry.ai?.output.items.find((candidate) => candidate.code === item.code);
                  const steps = said?.steps?.length ? said.steps : item.steps;
                  return (
                    <div key={item.code}>
                      <strong>
                        {item.title} <span className="muted">({formatLabel(item.severity)})</span>
                      </strong>
                      <p>{said?.explanation ?? item.explanation}</p>
                      <p className="muted">{fixabilityLabels[item.fixability] ?? formatLabel(item.fixability)}</p>
                      <details>
                        <summary>What to do</summary>
                        <ol>
                          {steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                        <p className="muted">Preflight said: {item.engineMessage}</p>
                      </details>
                    </div>
                  );
                })}
                {entry.analysis.items.length > 0 && result.preflight.canAssist ? (
                  result.preflight.aiConfigured ? (
                    <form action={explainPreflightAction.bind(null, request, id, entry.id)}>
                      <button type="submit" className="r2-button r2-button--secondary">
                        {entry.ai ? "Refresh AI explanation" : "Add AI explanation"}
                      </button>
                    </form>
                  ) : (
                    <p className="muted">AI explanations are not switched on for this environment.</p>
                  )
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel id="outputs" eyebrow="Outputs" title="Print and digital files">
        {resultCode === "output_queued" ? (
          <Notice tone="success">Queued. The file is rendered in the background and appears below when it is ready; progress is in Jobs.</Notice>
        ) : null}
        {resultCode === "output_not_ready" ? <Notice tone="error">That output could not be queued. See what is blocking it below.</Notice> : null}
        <RecordList>
          {(["print", "digital"] as const).map((kind) => {
            const state = result.readiness[kind];
            return (
              <RecordCard
                key={kind}
                title={kind === "print" ? "Press-ready print PDF" : "Digital edition PDF"}
                lines={state.allowed ? [] : [`Not available: ${state.blocker}`]}
              >
                {state.allowed ? (
                  <form action={generateOutputAction.bind(null, request, id, kind)}>
                    <button type="submit" className="r2-button r2-button--primary">
                      Generate {kind}
                    </button>
                  </form>
                ) : null}
              </RecordCard>
            );
          })}
        </RecordList>
        {result.outputs.length === 0 ? (
          <EmptyState title="No outputs generated yet">Generation is gated by approval and, for print, a successful preflight on every page.</EmptyState>
        ) : (
          <RecordList>
            {result.outputs.map((output) => {
              const proofOnly = output.artifact.proofOnly === true;
              const hasFile = typeof output.artifact.fileId === "string";
              return (
                <RecordCard
                  key={output.id}
                  title={`${formatLabel(output.outputType)} v${output.version}${proofOnly ? " (proof only, not press-ready)" : ""}`}
                  status={output.status}
                  lines={[
                    `Generated ${formatDate(output.generatedAt, "date not set")}${typeof output.artifact.pageCount === "number" ? ` · ${formatCount(output.artifact.pageCount, "page")}` : ""}`
                  ]}
                >
                  {hasFile ? (
                    <a href={`/app/editions/${id}/outputs/${output.id}${outputQuery.size ? `?${outputQuery.toString()}` : ""}`}>Download PDF</a>
                  ) : null}
                </RecordCard>
              );
            })}
          </RecordList>
        )}
      </Panel>
    </AppShell>
  );
}

async function loadEdition(
  request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>,
  territoryEditionId: string
) {
  try {
    const shell = await requireShellPermission(request, {
      module: "edition",
      action: "view"
    });
    const actor = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const edition = await readTerritoryEdition(actor, territoryEditionId);
    return { ...edition, preflight: await readPreflightPanel(actor, territoryEditionId), readiness: await readOutputReadiness(actor, territoryEditionId), can: await lifecycleCan(request) };
  } catch (error) {
    return { error };
  }
}
