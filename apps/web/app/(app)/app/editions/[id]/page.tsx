import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readPreflightPanel, readTerritoryEdition } from "../../../../../lib/publishing-runtime";
import { AiPreparedNote, AssistantBanner, fixabilityLabels } from "../../../../../lib/assistant-ui";
import { explainPreflightAction, generateOutputAction } from "./actions";
import { readOutputReadiness } from "../../../../../lib/edition-output";
import { Breadcrumbs, RelatedRecords } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";

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

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[
        { label: "Publishing", href: "/app/editions" },
        { label: "Edition Factory", href: "/app/editions" },
        { label: result.row.territoryEdition.title }
      ]} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Edition Studio</p>
        <h2>{result.row.territoryEdition.title}</h2>
        <p>
          Visual flatplan and readiness snapshot for the single territory edition
          that will drive print and digital publication.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Season</span>
            <strong>{result.row.season.name}</strong>
          </article>
          <article>
            <span>Readiness</span>
            <strong>{result.row.completionPercent}%</strong>
          </article>
          <article>
            <span>Print</span>
            <strong>{result.row.printStatus}</strong>
          </article>
          <article>
            <span>Digital</span>
            <strong>{result.row.digitalStatus}</strong>
          </article>
        </div>
      </section>

      <RelatedRecords
        title="Edition workflow"
        records={[
          {
            label: "Content",
            title: `${result.content.length} content item(s)`,
            description: "Assigned inherited/local content for this edition",
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
            title: `${result.pages.filter((page) => page.readiness !== "ready").length} page(s) need readiness attention`,
            description: "Print readiness checks before output generation",
            status: result.pages.some((page) => page.readiness === "blocked") ? "Needs attention" : "No blocking page failures"
          },
          {
            label: "Outputs",
            title: `${result.outputs.length} publication output(s)`,
            description: "Print and digital artefacts from the same edition snapshot"
          }
        ]}
      />

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Flatplan</p>
        <h2>Page assembly</h2>
        <div className="edition-flatplan">
          {result.pages.map((page) => (
            <article key={page.id} className={`edition-page-tile edition-page-${page.readiness}`}>
              <span>Page {page.pageNumber}</span>
              <strong>{page.status.replaceAll("_", " ")}</strong>
              <small>{page.sourceMarker} - {page.side}</small>
              <small>{page.assignedContentId ? "Content assigned" : "Needs content"}</small>
            </article>
          ))}
        </div>
      </section>

      <section id="preflight" className="app-panel franchise-panel" aria-label="Preflight">
        <p className="eyebrow">Preflight</p>
        <h2>Print readiness</h2>
        <p>
          What the print checks found, in plain English. The findings and the fix verdicts come straight from the preflight, and a failing file is never described as print-ready. An optional AI explanation can reword
          them for the person preparing the artwork.
        </p>
        <AssistantBanner code={resultCode} />
        {result.preflight.results.length === 0 ? (
          <p>No preflight has been run on this edition yet.</p>
        ) : (
          result.preflight.results.map((entry) => (
            <article key={entry.id} className="franchise-list" aria-label={`Preflight for page ${entry.pageNumber ?? ""}`}>
              <div>
                <strong>
                  {entry.pageNumber ? `Page ${entry.pageNumber}` : "Edition artwork"}: {entry.analysis.readyForPrint ? "ready for print" : "not ready for print"}
                </strong>
                <span>{entry.ai ? entry.ai.output.summary : entry.analysis.summary}</span>
                {entry.ai ? <AiPreparedNote run={entry.ai.run} /> : null}
              </div>
              {entry.analysis.items.map((item) => {
                const said = entry.ai?.output.items.find((candidate) => candidate.code === item.code);
                const steps = said?.steps?.length ? said.steps : item.steps;
                return (
                  <div key={item.code}>
                    <strong>
                      {item.title} <span className="muted">({item.severity})</span>
                    </strong>
                    <span>{said?.explanation ?? item.explanation}</span>
                    <span className="muted">{fixabilityLabels[item.fixability]}</span>
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
                    <button type="submit">{entry.ai ? "Refresh AI explanation" : "Add AI explanation"}</button>
                  </form>
                ) : (
                  <p className="muted">AI explanations are not switched on for this environment.</p>
                )
              ) : null}
            </article>
          ))
        )}
      </section>

      <section id="outputs" className="app-panel franchise-panel" aria-label="Outputs">
        <p className="eyebrow">Outputs</p>
        <h2>Print and digital artefacts</h2>
        {resultCode === "output_queued" ? <p role="status">Queued. The file is rendered in the background and appears below when it is ready; progress is in Jobs.</p> : null}
        {resultCode === "output_not_ready" ? <p role="alert">That output could not be queued. See what is blocking it below.</p> : null}
        <div className="franchise-list">
          {(["print", "digital"] as const).map((kind) => {
            const state = result.readiness[kind];
            return (
              <div key={kind}>
                <strong>{kind === "print" ? "Press-ready print PDF" : "Digital edition PDF"}</strong>
                {state.allowed ? (
                  <form action={generateOutputAction.bind(null, request, id, kind)}>
                    <button type="submit">Generate {kind}</button>
                  </form>
                ) : (
                  <span className="muted">Not available: {state.blocker}</span>
                )}
              </div>
            );
          })}
          {result.outputs.length === 0 ? (
            <div>
              <strong>No outputs generated yet</strong>
              <span>Generation is gated by approval and, for print, a successful preflight on every page.</span>
            </div>
          ) : (
            result.outputs.map((output) => {
              const proofOnly = output.artifact.proofOnly === true;
              const hasFile = typeof output.artifact.fileId === "string";
              const query = new URLSearchParams();
              if (request.sessionKey) query.set("session", request.sessionKey);
              if (request.organisationId) query.set("organisationId", request.organisationId);
              if (request.territoryId) query.set("territoryId", request.territoryId);
              return (
                <div key={output.id}>
                  <strong>{output.outputType} v{output.version}{proofOnly ? " - proof only, not press-ready" : ""}</strong>
                  <span>{output.status} - generated {output.generatedAt ?? "date not set"}{typeof output.artifact.pageCount === "number" ? ` - ${output.artifact.pageCount} pages` : ""}</span>
                  {hasFile ? <a href={`/app/editions/${id}/outputs/${output.id}${query.size ? `?${query.toString()}` : ""}`}>Download PDF</a> : null}
                </div>
              );
            })
          )}
        </div>
      </section>
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
    return { ...edition, preflight: await readPreflightPanel(actor, territoryEditionId), readiness: await readOutputReadiness(actor, territoryEditionId) };
  } catch (error) {
    return { error };
  }
}

function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return (
      <main className={`app-outcome app-outcome-${error.kind}`}>
        <section>
          <p className="eyebrow">{error.kind.replace("_", " ")}</p>
          <h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1>
          <p>{error.message}</p>
        </section>
      </main>
    );
  }

  throw error;
}
