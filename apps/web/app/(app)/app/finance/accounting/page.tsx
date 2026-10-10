import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { readFinanceConfig } from "../../../../../lib/finance-config-runtime";
import { formatCount, formatDate } from "../../../../../lib/format";
import { Actions, EmptyState, LinkButton, Metrics, Notice, PageHeader, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { retryAccountingSyncAction, setTaxRateAction } from "./actions";
import type { AccountingResult } from "./actions";

export const metadata = { title: "Accounting" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const banners: Record<AccountingResult, { tone: "success" | "error"; text: string }> = {
  rate_saved: { tone: "success", text: "The new rate is saved. It applies to invoices from its start date; the rate it replaces now ends the day before." },
  rate_invalid: { tone: "error", text: "That rate was not saved. Use a lower-case code, a rate from 0 to 100, and a start date after the current rate's start." },
  rate_not_allowed: { tone: "error", text: "You do not have permission to change tax rates." },
  retry_queued: { tone: "success", text: "Queued to be sent to the accounting system again." },
  not_found: { tone: "error", text: "That item was not found." }
};

export default async function AccountingPage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const banner = resultCode && resultCode in banners ? banners[resultCode as AccountingResult] : null;
  const result = await load(request);
  if ("error" in result) {
    if (result.error instanceof ShellAccessError) {
      return (
        <AppShell request={request}>
          <Panel>
            <EmptyState title="Not available">You do not have access to finance configuration.</EmptyState>
          </Panel>
        </AppShell>
      );
    }
    throw result.error;
  }

  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  const queryString = query.size > 0 ? `?${query.toString()}` : "";
  const { counts } = result;

  return (
    <AppShell request={request}>
      <PageHeader
        eyebrow="Finance"
        title="Tax rates and accounting"
        intro="The tax rates your invoices are priced with, and whether every invoice and credit note has reached the accounting system."
        actions={
          <LinkButton href={`/app/finance${queryString}` as Route} variant="secondary">
            Back to finance
          </LinkButton>
        }
      />
      {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}

      <Panel eyebrow="Tax rates" title="Rates by code" intro="Invoices are priced with the rate in force on their issue date. Rates already used are never rewritten: a change starts a new rate.">
        {result.rates.length === 0 ? (
          <EmptyState title="No tax rates yet">Add the first rate below.</EmptyState>
        ) : (
          <RecordList>
            {result.rates.map((rate) => (
              <RecordCard
                key={rate.id}
                title={rate.description || rate.code}
                status={rate.effectiveTo ? "ended" : "current"}
                tone={rate.effectiveTo ? "neutral" : "success"}
                lines={[
                  `${(rate.rateBps / 100).toFixed(2)}% from ${formatDate(rate.effectiveFrom)}${rate.effectiveTo ? ` to ${formatDate(rate.effectiveTo)}` : ""}`,
                  `Code: ${rate.code}`
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="New rate" title="Add a new rate" id="new-rate">
        <form action={setTaxRateAction.bind(null, request)} className="franchise-form">
          <label>Code<input name="code" required maxLength={40} pattern="[a-z][a-z0-9_]{1,40}" placeholder="standard_vat" /></label>
          <label>Description<input name="description" maxLength={120} /></label>
          <label>Rate (%)<input name="ratePercent" type="number" step="0.01" min="0" max="100" required /></label>
          <label>Starts<input name="effectiveFrom" type="date" required /></label>
          <button type="submit" className="r2-button r2-button--primary">Add a new rate</button>
        </form>
      </Panel>

      <Panel
        eyebrow="Accounting hand-off"
        title="Sent to the accounting system"
        intro="Every issued invoice and credit note is sent to the accounting system in the background. Waiting items retry on their own; items that keep failing stop and appear here."
        id="hand-off"
      >
        <Metrics
          items={[
            { label: "Synced", value: counts.synced, tone: "success" },
            { label: "Waiting", value: counts.pending, tone: counts.pending > 0 ? "warning" : "success" },
            { label: "Need attention", value: counts.failed, tone: counts.failed > 0 ? "danger" : "success" }
          ]}
        />
        {result.attention.length === 0 ? (
          <EmptyState title="Nothing is waiting">Every issued invoice and credit note has reached the accounting system.</EmptyState>
        ) : (
          <RecordList>
            {result.attention.map((item) => (
              <RecordCard
                key={item.id}
                title={item.entityType === "advertiser_invoice" ? "Invoice" : "Credit note"}
                status={item.status}
                lines={[
                  formatCount(item.attempts, "attempt"),
                  item.lastError ? `Last error: ${item.lastError}` : null,
                  item.waitingFor ? `Waiting: ${item.waitingFor}` : null
                ]}
              >
                <Actions>
                  <form action={retryAccountingSyncAction.bind(null, request, item.id)}>
                    <button type="submit" className="r2-button r2-button--secondary">Retry now</button>
                  </form>
                </Actions>
              </RecordCard>
            ))}
          </RecordList>
        )}
      </Panel>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "advertiser.tax_rate", action: "manage" });
    return await readFinanceConfig({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
  } catch (error) {
    return { error };
  }
}
