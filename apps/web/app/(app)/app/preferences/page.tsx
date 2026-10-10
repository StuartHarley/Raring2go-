import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { listNetworkTerritories, readAudienceOverview, readPreferenceCentre } from "../../../../lib/marketing-runtime";
import { displayName, formatLabel, formatLabels } from "../../../../lib/format";
import { EmptyState, FactList, Metrics, PageHeader, Panel, RecordCard, RecordLink, RecordList, StatusBadge } from "../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../lib/workflow-ui";
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
        <PageHeader
          eyebrow="Audience"
          title="Parent preferences"
          intro="Pick a contact to see which areas they follow, what they are interested in and which newsletters they receive."
        />
        <Panel eyebrow="Contacts" title="Choose a contact">
          {result.contacts.length === 0 ? (
            <EmptyState title="No contacts yet">Contacts appear here once people sign up or a list is imported for your areas.</EmptyState>
          ) : (
            <RecordList>
              {result.contacts.map((view) => {
                const name = [view.contact.firstName, view.contact.lastName].filter(Boolean).join(" ");
                return (
                  <RecordLink
                    key={view.contact.id}
                    href={`?${new URLSearchParams({ ...(request.sessionKey ? { session: request.sessionKey } : {}), contact: view.contact.id }).toString()}` as Route}
                    title={name || view.contact.email}
                    status={view.contact.emailStatus}
                    lines={[name ? view.contact.email : null, "View preferences"]}
                  />
                );
              })}
            </RecordList>
          )}
        </Panel>
      </AppShell>
    );
  }

  if (!("preferences" in result) || !result.preferences) return protectedOutcome(new Error("Preferences are unavailable."), request);
  const { contact, profile, subscriptions, savedContent, recommendedContent, recommendedSegments } = result.preferences;
  const territoryNames = new Map((await listNetworkTerritories()).map((territory) => [territory.id, territory.name]));
  const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email;

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Parent preferences", href: withSession("/app/preferences", request) }, { label: contactName }]} />
      <PageHeader
        eyebrow="Parent preferences"
        title={contactName}
        intro="What this reader has told us they want: broad age bands and interests only, never child names or dates of birth."
      />

      <Panel>
        <Metrics
          items={[
            { label: "Areas followed", value: profile?.followedTerritoryIds.length ?? 0 },
            { label: "Interests", value: profile?.interests.length ?? 0 },
            { label: "Newsletter frequency", value: formatLabel(profile?.newsletterFrequency, "Not set") },
            { label: "Saved items", value: savedContent.length }
          ]}
        />
      </Panel>

      <Panel eyebrow="Preferences" title="What they told us">
        <FactList
          items={[
            { label: "Email", value: contact.email },
            { label: "Interests", value: profile?.interests.length ? formatLabels(profile.interests) : "No interests selected yet" },
            { label: "Age ranges", value: profile?.childAgeBands.length ? formatLabels(profile.childAgeBands) : "No broad age ranges selected" },
            {
              label: "Subscriptions",
              value:
                subscriptions.length === 0 ? (
                  "No area subscriptions"
                ) : (
                  <span className="record-card__line">
                    {subscriptions.map((subscription) => (
                      <span key={subscription.id}>
                        {displayName(territoryNames.get(subscription.territoryId), "Area not named yet")} <StatusBadge status={subscription.status} />
                      </span>
                    ))}
                  </span>
                )
            }
          ]}
        />
      </Panel>

      <Panel eyebrow="Discovery" title="Relevant content and segments" intro="Content that matches their interests, and the dynamic segments they currently fall into.">
        {recommendedContent.length === 0 && recommendedSegments.length === 0 ? (
          <EmptyState title="No personalised recommendations yet">Local discovery falls back to current area content until this reader sets some preferences.</EmptyState>
        ) : (
          <RecordList>
            {recommendedContent.map((item) => (
              <RecordCard key={item.id} title={item.title} lines={[`${formatLabel(item.contentType)} · ${formatLabels(item.relevanceReasons)}`]} />
            ))}
            {recommendedSegments.map((segment) => (
              <RecordCard key={segment.id} title={segment.name} status={segment.status} lines={["Eligible dynamic segment"]} />
            ))}
          </RecordList>
        )}
      </Panel>
    </AppShell>
  );
}

function withSession(href: string, request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  return (request.sessionKey ? `${href}?session=${encodeURIComponent(request.sessionKey)}` : href) as Route;
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
