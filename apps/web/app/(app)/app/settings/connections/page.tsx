import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { listConnectionCards } from "../../../../../lib/integrations-runtime";
import { ProtectedOutcome } from "../../../../../lib/protected-outcome";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ConnectionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const result = await loadConnections(request);

  if ("error" in result) {
    return <ProtectedOutcome outcome={result.error} />;
  }

  const connection = result.connections[0];
  const query = new URLSearchParams();
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  query.set("returnTo", "/app/settings/connections");

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Settings</p>
        <h2>Connections</h2>
        <p>
          Connect provider accounts for approved operational workflows without
          exposing provider credentials to normal records or users.
        </p>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Social connections</p>
        <h2>Facebook Page</h2>
        {connection ? (
          <div className="franchise-list">
            <div>
              <strong>{connection.externalAccountDisplayName}</strong>
              <span>{connection.status} - {connection.lastHealthStatus}</span>
              <span>Last checked: {connection.lastHealthCheckAt ? String(connection.lastHealthCheckAt) : "not checked"}</span>
              {connection.lastFailureSummary ? <span>{connection.lastFailureSummary}</span> : null}
              <form action={`/api/integrations/meta/revoke?connectionId=${encodeURIComponent(connection.id)}`} method="post">
                <button type="submit">Disconnect</button>
              </form>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <strong>Facebook is not connected</strong>
            <p>Connect a Facebook Page so approved Raring2go content can publish from the Social queue.</p>
            <a className="button-primary" href={`/api/integrations/meta/start?${query.toString()}`}>
              Connect Facebook
            </a>
          </div>
        )}
      </section>
    </AppShell>
  );
}

async function loadConnections(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    return await listConnectionCards(request);
  } catch (error) {
    if (error && typeof error === "object" && "kind" in error) {
      return { error: error as never };
    }
    throw error;
  }
}
