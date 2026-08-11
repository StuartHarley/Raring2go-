import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { readAudienceOverview } from "../../../../lib/marketing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AudiencePage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadAudience(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Audience CRM</p>
        <h2>Native audience foundation</h2>
        <p>
          Raring2go-owned contacts, territory subscriptions, consent history,
          preferences and suppression foundations.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Contacts</span>
            <strong>{result.audience.totals.contacts}</strong>
          </article>
          <article>
            <span>Subscribed</span>
            <strong>{result.audience.totals.subscribed}</strong>
          </article>
          <article>
            <span>Suppressed</span>
            <strong>{result.audience.totals.suppressed}</strong>
          </article>
          <article>
            <span>Territories</span>
            <strong>{result.audience.totals.territories}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Contacts</p>
        <h2>Audience records</h2>
        <div className="franchise-list">
          {result.audience.contacts.map((view) => (
            <div key={view.contact.id}>
              <strong>{view.contact.email}</strong>
              <span>{view.subscriptions.length} territory subscriptions - {view.contact.emailStatus}</span>
              <span>{view.suppressions.length > 0 ? "Suppressed" : "Eligible if consent and segment allow"}</span>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function loadAudience(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.audience",
      action: "view"
    });
    const audience = await readAudienceOverview({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { audience };
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
