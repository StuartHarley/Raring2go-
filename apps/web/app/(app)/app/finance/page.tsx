import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { getDirectory } from "../../../../lib/directory";
import { listFranchiseSummaries } from "../../../../lib/franchise-runtime";
import {
  readActiveRoyaltyRules,
  readNetworkRoyaltyStatements,
  readOwnFranchiseRoyaltyStatements
} from "../../../../lib/finance-runtime";
import { readRoyaltyPanel } from "../../../../lib/assistants-finance";
import { displayName, formatDate, formatLabel } from "../../../../lib/format";
import { Actions, EmptyState, LinkButton, PageHeader, Panel, RecordCard, RecordList } from "../../../../lib/page-ui";
import { RoyaltyReviewPanel } from "./RoyaltyReviewPanel";
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
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Royalties" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type TerritoryNames = Map<string, string | undefined>;

export default async function FinancePage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const result = await loadFinance(request);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const { context, isNetworkView, franchises, territoryNames, rules, networkStatements, ownFranchise, ownStatements } = result;
  const sessionQuery = request.sessionKey ? `?session=${encodeURIComponent(request.sessionKey)}` : "";
  const nameOf = (franchiseId: string) => franchiseName(franchises, territoryNames, franchiseId);

  return (
    <AppShell request={request}>
      <PageHeader
        eyebrow="Finance"
        title="Royalties"
        intro="Royalty statements worked out from booked advertiser revenue. Every figure traces back to the invoices and payments behind it, and every adjustment carries a reason."
        actions={
          <>
            <LinkButton href={`/app/finance/payments${sessionQuery}` as Route}>Online payments</LinkButton>
            {isNetworkView ? (
              <LinkButton href={`/app/finance/accounting${sessionQuery}` as Route} variant="secondary">
                Tax rates and accounting
              </LinkButton>
            ) : null}
          </>
        }
      />

      {isNetworkView && result.royaltyReview ? <RoyaltyReviewPanel request={request} panel={result.royaltyReview} resultCode={resultCode} sessionQuery={sessionQuery} /> : null}

      {isNetworkView ? (
        <>
          <Panel eyebrow="Royalty rules" title="Active rules" intro="How each franchise's royalty is worked out: the rate, what it applies to and when it started.">
            {rules.length === 0 ? (
              <EmptyState title="No royalty rules yet">Add the first rule below to set how each franchise royalty is worked out.</EmptyState>
            ) : (
              <RecordList>
                {rules.map((rule) => (
                  <RecordCard
                    key={rule.id}
                    title={nameOf(rule.franchiseId)}
                    status={rule.status}
                    lines={[
                      `${(rule.rateBps / 100).toFixed(2)}% of ${formatLabel(rule.revenueBasis).toLowerCase()} revenue, from ${formatDate(rule.effectiveFrom)}`,
                      rule.minimumDueMinor > 0 ? `Minimum due ${formatMinor(rule.minimumDueMinor)}` : null
                    ]}
                  />
                ))}
              </RecordList>
            )}
          </Panel>

          <Panel eyebrow="New rule" title="Add a royalty rule" id="new-rule">
            <form action={createRoyaltyRuleAction.bind(null, context)} className="franchise-form">
              <label>
                Franchise
                <select name="franchiseId" required>
                  {franchises.map((franchise) => (
                    <option key={franchise.id} value={franchise.id}>
                      {nameOf(franchise.id)}
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
              <button type="submit" className="r2-button r2-button--primary">
                Save rule
              </button>
            </form>
          </Panel>

          <Panel eyebrow="Generate" title="Generate a royalty statement" id="generate">
            <form action={generateStatementAction.bind(null, context)} className="franchise-form">
              <label>
                Franchise
                <select name="franchiseId" required>
                  {franchises.map((franchise) => (
                    <option key={franchise.id} value={franchise.id}>
                      {nameOf(franchise.id)}
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
              <button type="submit" className="r2-button r2-button--primary">
                Generate statement
              </button>
            </form>
          </Panel>

          <Panel eyebrow="Network" title="Royalty statements" id="statements">
            {networkStatements.length === 0 ? (
              <EmptyState title="No royalty statements yet">Generate the first one above for a franchise with an active rule.</EmptyState>
            ) : (
              <RecordList>
                {networkStatements.map((statement) => (
                  <StatementRow key={statement.id} statement={statement} franchiseLabel={nameOf(statement.franchiseId)} context={context} />
                ))}
              </RecordList>
            )}
          </Panel>
        </>
      ) : (
        <Panel eyebrow={displayName(ownFranchise ? territoryNames.get(ownFranchise.primaryTerritoryId) : undefined, "Territory")} title="Your royalty statements" id="statements">
          {ownStatements.length === 0 ? (
            <EmptyState title="No royalty statements yet">Head Office issues statements from your booked advertiser revenue; they appear here once generated.</EmptyState>
          ) : (
            <RecordList>
              {ownStatements.map((statement) => (
                <RecordCard
                  key={statement.id}
                  title={`${formatDate(statement.periodStart)} to ${formatDate(statement.periodEnd)}`}
                  status={statement.status}
                  lines={[
                    statement.statementNumber,
                    `Revenue ${formatMinor(statement.grossRevenueMinor)} · royalty due ${formatMinor(statement.totalDueMinor)}`
                  ]}
                />
              ))}
            </RecordList>
          )}
        </Panel>
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
    <RecordCard
      title={franchiseLabel}
      status={statement.status}
      lines={[
        `${statement.statementNumber} · ${formatDate(statement.periodStart)} to ${formatDate(statement.periodEnd)}`,
        `Revenue ${formatMinor(statement.grossRevenueMinor)} · royalty ${formatMinor(statement.calculatedRoyaltyMinor)} · adjustments ${formatMinor(statement.adjustmentsMinor)} · total due ${formatMinor(statement.totalDueMinor)}`
      ]}
    >
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
          <button type="submit" className="r2-button r2-button--secondary">
            Add adjustment
          </button>
        </form>
      ) : null}
      {statement.status === "draft" ? (
        <Actions>
          <form action={submit}>
            <button type="submit" className="r2-button r2-button--primary">
              Submit for approval
            </button>
          </form>
        </Actions>
      ) : null}
      {statement.status === "pending_approval" ? (
        <Actions>
          <form action={approve}>
            <button type="submit" className="r2-button r2-button--primary">
              Approve
            </button>
          </form>
        </Actions>
      ) : null}
    </RecordCard>
  );
}

function franchiseName(franchises: Array<{ id: string; primaryTerritoryId: string }>, territoryNames: TerritoryNames, franchiseId: string) {
  const territoryId = franchises.find((franchise) => franchise.id === franchiseId)?.primaryTerritoryId;
  return displayName(territoryId ? territoryNames.get(territoryId) : undefined, "Territory not named yet");
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
    const territoryNames = await territoryNamesFor(franchises);

    if (isNetworkView) {
      const [rules, networkStatements] = await Promise.all([
        readActiveRoyaltyRules(context),
        readNetworkRoyaltyStatements(context)
      ]);

      // The assistant never stops the page loading.
      const royaltyReview = await readRoyaltyPanel(context).catch(() => undefined);

      return {
        context,
        isNetworkView,
        franchises,
        territoryNames,
        rules,
        networkStatements,
        royaltyReview,
        ownFranchise: undefined,
        ownStatements: [] as RoyaltyStatement[]
      };
    }

    const own = await readOwnFranchiseRoyaltyStatements(context);

    return {
      context,
      isNetworkView,
      franchises,
      territoryNames,
      royaltyReview: undefined,
      rules: [] as RoyaltyRule[],
      networkStatements: [] as RoyaltyStatement[],
      ownFranchise: own.franchise,
      ownStatements: own.statements
    };
  } catch (error) {
    return { error };
  }
}

/** Territory names for the franchises on screen, so a franchise is never labelled by its territory id. */
async function territoryNamesFor(franchises: Array<{ primaryTerritoryId: string }>): Promise<TerritoryNames> {
  const directory = getDirectory();
  const ids = [...new Set(franchises.map((franchise) => franchise.primaryTerritoryId))];
  return new Map(await Promise.all(ids.map(async (id) => [id, await directory.territoryName(id).catch(() => undefined)] as const)));
}
