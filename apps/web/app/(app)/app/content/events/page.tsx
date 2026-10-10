import Link from "next/link";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { hasEventCapability, listDiscoverableTerritories, readEventSuggestions } from "../../../../../lib/publishing-runtime";
import { formatDateTime, formatLabel } from "../../../../../lib/format";
import { Actions, EmptyState, FilterTabs, Notice, PageHeader, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { approveSuggestionAction, discoverEventsAction, rejectSuggestionAction } from "./actions";
import { DiscoverForm } from "./DiscoverForm";
import { getPermissionData } from "../../../../../lib/permission-source";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Event discovery" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUSES = ["pending", "approved", "rejected"] as const;
const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  approved: { tone: "success", text: "Approved. A draft event was created in Content Studio; it is not published." },
  rejected: { tone: "success", text: "Rejected. It will not be suggested again." },
  not_allowed: { tone: "error", text: "You do not have permission to action that suggestion." },
  wrong_state: { tone: "error", text: "That suggestion has already been decided. Refresh to see the latest." }
};

export default async function EventDiscoveryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const statusParam = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = STATUSES.find((candidate) => candidate === statusParam) ?? "pending";
  const result = await load(request, status);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const { suggestions, canDiscover, territories, canDecide } = result;
  const resultParam = Array.isArray(params.result) ? params.result[0] : params.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const today = new Date();
  const defaultFrom = today.toISOString().slice(0, 10);
  const defaultTo = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const territoryName = new Map<string, string>(territories.map((territory) => [territory.id, territory.name]));
  const base = new URLSearchParams();
  if (request.sessionKey) base.set("session", request.sessionKey);
  if (request.organisationId) base.set("organisationId", request.organisationId);
  if (request.territoryId) base.set("territoryId", request.territoryId);
  const tab = (value: string) => {
    const query = new URLSearchParams(base);
    query.set("status", value);
    return `/app/content/events?${query.toString()}` as Route;
  };

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Content Studio", href: "/app/content" as Route }, { label: "Event discovery" }]} />

      <PageHeader
        eyebrow="Content Studio"
        title="Event discovery"
        intro="Find local family events for a territory and date range, each with its source link. Nothing is published automatically: approving a suggestion creates a draft event for the normal review steps."
      />

      {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}

      {canDiscover ? (
        <Panel eyebrow="Search" title="Find events">
          <DiscoverForm action={discoverEventsAction.bind(null, request)} territories={territories} defaultFrom={defaultFrom} defaultTo={defaultTo} />
        </Panel>
      ) : null}

      <Panel eyebrow="Queue" title={status === "pending" ? "Awaiting your decision" : `${formatLabel(status)} suggestions`}>
        <FilterTabs label="Filter suggestions" items={STATUSES.map((value) => ({ label: formatLabel(value), href: tab(value), current: status === value }))} />
        {suggestions.length === 0 ? (
          <EmptyState title={status === "pending" ? "Nothing waiting" : `No ${status} suggestions`}>
            {status === "pending" ? (canDiscover ? "Run a search above to find events for a territory." : "Suggestions found by a search will appear here.") : "Suggestions you decide on will appear here."}
          </EmptyState>
        ) : (
          <RecordList>
            {suggestions.map((suggestion) => (
              <RecordCard
                key={suggestion.id}
                title={suggestion.title}
                status={suggestion.status}
                lines={[
                  `${formatDateTime(suggestion.startsAt)}${suggestion.venue ? ` · ${suggestion.venue}` : ""} · ${territoryName.get(suggestion.territoryId) ?? "Territory"}`,
                  suggestion.summary,
                  <>
                    Source:{" "}
                    <a href={suggestion.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{new URL(suggestion.sourceUrl).hostname}</a>
                    {" — "}
                    {suggestion.sourceContext}
                  </>
                ]}
              >
                {suggestion.status === "pending" && canDecide ? (
                  <form className="franchise-form">
                    <label>
                      Note (optional)
                      <input name="note" maxLength={500} />
                    </label>
                    <Actions>
                      <button type="submit" className="r2-button r2-button--primary" formAction={approveSuggestionAction.bind(null, request, suggestion.id)}>Approve as draft event</button>
                      <button type="submit" className="r2-button r2-button--secondary" formAction={rejectSuggestionAction.bind(null, request, suggestion.id)}>Reject</button>
                    </Actions>
                  </form>
                ) : null}
                {suggestion.contentItemId ? <Link href={`/app/content/${suggestion.contentItemId}` as Route}>Open draft event</Link> : null}
              </RecordCard>
            ))}
          </RecordList>
        )}
      </Panel>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, status: (typeof STATUSES)[number]) {
  try {
    const shell = await requireShellPermission(request, { module: "content.event_suggestion", action: "view" });
    const actor = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const permissions = await getPermissionData();
    const suggestions = await readEventSuggestions(actor, status);
    return { suggestions, canDiscover: hasEventCapability(permissions, actor, "discover"), canDecide: hasEventCapability(permissions, actor, "decide"), territories: await listDiscoverableTerritories(actor) };
  } catch (error) {
    return { error };
  }
}
