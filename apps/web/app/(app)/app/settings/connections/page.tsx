import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { listConnectionCards } from "../../../../../lib/integrations-runtime";
import { ProtectedOutcome } from "../../../../../lib/protected-outcome";
import { ShellAccessError } from "../../../../../lib/app-shell";
import { defaultXeroMapping } from "@raring2go/integrations";

export const metadata = { title: "Connections" };

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
  const xeroConnection = result.xeroConnections[0];
  const stripeConnections = result.stripeConnections;
  const goCardlessConnections = result.goCardlessConnections;
  const bankDetails = result.bankConnections[0]?.providerSafeMetadata as { accountName?: string; sortCode?: string; accountNumber?: string } | undefined;
  const storedMapping = (xeroConnection?.providerSafeMetadata as { mapping?: Partial<typeof defaultXeroMapping> } | undefined)?.mapping;
  const xeroMapping = { salesAccountCode: storedMapping?.salesAccountCode ?? defaultXeroMapping.salesAccountCode, taxTypes: { ...defaultXeroMapping.taxTypes, ...(storedMapping?.taxTypes ?? {}) } };
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

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Accounting</p>
        <h2>Xero</h2>
        <p>
          Connect your franchise&apos;s Xero organisation so every invoice and credit note you issue is sent to your own books automatically.
          Authorise one organisation. Only invoices and credit notes are sent; nothing is read back.
        </p>
        {xeroConnection ? (
          <div className="franchise-list">
            <div>
              <strong>{xeroConnection.externalAccountDisplayName}</strong>
              <span>{xeroConnection.status} - {xeroConnection.lastHealthStatus}</span>
              {xeroConnection.lastFailureSummary ? <span>{xeroConnection.lastFailureSummary}</span> : null}
              <form action={`/api/integrations/xero/mapping?connectionId=${encodeURIComponent(xeroConnection.id)}`} method="post" className="franchise-form">
                <label>Sales account code<input name="salesAccountCode" defaultValue={xeroMapping.salesAccountCode} required maxLength={40} /></label>
                <label>Standard VAT tax type<input name="standardVat" defaultValue={xeroMapping.taxTypes.standard_vat} required maxLength={40} /></label>
                <label>Zero-rated tax type<input name="zeroRated" defaultValue={xeroMapping.taxTypes.zero_rated} required maxLength={40} /></label>
                <label>Exempt tax type<input name="exempt" defaultValue={xeroMapping.taxTypes.exempt} required maxLength={40} /></label>
                <button type="submit">Save mapping</button>
              </form>
              <form action={`/api/integrations/xero/revoke?connectionId=${encodeURIComponent(xeroConnection.id)}`} method="post">
                <button type="submit">Disconnect</button>
              </form>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <strong>Xero is not connected</strong>
            <p>Until it is, issued invoices wait here and are sent as soon as you connect.</p>
            <a className="button-primary" href={`/api/integrations/xero/start?${query.toString()}`}>Connect Xero</a>
          </div>
        )}
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Getting paid</p>
        <h2>Online payments</h2>
        <p>
          Advertisers pay on the provider&apos;s own secure page: card and bank details never reach Raring2go. Money goes straight to the account you connect here.
          Stripe is the default; GoCardless suits bank payments and Direct Debit; bank transfer details are shown for anyone who prefers to pay that way.
        </p>
        {[
          { name: "Stripe", slug: "stripe", cards: stripeConnections, about: "Card payments and more, paid into your own Stripe account." },
          { name: "GoCardless", slug: "gocardless", cards: goCardlessConnections, about: "Bank payments and Direct Debit, paid into your own GoCardless account." }
        ].map((provider) => (
          <div key={provider.slug} className="franchise-list">
            <div>
              <strong>{provider.name}</strong>
              {provider.cards[0] ? (
                <>
                  <span>{provider.cards[0].externalAccountDisplayName} - {provider.cards[0].status}</span>
                  <form action={`/api/integrations/${provider.slug}/revoke?connectionId=${encodeURIComponent(provider.cards[0].id)}`} method="post"><button type="submit">Disconnect</button></form>
                </>
              ) : (
                <>
                  <span>{provider.about}</span>
                  <a className="button-primary" href={`/api/integrations/${provider.slug}/start?${query.toString()}`}>Connect {provider.name}</a>
                </>
              )}
            </div>
          </div>
        ))}
        <form action="/api/integrations/bank-details" method="post" className="franchise-form">
          <h3>Bank transfer details</h3>
          <label>Account name<input name="accountName" required maxLength={60} defaultValue={bankDetails?.accountName} /></label>
          <label>Sort code<input name="sortCode" required inputMode="numeric" maxLength={8} placeholder="12-34-56" defaultValue={bankDetails?.sortCode} /></label>
          <label>Account number<input name="accountNumber" required inputMode="numeric" maxLength={8} defaultValue={bankDetails?.accountNumber} /></label>
          <button type="submit">Save bank details</button>
          <p>Shown to your advertisers with the invoice number as the payment reference.</p>
        </form>
      </section>
    </AppShell>
  );
}

type ConnectionCards = Awaited<ReturnType<typeof listConnectionCards>>["connections"];

async function loadConnections(
  request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>
): Promise<{ connections: ConnectionCards; outlookConnections: ConnectionCards; xeroConnections: ConnectionCards; stripeConnections: ConnectionCards; goCardlessConnections: ConnectionCards; bankConnections: ConnectionCards } | { error: ShellAccessError }> {
  try {
    const [meta, outlook, xero, stripe, goCardless, bank] = await Promise.all([
      listConnectionCards(request, "meta", "facebook_page"),
      listConnectionCards(request, "microsoft", "outlook_mailbox"),
      listConnectionCards(request, "xero", "accounting"),
      listConnectionCards(request, "stripe", "payments"),
      listConnectionCards(request, "gocardless", "payments"),
      listConnectionCards(request, "bank_transfer", "bank_details")
    ]);

    return { connections: meta.connections, outlookConnections: outlook.connections, xeroConnections: xero.connections.filter((connection) => connection.status === "connected"), stripeConnections: stripe.connections.filter((connection) => connection.status === "connected"), goCardlessConnections: goCardless.connections.filter((connection) => connection.status === "connected"), bankConnections: bank.connections };
  } catch (error) {
    if (error instanceof ShellAccessError) {
      return { error };
    }
    throw error;
  }
}
