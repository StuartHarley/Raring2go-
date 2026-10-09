import { requireShellPermission } from "../../../../lib/app-shell";
import { readAudienceOverview, readPreferenceCentre } from "../../../../lib/marketing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Parent preferences" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PreferencesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const contactParam = params.contact;
  const contactId = Array.isArray(contactParam) ? contactParam[0] : contactParam;
  const result = await loadPreferences(request, contactId);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  if ("contacts" in result && result.contacts) {
    return (
      <AppShell request={request}>
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Parent preferences</p>
          <h2>Choose a contact</h2>
          {result.contacts.length === 0 ? (
            <p>No audience contacts are visible in your territories yet.</p>
          ) : (
            <div className="franchise-list">
              {result.contacts.map((view) => (
                <div key={view.contact.id}>
                  <strong>{view.contact.email}</strong>
                  <a href={`?${new URLSearchParams({ ...(request.sessionKey ? { session: request.sessionKey } : {}), contact: view.contact.id }).toString()}`}>
                    View preferences
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      </AppShell>
    );
  }

  if (!("preferences" in result) || !result.preferences) return protectedOutcome(new Error("Preferences are unavailable."), request);
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

async function loadPreferences(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, contactId: string | undefined) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.audience",
      action: "view"
    });
    const context = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    if (!contactId) return { contacts: (await readAudienceOverview(context)).contacts };

    return { preferences: await readPreferenceCentre(context, contactId) };
  } catch (error) {
    return { error };
  }
}
