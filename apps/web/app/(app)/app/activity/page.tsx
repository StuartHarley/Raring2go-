import { requireShellPermission } from "../../../../lib/app-shell";
import { readRecentAuditEvents } from "../../../../lib/audit-runtime";
import { protectedOutcome } from "../../../../lib/protected-outcome";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ActivityPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);

  try {
    await requireShellPermission(request, {
      module: "system",
      action: "administer"
    });
  } catch (error) {
    return protectedOutcome(error);
  }

  const events = await readRecentAuditEvents();

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

      <section className="app-panel audit-table" aria-label="Recent audit events">
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
        </div>
      </section>
    </AppShell>
  );
}
