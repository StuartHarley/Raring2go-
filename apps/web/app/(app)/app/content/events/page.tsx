import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { hasEventCapability, listDiscoverableTerritories, readEventSuggestions } from "../../../../../lib/publishing-runtime";
import { Breadcrumbs, StatusBadge } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { approveSuggestionAction, discoverEventsAction, rejectSuggestionAction } from "./actions";
import { DiscoverForm } from "./DiscoverForm";
import { getPermissionData } from "../../../../../lib/permission-source";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUSES = ["pending", "approved", "rejected"] as const;
const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  approved: { tone: "success", text: "Approved. A draft event was created in Content Studio; it is not published." },
  rejected: { tone: "success", text: "Rejected. It will not be suggested again." },
  not_allowed: { tone: "error", text: "You do not have permission to action that suggestion." },
  wrong_state: { tone: "error", text: "That suggestion has already been decided. Refresh to see the latest." }
};

const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/London" });

export default async function EventDiscoveryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const statusParam = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = STATUSES.find((candidate) => candidate === statusParam) ?? "pending";
  const result = await load(request, status);

  if ("error" in result) {
    return protectedOutcome(result.error);
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

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Content Studio</p>
        <h2>Event discovery</h2>
        <p>
          Finds local family events for a territory and date range, each with its source link and context. Nothing is
          published automatically: approving a suggestion creates a <strong>draft</strong> event for the normal review steps.
        </p>
        {banner ? (
          <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>{banner.text}</p>
        ) : null}
        {canDiscover ? <DiscoverForm action={discoverEventsAction.bind(null, request)} territories={territories} defaultFrom={defaultFrom} defaultTo={defaultTo} /> : null}
        <nav className="filter-tabs" aria-label="Filter suggestions">
          {STATUSES.map((value) => (
            <Link key={value} href={tab(value)} aria-current={status === value ? "page" : undefined}>{value}</Link>
          ))}
        </nav>
      </section>

      <section className="app-panel franchise-panel" aria-label="Suggestions">
        <p className="eyebrow">Queue</p>
        <h2>{status === "pending" ? "Awaiting your decision" : `${status[0]!.toUpperCase()}${status.slice(1)} suggestions`}</h2>
        <div className="franchise-list">
          {suggestions.length === 0 ? (
            <div>
              <strong>{status === "pending" ? "Nothing waiting. Run a search above." : `No ${status} suggestions.`}</strong>
            </div>
          ) : (
            suggestions.map((suggestion) => (
              <div key={suggestion.id}>
                <strong>{suggestion.title}</strong>
                <span>
                  {fmt.format(suggestion.startsAt)}
                  {suggestion.venue ? ` · ${suggestion.venue}` : ""} · {territoryName.get(suggestion.territoryId) ?? "Territory"}
                </span>
                {suggestion.summary ? <span>{suggestion.summary}</span> : null}
                <span>
                  Source:{" "}
                  <a href={suggestion.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{new URL(suggestion.sourceUrl).hostname}</a>
                  {" — "}
                  {suggestion.sourceContext}
                </span>
                <span><StatusBadge status={suggestion.status === "pending" ? "paused" : suggestion.status === "approved" ? "completed" : "failed"} /></span>
                {suggestion.status === "pending" && canDecide ? (
                  <form className="franchise-form">
                    <label>
                      Note (optional)
                      <input name="note" maxLength={500} />
                    </label>
                    <div className="franchise-actions">
                      <button type="submit" formAction={approveSuggestionAction.bind(null, request, suggestion.id)}>Approve as draft event</button>
                      <button type="submit" formAction={rejectSuggestionAction.bind(null, request, suggestion.id)}>Reject</button>
                    </div>
                  </form>
                ) : null}
                {suggestion.contentItemId ? <Link href={`/app/content/${suggestion.contentItemId}` as Route}>Open draft event</Link> : null}
              </div>
            ))
          )}
        </div>
      </section>
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
