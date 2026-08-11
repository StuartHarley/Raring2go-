import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readTerritoryEdition } from "../../../../../lib/publishing-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditionStudioPage({ params, searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const { id } = await params;
  const result = await loadEdition(request, id);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <AppShell request={request}>
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

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Outputs</p>
        <h2>Print and digital artefacts</h2>
        <div className="franchise-list">
          {result.outputs.length === 0 ? (
            <div>
              <strong>No outputs generated yet</strong>
              <span>Final generation remains gated by approval and successful preflight.</span>
            </div>
          ) : (
            result.outputs.map((output) => (
              <div key={output.id}>
                <strong>{output.outputType} v{output.version}</strong>
                <span>{output.status} - generated {output.generatedAt ?? "date not set"}</span>
              </div>
            ))
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
    return await readTerritoryEdition(
      {
        userId: shell.userId,
        organisationId: shell.activeContext.organisationId,
        territoryId: shell.activeContext.territoryId
      },
      territoryEditionId
    );
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
