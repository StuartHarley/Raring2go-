import type { DebtPanel } from "../../../../../lib/assistants-finance";
import { AiPreparedNote, AssistantBanner } from "../../../../../lib/assistant-ui";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { formatCount, formatDate } from "../../../../../lib/format";
import { Metrics, Panel, Table } from "../../../../../lib/page-ui";
import { acceptMatchAction, chaseNotesAction } from "./actions";

const money = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
const basisLabels = { reference_and_amount: "Reference and amount match", exact_amount: "Exact amount", reference: "Reference match", combination: "Combination of invoices", oldest_first_partial: "Part-payment of oldest" } as const;
const buckets = ["1-30", "31-60", "61-90", "90+"] as const;

export function DebtAssistantPanel({ request, panel, resultCode }: { request: RequestedShellContext; panel: DebtPanel; resultCode?: string }) {
  const { ranked, totals, matches, chase } = panel;
  const chaseFor = (invoiceId: string) => chase?.output.accounts.find((account) => account.invoiceId === invoiceId);

  return (
    <>
      <Panel
        id="debt-assistant"
        eyebrow="Finance assistant"
        title="Who to chase"
        intro="The ranking is calculated from lateness, amount and how each customer has paid before. Nothing is sent from here."
      >
        <AssistantBanner code={resultCode} />

        <Metrics
          items={buckets.map((bucket) => ({
            label: `${bucket} days overdue`,
            value: money(totals[bucket].balanceMinor),
            detail: formatCount(totals[bucket].count, "invoice"),
            tone: totals[bucket].count === 0 ? "success" : bucket === "1-30" || bucket === "31-60" ? "warning" : "danger"
          }))}
        />

        <Table caption="Overdue invoices by priority">
          <thead>
            <tr>
              <th scope="col">Priority</th>
              <th scope="col">Customer</th>
              <th scope="col">Invoice</th>
              <th scope="col">Outstanding</th>
              <th scope="col">Overdue</th>
              <th scope="col">Why</th>
              {chase ? <th scope="col">Suggested action (AI)</th> : null}
            </tr>
          </thead>
          <tbody>
            {ranked.length === 0 ? (
              <tr>
                <td colSpan={chase ? 7 : 6}>Nothing is overdue.</td>
              </tr>
            ) : (
              ranked.map((debt, index) => (
                <tr key={debt.invoiceId}>
                  <td>{index + 1}</td>
                  <td>{debt.customerName}</td>
                  <td>{debt.invoiceNumber}</td>
                  <td>{money(debt.balanceMinor)}</td>
                  <td>{formatCount(debt.daysOverdue, "day")}</td>
                  <td>{debt.reasons.join(" ")}</td>
                  {chase ? <td>{chaseFor(debt.invoiceId)?.suggestedAction ?? "—"}</td> : null}
                </tr>
              ))
            )}
          </tbody>
        </Table>
        {chase ? <AiPreparedNote run={{ id: chase.runId, createdAt: chase.createdAt, providerKey: "", approvalState: "not_required" }} /> : null}
        {panel.canAssist && ranked.length > 0 ? (
          panel.aiConfigured ? (
            <form action={chaseNotesAction.bind(null, request)}>
              <button type="submit" className="r2-button r2-button--secondary">{chase ? "Refresh suggested actions" : "Suggest how to chase these"}</button>
            </form>
          ) : (
            <p className="muted">AI suggestions are not switched on for this environment. The ranking above does not need them.</p>
          )
        ) : null}
      </Panel>

      <Panel
        eyebrow="Finance assistant"
        title="Payments to match"
        intro="These are suggestions from fixed rules, not AI guesses. Allocating one is the normal audited payment allocation, recorded as coming from a suggestion."
      >
        <Table caption="Suggested payment matches">
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Payment</th>
              <th scope="col">Suggested for</th>
              <th scope="col">Confidence</th>
              <th scope="col">Why</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {matches.length === 0 ? (
              <tr>
                <td colSpan={6}>No unallocated payments.</td>
              </tr>
            ) : (
              matches.map((match) => (
                <tr key={match.paymentId}>
                  <td>{match.customerName}</td>
                  <td>
                    {money(match.amountMinor)}
                    <div className="muted">Received {formatDate(match.receivedOn)}</div>
                  </td>
                  <td>
                    {match.allocations.map((allocation) => `${allocation.invoiceNumber} (${money(allocation.amountMinor)})`).join(", ")}
                    {match.leavesUnallocatedMinor > 0 ? <div className="muted">{money(match.leavesUnallocatedMinor)} would remain unallocated</div> : null}
                  </td>
                  <td>
                    {Math.round(match.confidence * 100)}%<div className="muted">{basisLabels[match.basis]}</div>
                  </td>
                  <td>{match.reasons.join(" ")}</td>
                  <td>
                    {panel.canAllocate ? (
                      <form action={acceptMatchAction.bind(null, request, match.paymentId)}>
                        <button type="submit" className="r2-button r2-button--secondary">Allocate</button>
                      </form>
                    ) : (
                      "Needs allocation permission"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
