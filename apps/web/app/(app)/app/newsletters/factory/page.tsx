import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readNewsletterFactoryOverview } from "../../../../../lib/marketing-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewsletterFactoryPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadFactory(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">HQ newsletter factory</p>
        <h2>Network-to-local newsletters</h2>
        <p>
          Create once at HQ, generate territory-specific editions, and keep local
          overrides separate from the network master.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Masters</span>
            <strong>{result.factory.totals.masters}</strong>
          </article>
          <article>
            <span>Territory editions</span>
            <strong>{result.factory.totals.editions}</strong>
          </article>
          <article>
            <span>Ready</span>
            <strong>{result.factory.totals.ready}</strong>
          </article>
          <article>
            <span>Needs review</span>
            <strong>{result.factory.totals.needsReview}</strong>
          </article>
          <article>
            <span>Blocked</span>
            <strong>{result.factory.totals.blocked}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Masters</p>
        <h2>Approved network content</h2>
        <div className="franchise-list">
          {result.factory.masters.length === 0 ? (
            <div>
              <strong>No visible masters</strong>
              <span>Approved HQ newsletter masters will appear here.</span>
            </div>
          ) : (
            result.factory.masters.map((master) => (
              <div key={master.id}>
                <strong>{master.title}</strong>
                <span>{master.status} - {master.seasonKey ?? "no season"}</span>
                <span>{master.localEditableBlocks.length} local editable block(s)</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Territory editions</p>
        <h2>Local readiness</h2>
        <div className="franchise-list">
          {result.factory.editions.length === 0 ? (
            <div>
              <strong>No generated editions yet</strong>
              <span>MKT-003 provides the generation foundation; campaign sending remains separate.</span>
            </div>
          ) : (
            result.factory.editions.map((edition) => (
              <div key={edition.id}>
                <strong>{territoryName(result.territories, edition.territoryId)}</strong>
                <span>{edition.status} - {edition.warnings.length} warning(s)</span>
                <span>{Object.keys(edition.localOverrides).length} local override(s)</span>
              </div>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}

async function loadFactory(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.newsletter_factory",
      action: "view"
    });
    const factory = await readNewsletterFactoryOverview({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return {
      factory,
      territories: shell.availableContexts.flatMap((context) =>
        context.territoryId ? [{ id: context.territoryId, name: context.territoryName ?? context.territoryId }] : []
      )
    };
  } catch (error) {
    return { error };
  }
}

function territoryName(territories: Array<{ id: string; name: string }>, territoryId: string) {
  return territories.find((territory) => territory.id === territoryId)?.name ?? territoryId;
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
