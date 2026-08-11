import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { readPreferenceCentre } from "../../../../lib/marketing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PreferencesPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadPreferences(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const profile = result.preferences.profile;

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Parent preferences</p>
        <h2>Personalisation profile</h2>
        <p>
          Privacy-light reader preferences for local discovery, newsletter
          relevance and journey targeting. Broad age bands only; no child names
          or dates of birth are collected.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Territories</span>
            <strong>{profile?.followedTerritoryIds.length ?? 0}</strong>
          </article>
          <article>
            <span>Interests</span>
            <strong>{profile?.interests.length ?? 0}</strong>
          </article>
          <article>
            <span>Frequency</span>
            <strong>{profile?.newsletterFrequency ?? "unset"}</strong>
          </article>
          <article>
            <span>Saved</span>
            <strong>{result.preferences.savedContent.length}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Preferences</p>
        <h2>{result.preferences.contact.email}</h2>
        <div className="franchise-list">
          <div>
            <strong>Interests</strong>
            <span>{profile?.interests.join(", ") || "No interests selected yet"}</span>
          </div>
          <div>
            <strong>Age ranges</strong>
            <span>{profile?.childAgeBands.join(", ") || "No broad age ranges selected"}</span>
          </div>
          <div>
            <strong>Subscriptions</strong>
            <span>
              {result.preferences.subscriptions.map((subscription) => `${subscription.territoryId}: ${subscription.status}`).join(", ")}
            </span>
          </div>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Discovery</p>
        <h2>Relevant content and segments</h2>
        <div className="franchise-list">
          {result.preferences.recommendedContent.length === 0 ? (
            <div>
              <strong>No personalised recommendations yet</strong>
              <span>Local discovery falls back to current territory content when no preferences are present.</span>
            </div>
          ) : (
            result.preferences.recommendedContent.map((item) => (
              <div key={item.id}>
                <strong>{item.title}</strong>
                <span>{item.contentType} - {item.relevanceReasons.join(", ")}</span>
              </div>
            ))
          )}
          {result.preferences.recommendedSegments.map((segment) => (
            <div key={segment.id}>
              <strong>{segment.name}</strong>
              <span>Eligible dynamic segment</span>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function loadPreferences(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.audience",
      action: "view"
    });
    const preferences = await readPreferenceCentre({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { preferences };
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
