import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readPreflightPanel, readTerritoryEdition } from "../../../../../lib/publishing-runtime";
import { AiPreparedNote, AssistantBanner, fixabilityLabels } from "../../../../../lib/assistant-ui";
import { explainPreflightAction, generateOutputAction, lifecycleAction } from "./actions";
import { readOutputReadiness } from "../../../../../lib/edition-output";
import { formatCount, formatDate, formatLabel } from "../../../../../lib/format";
import { Actions, EmptyState, LinkButton, Metrics, Notice, PageHeader, Panel, RecordCard, RecordList, StatusBadge } from "../../../../../lib/page-ui";
import { Breadcrumbs, RelatedRecords } from "../../../../../lib/workflow-ui";
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
    return protectedOutcome(result.error);
  }

  const pagesNeedingAttention = result.pages.filter((page) => page.readiness !== "ready").length;
  const edition = result.row.territoryEdition;
  const status = edition.status;
  const lifecycleResult = resultCode?.startsWith("edition_") ? (resultCode.endsWith("_refused") ? "refused" : "done") : undefined;
  const outputQuery = new URLSearchParams();
  if (request.sessionKey) outputQuery.set("session", request.sessionKey);
  if (request.organisationId) outputQuery.set("organisationId", request.organisationId);
  if (request.territoryId) outputQuery.set("territoryId", request.territoryId);
  const imposedQuery = new URLSearchParams([...outputQuery.entries(), ["file", "imposed"]]).toString();
  const steps = {
    flatplan: result.pages.length === 0 && result.can.flatplan,
    submit: ["draft", "localising"].includes(status) && result.pages.length > 0 && result.can.submit,
    approve: status === "review" && result.can.approve,
    reopen: ["review", "approved"].includes(status) && result.can.approve,
    release: status === "approved" && result.can.release
  };
  const hasStep = Object.values(steps).some(Boolean);
  const statusTone = status === "published" ? "success" : status === "review" ? "warning" : undefined;

  return (
    <>
      <Breadcrumbs items={[
        { label: "Edition Factory", href: "/app/editions" as Route },
        { label: result.row.territoryEdition.title }
      ]} />
      <PageHeader
        eyebrow="Edition"
        title={result.row.territoryEdition.title}
        intro="The flatplan and readiness of this territory edition: the one record that drives its print and digital output."
        actions={
          result.pages.length > 0 ? (
            <LinkButton href={`/app/editions/${id}/flatplan` as Route} variant="primary">
              Edit the flatplan
            </LinkButton>
          ) : undefined
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Season", value: result.row.season.name },
            { label: "Status", value: formatLabel(status), tone: statusTone },
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

      <Panel
        id="lifecycle"
        eyebrow="Lifecycle"
        title={
          <>
            Status: <StatusBadge status={status} tone={statusTone} />
          </>
        }
        intro="Draft, then flatplan, review, approval, digital output, publication. Approval needs every page ready; publication needs a generated digital edition. A published edition is public and cannot be reopened."
      >
        {lifecycleResult === "refused" ? <Notice tone="error">That step is not available yet: check the requirements below.</Notice> : null}
        {lifecycleResult === "done" ? <Notice tone="success">Done.</Notice> : null}
        {!hasStep ? (
          <EmptyState title={status === "published" ? "This edition is published" : "Nothing for you to do at this step"}>
            {status === "published" ? "It is public and cannot be reopened." : "The next step belongs to someone else, or this edition is waiting on its pages."}
          </EmptyState>
        ) : (
          <>
            <Actions>
              {steps.flatplan ? (
                <form action={lifecycleAction.bind(null, request, id, "flatplan")}>
                  <button type="submit" className="r2-button r2-button--primary">
                    Create flatplan ({formatCount(edition.pageCount, "page")})
                  </button>
                </form>
              ) : null}
              {steps.submit ? (
                <form action={lifecycleAction.bind(null, request, id, "submit")}>
                  <button type="submit" className="r2-button r2-button--primary">
                    Submit for review
                  </button>
                </form>
              ) : null}
              {steps.approve ? (
                <form action={lifecycleAction.bind(null, request, id, "approve")}>
                  <button type="submit" className="r2-button r2-button--primary">
                    Approve edition
                  </button>
                </form>
              ) : null}
              {steps.release ? (
                <form action={lifecycleAction.bind(null, request, id, "release")}>
                  <button type="submit" className="r2-button r2-button--primary">
                    Publish edition
                  </button>
                </form>
              ) : null}
            </Actions>
            {steps.reopen ? (
              <form action={lifecycleAction.bind(null, request, id, "reopen")} className="franchise-form">
                <label>
                  Reason for reopening
                  <input name="reason" required maxLength={500} />
                </label>
                <button type="submit" className="r2-button r2-button--secondary">
                  Reopen for changes
                </button>
              </form>
            ) : null}
          </>
        )}
      </Panel>

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
                  {typeof (output.artifact.imposed as { fileId?: unknown } | undefined)?.fileId === "string" ? (
                    <a href={`/app/editions/${id}/outputs/${output.id}?${imposedQuery}`}>Download imposed booklet (press sheets)</a>
                  ) : null}
                </RecordCard>
              );
            })}
          </RecordList>
        )}
      </Panel>
    </>
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

async function lifecycleCan(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  const check = (module: string, action: string) => requireShellPermission(request, { module, action }).then(() => true, (error) => {
    if (error instanceof ShellAccessError) return false;
    throw error;
  });
  return { flatplan: await check("edition.page", "edit"), submit: await check("edition", "edit"), approve: await check("edition", "approve"), release: await check("edition", "release") };
}
