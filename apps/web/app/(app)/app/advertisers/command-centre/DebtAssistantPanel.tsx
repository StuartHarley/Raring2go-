import type { DebtPanel } from "../../../../../lib/assistants-finance";
import { AiPreparedNote, AssistantBanner } from "../../../../../lib/assistant-ui";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { acceptMatchAction, chaseNotesAction } from "./actions";

const money = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
const basisLabels = { reference_and_amount: "Reference and amount match", exact_amount: "Exact amount", reference: "Reference match", combination: "Combination of invoices", oldest_first_partial: "Part-payment of oldest" } as const;

export function DebtAssistantPanel({ request, panel, resultCode }: { request: RequestedShellContext; panel: DebtPanel; resultCode?: string }) {
  const { ranked, totals, matches, chase } = panel;
  const chaseFor = (invoiceId: string) => chase?.output.accounts.find((account) => account.invoiceId === invoiceId);

  return (
    <section id="debt-assistant" className="app-panel franchise-panel" aria-label="Finance assistant">
      <p className="eyebrow">Finance assistant</p>
      <h2>Who to chase, and payments to match</h2>
      <AssistantBanner code={resultCode} />

      <div className="franchise-metrics">
        {(["1-30", "31-60", "61-90", "90+"] as const).map((bucket) => (
          <article key={bucket}>
            <span>{bucket} days overdue</span>
            <strong>{money(totals[bucket].balanceMinor)}</strong>
            <small>{totals[bucket].count} invoice{totals[bucket].count === 1 ? "" : "s"}</small>
          </article>
        ))}
      </div>

      <div className="table-scroll" aria-label="Overdue invoices by priority">
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Customer</th>
              <th>Invoice</th>
              <th>Outstanding</th>
              <th>Overdue</th>
              <th>Why</th>
              {chase ? <th>Suggested action (AI)</th> : null}
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
                  <td>{debt.daysOverdue} days</td>
                  <td>{debt.reasons.join(" ")}</td>
                  {chase ? <td>{chaseFor(debt.invoiceId)?.suggestedAction ?? "—"}</td> : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="muted">The ranking is calculated from lateness, amount and how each customer has paid before. Nothing is sent from here.</p>
      {chase ? <AiPreparedNote run={{ id: chase.runId, createdAt: chase.createdAt, providerKey: "", approvalState: "not_required" }} /> : null}
      {panel.canAssist && ranked.length > 0 ? (
        panel.aiConfigured ? (
          <form action={chaseNotesAction.bind(null, request)}>
            <button type="submit">{chase ? "Refresh suggested actions" : "Suggest how to chase these"}</button>
          </form>
        ) : (
          <p className="muted">AI suggestions are not switched on for this environment. The ranking above does not need them.</p>
        )
      ) : null}

      <h3>Suggested payment matches</h3>
      <div className="table-scroll" aria-label="Suggested payment matches">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Payment</th>
              <th>Suggested for</th>
              <th>Confidence</th>
              <th>Why</th>
              <th>Action</th>
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
                    <div className="muted">received {match.receivedOn}</div>
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
                        <button type="submit">Allocate</button>
                      </form>
                    ) : (
                      "Needs allocation permission"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="muted">These are suggestions from fixed rules, not AI guesses. Allocating one is the normal audited payment allocation, recorded as coming from a suggestion.</p>
    </section>
  );
}
