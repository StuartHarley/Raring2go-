import { requireShellPermission } from "../../../../lib/app-shell";
import { parseAuditFilters, readAuditEvents } from "../../../../lib/audit-runtime";
import { protectedOutcome } from "../../../../lib/protected-outcome";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

export const metadata = { title: "Audit activity" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ActivityPage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);

  try {
    await requireShellPermission(request, {
      module: "system",
      action: "administer"
    });
  } catch (error) {
    return protectedOutcome(error, request);
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

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Audit activity</p>
        <h2>Recent platform events</h2>
        <p>
          Read-only operational audit visibility for high-value system, security,
          franchise, commercial, publishing and marketing actions.
        </p>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Filter</p>
        <form method="get" className="franchise-form">
          {[...carried].map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
          <label>Action starts with<input name="action" defaultValue={filters.actionPrefix} placeholder="advertiser." maxLength={80} /></label>
          <label>Entity type<input name="entity" defaultValue={filters.entityType} placeholder="advertiser_invoice" maxLength={80} /></label>
          <label>Actor (user id)<input name="actor" defaultValue={filters.actorUserId} maxLength={36} /></label>
          <label>Territory (id)<input name="territory" defaultValue={filters.territoryId} maxLength={36} /></label>
          <label>From<input name="from" type="date" defaultValue={filters.from} /></label>
          <label>To<input name="to" type="date" defaultValue={filters.to} /></label>
          <button type="submit">Apply filters</button>
        </form>
      </section>

      <section className="app-panel audit-table" aria-label="Audit events">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Scope</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.createdAt).toLocaleString("en-GB")}</td>
                  <td>{event.action}</td>
                  <td>{event.entityType}{event.entityId ? `:${event.entityId}` : ""}</td>
                  <td>{event.territoryId ?? event.organisationId ?? "system"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 ? <p>No events match.</p> : null}
        </div>
        {nextCursor ? <a href={`/app/activity?${olderParams.toString()}`} className="app-link-button">Older events</a> : null}
      </section>
    </AppShell>
  );
}
