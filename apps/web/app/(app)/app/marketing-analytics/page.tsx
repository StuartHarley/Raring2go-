import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { readMarketingAnalytics } from "../../../../lib/marketing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MarketingAnalyticsPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadAnalytics(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const analytics = result.analytics;

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Marketing analytics</p>
        <h2>Audience and channel performance</h2>
        <p>
          Reporting derived from platform records, with provider-reported
          metrics shown only when available.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Audience</span>
            <strong>{analytics.audience.activeSubscribers}</strong>
          </article>
          <article>
            <span>Email delivered</span>
            <strong>{analytics.email.delivered}</strong>
          </article>
          <article>
            <span>Journey entries</span>
            <strong>{analytics.journeys.entries}</strong>
          </article>
          <article>
            <span>Social published</span>
            <strong>{analytics.social.published}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Channel health</p>
        <h2>Known metrics</h2>
        <div className="franchise-list">
          <div>
            <strong>Email</strong>
            <span>
              {analytics.email.sends} sends - {analytics.email.failed} failed - opens{" "}
              {analytics.email.opens ?? "not reported"} - clicks {analytics.email.clicks ?? "not reported"}
            </span>
          </div>
          <div>
            <strong>Journeys</strong>
            <span>
              {analytics.journeys.completed} completed - {analytics.journeys.failed} failed -{" "}
              {analytics.journeys.dropOff} drop-off
            </span>
          </div>
          <div>
            <strong>Social</strong>
            <span>
              {analytics.social.scheduled} scheduled - {analytics.social.published} published -{" "}
              {analytics.social.failed} failed
            </span>
          </div>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Attribution foundation</p>
        <h2>Trackable references</h2>
        <div className="franchise-list">
          {analytics.attribution.map((item) => (
            <div key={`${item.channel}-${item.metric}-${item.territoryId ?? "network"}`}>
              <strong>{item.channel} / {item.metric}</strong>
              <span>{item.source} - {item.territoryId ?? "network"} - {item.value}</span>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function loadAnalytics(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.analytics",
      action: "view"
    });
    const analytics = await readMarketingAnalytics({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { analytics };
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
