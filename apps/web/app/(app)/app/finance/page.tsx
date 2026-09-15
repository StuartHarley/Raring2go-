import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { listFranchiseSummaries } from "../../../../lib/franchise-runtime";
import {
  readActiveRoyaltyRules,
  readNetworkRoyaltyStatements,
  readOwnFranchiseRoyaltyStatements
} from "../../../../lib/finance-runtime";
import { fixtureIds } from "@raring2go/db";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import {
  addAdjustmentAction,
  approveStatementAction,
  createRoyaltyRuleAction,
  generateStatementAction,
  submitStatementAction
} from "./actions";
import type { RoyaltyRule, RoyaltyStatement } from "@raring2go/finance";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FinancePage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadFinance(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { context, isNetworkView, franchises, rules, networkStatements, ownFranchise, ownStatements } = result;

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Finance</p>
        <h2>Franchise Royalties</h2>
        <p>
          Royalty statements are calculated from booked advertiser revenue and are reproducible from the
          underlying invoices and payments. Adjustments always carry a recorded reason.
        </p>
      </section>

      {isNetworkView ? (
        <>
          <section className="app-panel franchise-panel">
            <p className="eyebrow">Royalty rules</p>
            <h2>Active rules</h2>
            <div className="franchise-list">
              {rules.map((rule) => (
                <div key={rule.id}>
                  <strong>{franchiseName(franchises, rule.franchiseId)}</strong>
                  <span>
                    {(rule.rateBps / 100).toFixed(2)}% of {rule.revenueBasis} revenue, from {rule.effectiveFrom}
                  </span>
                  {rule.minimumDueMinor > 0 ? <span>Minimum due {formatMinor(rule.minimumDueMinor)}</span> : null}
                </div>
              ))}
              {rules.length === 0 ? <p>No active royalty rules yet.</p> : null}
            </div>
            <form action={createRoyaltyRuleAction.bind(null, context)} className="franchise-form">
              <label>
                Franchise
                <select name="franchiseId" required>
                  {franchises.map((franchise) => (
                    <option key={franchise.id} value={franchise.id}>
                      {franchise.primaryTerritoryId}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Revenue basis
                <select name="revenueBasis" defaultValue="collected">
                  <option value="collected">Collected (cash received)</option>
                  <option value="invoiced">Invoiced (net revenue billed)</option>
                </select>
              </label>
              <label>
                Rate (basis points, 800 = 8%)
                <input type="number" name="rateBps" min={0} max={10000} required />
              </label>
              <label>
                Minimum due (£)
                <input type="number" name="minimumDueMinor" min={0} step="0.01" defaultValue={0} />
              </label>
              <label>
                Effective from
                <input type="date" name="effectiveFrom" required />
              </label>
              <label>
                Notes
                <input type="text" name="notes" placeholder="Agreement fee schedule reference" />
              </label>
              <button type="submit">Save rule</button>
            </form>
          </section>

          <section className="app-panel franchise-panel">
            <p className="eyebrow">Generate</p>
            <h2>Generate a royalty statement</h2>
            <form
              action={generateStatementAction.bind(null, context, fixtureIds.organisations.hq)}
              className="franchise-form"
            >
              <label>
                Franchise
                <select name="franchiseId" required>
                  {franchises.map((franchise) => (
                    <option key={franchise.id} value={franchise.id}>
                      {franchise.primaryTerritoryId}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Period start
                <input type="date" name="periodStart" required />
              </label>
              <label>
                Period end
                <input type="date" name="periodEnd" required />
              </label>
              <button type="submit">Generate statement</button>
            </form>
          </section>

          <section className="app-panel franchise-panel">
            <p className="eyebrow">Network</p>
            <h2>Royalty statements</h2>
            <div className="franchise-list">
              {networkStatements.map((statement) => (
                <StatementRow
                  key={statement.id}
                  statement={statement}
                  franchiseLabel={franchiseName(franchises, statement.franchiseId)}
                  context={context}
                />
              ))}
              {networkStatements.length === 0 ? <p>No royalty statements yet.</p> : null}
            </div>
          </section>
        </>
      ) : (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">{ownFranchise?.primaryTerritoryId ?? "Territory"}</p>
          <h2>My royalty statements</h2>
          <div className="franchise-list">
            {ownStatements.map((statement) => (
              <div key={statement.id}>
                <strong>
                  {statement.periodStart} to {statement.periodEnd}
                </strong>
                <span>{statement.statementNumber} - {statement.status}</span>
                <span>
                  Revenue {formatMinor(statement.grossRevenueMinor)}, royalty due {formatMinor(statement.totalDueMinor)}
                </span>
              </div>
            ))}
            {ownStatements.length === 0 ? <p>No royalty statements have been issued yet.</p> : null}
          </div>
        </section>
      )}
    </AppShell>
  );
}

function StatementRow({
  statement,
  franchiseLabel,
  context
}: {
  statement: RoyaltyStatement;
  franchiseLabel: string;
  context: { userId: string; organisationId: string; territoryId?: string };
}) {
  const submit = submitStatementAction.bind(null, context, statement.id);
  const approve = approveStatementAction.bind(null, context, statement.id);
  const adjust = addAdjustmentAction.bind(null, context, statement.id);

  return (
    <div>
      <strong>{franchiseLabel}</strong>
      <span>
        {statement.statementNumber} · {statement.periodStart} to {statement.periodEnd} · {statement.status}
      </span>
      <span>
        Revenue {formatMinor(statement.grossRevenueMinor)}, royalty {formatMinor(statement.calculatedRoyaltyMinor)},
        adjustments {formatMinor(statement.adjustmentsMinor)}, total due {formatMinor(statement.totalDueMinor)}
      </span>
      {statement.status === "draft" || statement.status === "pending_approval" ? (
        <form action={adjust} className="franchise-form">
          <label>
            Adjustment (£, negative to reduce)
            <input type="number" name="amountMinor" step="0.01" required />
          </label>
          <label>
            Reason
            <input type="text" name="reason" required />
          </label>
          <button type="submit">Add adjustment</button>
        </form>
      ) : null}
      {statement.status === "draft" ? (
        <form action={submit}>
          <button type="submit">Submit for approval</button>
        </form>
      ) : null}
      {statement.status === "pending_approval" ? (
        <form action={approve}>
          <button type="submit">Approve</button>
        </form>
      ) : null}
    </div>
  );
}

function franchiseName(franchises: Array<{ id: string; primaryTerritoryId: string }>, franchiseId: string) {
  return franchises.find((franchise) => franchise.id === franchiseId)?.primaryTerritoryId ?? franchiseId;
}

function formatMinor(minor: number) {
  return `£${(minor / 100).toFixed(2)}`;
}

async function loadFinance(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "finance.royalty_statement",
      action: "view"
    });
    const context = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    const isNetworkView = !context.territoryId;
    const franchises = await listFranchiseSummaries(context);

    if (isNetworkView) {
      const [rules, networkStatements] = await Promise.all([
        readActiveRoyaltyRules(context),
        readNetworkRoyaltyStatements(context)
      ]);

      return {
        context,
        isNetworkView,
        franchises,
        rules,
        networkStatements,
        ownFranchise: undefined,
        ownStatements: [] as RoyaltyStatement[]
      };
    }

    const own = await readOwnFranchiseRoyaltyStatements(context);

    return {
      context,
      isNetworkView,
      franchises,
      rules: [] as RoyaltyRule[],
      networkStatements: [] as RoyaltyStatement[],
      ownFranchise: own.franchise,
      ownStatements: own.statements
    };
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
