import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { listNetworkTerritories, readNewsletterFactoryOverview, readSegments } from "../../../../../lib/marketing-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import {
  addEditionOverrideAction,
  approveMasterAction,
  createCampaignFromEditionAction,
  createNewsletterMasterAction,
  generateEditionsAction
} from "../actions";
import type { AudienceSegment } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewsletterFactoryPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadFactory(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { context, factory, territories, segments, isNetworkView } = result;

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
            <strong>{factory.totals.masters}</strong>
          </article>
          <article>
            <span>Territory editions</span>
            <strong>{factory.totals.editions}</strong>
          </article>
          <article>
            <span>Ready</span>
            <strong>{factory.totals.ready}</strong>
          </article>
          <article>
            <span>Needs review</span>
            <strong>{factory.totals.needsReview}</strong>
          </article>
          <article>
            <span>Blocked</span>
            <strong>{factory.totals.blocked}</strong>
          </article>
        </div>
      </section>

      {isNetworkView ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">HQ</p>
          <h2>Create a newsletter master</h2>
          <form action={createNewsletterMasterAction.bind(null, context)} className="franchise-form">
            <label>
              Title
              <input type="text" name="title" required />
            </label>
            <label>
              Season
              <input type="text" name="seasonKey" placeholder="e.g. autumn" />
            </label>
            <label>
              <input type="checkbox" name="requireLocalContent" /> Require each territory to add local picks before sending
            </label>
            <button type="submit">Create master</button>
          </form>
        </section>
      ) : null}

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Masters</p>
        <h2>Approved network content</h2>
        <div className="franchise-list">
          {factory.masters.length === 0 ? (
            <div>
              <strong>No visible masters</strong>
              <span>Approved HQ newsletter masters will appear here.</span>
            </div>
          ) : (
            factory.masters.map((master) => (
              <div key={master.id}>
                <strong>{master.title}</strong>
                <span>{master.status} - {master.seasonKey ?? "no season"}</span>
                <span>{master.localEditableBlocks.length} local editable block(s)</span>
                {isNetworkView && master.status === "draft" ? (
                  <form action={approveMasterAction.bind(null, context, master.id)}>
                    <button type="submit">Approve master</button>
                  </form>
                ) : null}
                {isNetworkView && (master.status === "approved" || master.status === "generated") ? (
                  <form action={generateEditionsAction.bind(null, context, master.id)} className="franchise-form">
                    {territories.map((territory) => (
                      <label key={territory.id}>
                        <input type="checkbox" name="territoryIds" value={territory.id} defaultChecked /> {territory.name}
                      </label>
                    ))}
                    <button type="submit">Generate territory editions</button>
                  </form>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Territory editions</p>
        <h2>Local readiness</h2>
        <div className="franchise-list">
          {factory.editions.length === 0 ? (
            <div>
              <strong>No generated editions yet</strong>
              <span>Approve a master and generate editions to see territory readiness here.</span>
            </div>
          ) : (
            factory.editions.map((edition) => {
              const segment = segments.find((candidate) => candidate.territoryId === edition.territoryId);
              const canEdit = !context.territoryId || context.territoryId === edition.territoryId;

              return (
                <div key={edition.id}>
                  <strong>{territoryName(territories, edition.territoryId)}</strong>
                  <span>{edition.status} - {edition.warnings.length} warning(s)</span>
                  <span>{Object.keys(edition.localOverrides).length} local override(s)</span>
                  {edition.emailCampaignId ? (
                    <span>
                      Linked to campaign {edition.emailCampaignId} - manage sending from{" "}
                      <a href="/app/newsletters">Newsletters</a>
                    </span>
                  ) : (
                    <>
                      {canEdit ? (
                        <form action={addEditionOverrideAction.bind(null, context, edition.id)} className="franchise-form">
                          <label>
                            Local picks (one per line)
                            <textarea name="localPicks" rows={3} />
                          </label>
                          <button type="submit">Save local content</button>
                        </form>
                      ) : null}
                      {canEdit && edition.status !== "blocked" && segment ? (
                        <form
                          action={createCampaignFromEditionAction.bind(null, context, edition.id, segment.id)}
                          className="franchise-form"
                        >
                          <label>
                            Subject
                            <input type="text" name="subject" required />
                          </label>
                          <label>
                            Preheader
                            <input type="text" name="preheader" />
                          </label>
                          <button type="submit">Create campaign from this edition</button>
                        </form>
                      ) : null}
                      {canEdit && edition.status !== "blocked" && !segment ? (
                        <span>No audience segment is configured for this territory yet.</span>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })
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
    const context: MarketingActorContext = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    const [factory, segments] = await Promise.all([
      readNewsletterFactoryOverview(context),
      readSegments(context).catch(() => [] as AudienceSegment[])
    ]);

    return {
      context,
      factory,
      segments,
      isNetworkView: !context.territoryId,
      territories: listNetworkTerritories()
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
