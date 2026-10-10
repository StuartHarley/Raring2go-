import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { readAudienceOverview } from "../../../../lib/marketing-runtime";
import { formatCount, formatLabel } from "../../../../lib/format";
import { EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordLink, RecordList } from "../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../page";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Audience" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AudiencePage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadAudience(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { totals, contacts } = result.audience;
  const query = contextQuery(request);

  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Audience"
        intro="The parents and readers on your mailing lists: who is subscribed, who must not be emailed, and which areas they follow."
        actions={
          <>
            <LinkButton href={"/app/audience/import" as Route}>Import contacts</LinkButton>
            <LinkButton href={"/app/audience/segments" as Route} variant="secondary">
              Segments
            </LinkButton>
          </>
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Contacts", value: totals.contacts },
            { label: "Subscribed", value: totals.subscribed, tone: totals.subscribed > 0 ? "success" : "neutral" },
            { label: "Suppressed", value: totals.suppressed, detail: "Must not be emailed", tone: totals.suppressed > 0 ? "warning" : "neutral" },
            { label: "Areas followed", value: totals.territories }
          ]}
        />
      </Panel>

      <Panel eyebrow="Contacts" title="All contacts" intro="Open a contact to see their preferences and subscriptions.">
        {contacts.length === 0 ? (
          <EmptyState title="No contacts yet">Import a list to get started, or wait for sign-ups to arrive from the website.</EmptyState>
        ) : (
          <RecordList>
            {contacts.map((view) => {
              const name = [view.contact.firstName, view.contact.lastName].filter(Boolean).join(" ");
              const suppressed = view.suppressions.some((suppression) => suppression.active);
              return (
                <RecordLink
                  key={view.contact.id}
                  href={`/app/preferences?${withContact(query, view.contact.id)}` as Route}
                  title={name || view.contact.email}
                  status={suppressed ? "suppressed" : view.contact.emailStatus}
                  tone={suppressed ? "danger" : undefined}
                  lines={[
                    name ? view.contact.email : null,
                    `${formatCount(view.subscriptions.length, "area subscription")} · Email ${formatLabel(view.contact.emailStatus).toLowerCase()}`,
                    suppressed ? "Suppressed: will not be emailed" : "Eligible if consent and segment allow"
                  ]}
                />
              );
            })}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

function contextQuery(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  return query;
}

function withContact(query: URLSearchParams, contactId: string) {
  const next = new URLSearchParams(query);
  next.set("contact", contactId);
  return next.toString();
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
