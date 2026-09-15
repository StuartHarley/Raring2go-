import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { listConnectionCards } from "../../../../../lib/integrations-runtime";
import { ProtectedOutcome } from "../../../../../lib/protected-outcome";
import { ShellAccessError } from "../../../../../lib/app-shell";

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
  const outlookConnection = result.outlookConnections[0];
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

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Email connections</p>
        <h2>Outlook mailbox</h2>
        <p>
          Connect your own Outlook mailbox for personalised outreach sent as you, not for
          bulk newsletters - large sends stay on the network&apos;s dedicated email provider.
        </p>
        {outlookConnection ? (
          <div className="franchise-list">
            <div>
              <strong>{outlookConnection.externalAccountDisplayName}</strong>
              <span>{outlookConnection.status} - {outlookConnection.lastHealthStatus}</span>
              <span>Last checked: {outlookConnection.lastHealthCheckAt ? String(outlookConnection.lastHealthCheckAt) : "not checked"}</span>
              {outlookConnection.lastFailureSummary ? <span>{outlookConnection.lastFailureSummary}</span> : null}
              <form action={`/api/integrations/microsoft/revoke?connectionId=${encodeURIComponent(outlookConnection.id)}`} method="post">
                <button type="submit">Disconnect</button>
              </form>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <strong>Outlook is not connected</strong>
            <p>Connect your Outlook mailbox to send personalised outreach from your own address.</p>
            <a className="button-primary" href={`/api/integrations/microsoft/start?${query.toString()}`}>
              Connect Outlook
            </a>
          </div>
        )}
      </section>
    </AppShell>
  );
}

type ConnectionCards = Awaited<ReturnType<typeof listConnectionCards>>["connections"];

async function loadConnections(
  request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>
): Promise<{ connections: ConnectionCards; outlookConnections: ConnectionCards } | { error: ShellAccessError }> {
  try {
    const [meta, outlook] = await Promise.all([
      listConnectionCards(request, "meta", "facebook_page"),
      listConnectionCards(request, "microsoft", "outlook_mailbox")
    ]);

    return { connections: meta.connections, outlookConnections: outlook.connections };
  } catch (error) {
    if (error instanceof ShellAccessError) {
      return { error };
    }
    throw error;
  }
}
