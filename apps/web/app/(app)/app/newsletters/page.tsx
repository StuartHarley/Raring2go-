import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { readEmailCampaignOverview } from "../../../../lib/marketing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewslettersPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadNewsletters(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Native email</p>
        <h2>Newsletter campaigns</h2>
        <p>
          Raring2go-owned campaign, version, recipient snapshot and delivery
          foundations. Delivery providers are transport only.
        </p>
        <p>
          <a href="/app/newsletters/factory">Open HQ newsletter factory</a>
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Campaigns</span>
            <strong>{result.email.totals.campaigns}</strong>
          </article>
          <article>
            <span>Draft</span>
            <strong>{result.email.totals.draft}</strong>
          </article>
          <article>
            <span>Scheduled</span>
            <strong>{result.email.totals.scheduled}</strong>
          </article>
          <article>
            <span>Sent</span>
            <strong>{result.email.totals.sent}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Campaigns</p>
        <h2>Native campaign records</h2>
        <div className="franchise-list">
          {result.email.campaigns.length === 0 ? (
            <div>
              <strong>No campaigns yet</strong>
              <span>MKT-002 creates the native engine; campaign authoring follows the approved workflow.</span>
            </div>
          ) : (
            result.email.campaigns.map((view) => (
              <div key={view.campaign.id}>
                <strong>{view.campaign.title}</strong>
                <span>{view.campaign.status} - {view.latestSnapshot?.recipientCount ?? 0} recipients</span>
                <span>{view.deliveryCount} delivery events</span>
              </div>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}

async function loadNewsletters(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.email",
      action: "view"
    });
    const email = await readEmailCampaignOverview({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { email };
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
