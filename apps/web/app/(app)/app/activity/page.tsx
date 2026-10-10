import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { parseAuditFilters, readAuditEvents } from "../../../../lib/audit-runtime";
import { getDirectory } from "../../../../lib/directory";
import { formatCode, formatDateTime, formatLabel } from "../../../../lib/format";
import { Actions, EmptyState, LinkButton, PageHeader, Panel, Table } from "../../../../lib/page-ui";
import { protectedOutcome } from "../../../../lib/protected-outcome";
import { requestFromSearchParamsAndCookies } from "../page";

export const metadata = { title: "Audit trail" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** "advertiser.invoice.created" → "Advertiser invoice created": dotted action codes read as words. */

export default async function ActivityPage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);

  try {
    await requireShellPermission(request, {
      module: "system",
      action: "administer"
    });
  } catch (error) {
    return protectedOutcome(error);
  }

  const filters = parseAuditFilters(search);
  const { events, nextCursor } = await readAuditEvents(filters);
  const carried = new URLSearchParams();
  if (request.sessionKey) carried.set("session", request.sessionKey);
  if (request.organisationId) carried.set("organisationId", request.organisationId);
  if (request.territoryId) carried.set("territoryId", request.territoryId);
  const filterParams = new URLSearchParams(carried);
  for (const [key, value] of [["action", filters.actionPrefix], ["entity", filters.entityType], ["actor", filters.actorUserId], ["territory", filters.territoryId], ["from", filters.from], ["to", filters.to]] as const) {
    if (value) filterParams.set(key, value);
  }
  const olderParams = new URLSearchParams(filterParams);
  if (nextCursor) olderParams.set("before", nextCursor);
  const scopeNames = await resolveScopeNames(events);
  const filtering = Boolean(filters.actionPrefix || filters.entityType || filters.actorUserId || filters.territoryId || filters.from || filters.to);

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Audit trail"
        intro="Who changed what, and when: a read-only trail of the system, security, franchise, commercial, publishing and marketing actions that matter."
      />

      <Panel eyebrow="Filter" title="Narrow the trail" intro="Action and entity match the audit codes shown in the table; actor and territory take an id.">
        <form method="get" className="franchise-form">
          {[...carried].map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <label>
            Action starts with
            <input name="action" defaultValue={filters.actionPrefix} placeholder="advertiser." maxLength={80} />
          </label>
          <label>
            Entity type
            <input name="entity" defaultValue={filters.entityType} placeholder="advertiser_invoice" maxLength={80} />
          </label>
          <label>
            Actor (user id)
            <input name="actor" defaultValue={filters.actorUserId} maxLength={36} />
          </label>
          <label>
            Territory (id)
            <input name="territory" defaultValue={filters.territoryId} maxLength={36} />
          </label>
          <label>
            From
            <input name="from" type="date" defaultValue={filters.from} />
          </label>
          <label>
            To
            <input name="to" type="date" defaultValue={filters.to} />
          </label>
          <Actions>
            <button type="submit" className="r2-button r2-button--primary">
              Apply filters
            </button>
          </Actions>
        </form>
      </Panel>

      <Panel eyebrow="Trail" title="Recent events">
        {events.length === 0 ? (
          <EmptyState title={filtering ? "No events match these filters" : "No events recorded yet"}>
            {filtering ? "Widen the date range or clear a filter to see more of the trail." : "Events appear here as soon as something auditable happens."}
          </EmptyState>
        ) : (
          <Table caption="Audit events, newest first">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">Entity</th>
                <th scope="col">Scope</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.createdAt)}</td>
                  <td>
                    {formatCode(event.action)}
                    <br />
                    <small>
                      <code>{event.action}</code>
                    </small>
                  </td>
                  <td>
                    {formatLabel(event.entityType)}
                    {event.entityId ? (
                      <>
                        <br />
                        <small>
                          <code>{event.entityId}</code>
                        </small>
                      </>
                    ) : null}
                  </td>
                  <td>{scopeNames.get(event.territoryId ?? event.organisationId ?? "") ?? (event.territoryId || event.organisationId ? "Unknown scope" : "System")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {nextCursor ? (
          <Actions>
            <LinkButton href={`/app/activity?${olderParams.toString()}` as Route} variant="secondary">
              Older events
            </LinkButton>
          </Actions>
        ) : null}
      </Panel>
    </>
  );
}

/** Territory and organisation names for the scope column, looked up once per distinct id. */
async function resolveScopeNames(events: Array<{ territoryId: string | null; organisationId: string | null }>) {
  const directory = getDirectory();
  const territoryIds = [...new Set(events.map((event) => event.territoryId).filter((id): id is string => Boolean(id)))];
  const organisationIds = [...new Set(events.filter((event) => !event.territoryId).map((event) => event.organisationId).filter((id): id is string => Boolean(id)))];
  const names = await Promise.all([
    ...territoryIds.map(async (id) => [id, await directory.territoryName(id)] as const),
    ...organisationIds.map(async (id) => [id, await directory.organisationName(id)] as const)
  ]);
  return new Map(names.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
}
