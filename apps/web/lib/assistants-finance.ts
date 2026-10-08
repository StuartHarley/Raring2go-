import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "@raring2go/audit";
import { allocatePayment, listAdvertisers, loadAdvertisingData, persistAdvertisingChanges, snapshotAdvertisingData } from "@raring2go/advertising";
import type { AdvertisingActorContext } from "@raring2go/advertising";
import { agedDebtTotals, chaseNotesTask, detectRoyaltyAnomalies, rankAgedDebt, royaltyNotesTask, suggestPaymentMatches } from "@raring2go/assistants";
import type { ChaseNotesOutput, MatchSuggestion, PaymentHistory, RankedDebt, RoyaltyAnomaly, RoyaltyNotesOutput } from "@raring2go/assistants";
import { createDb } from "@raring2go/db";
import { evaluatePermission } from "@raring2go/permissions";
import { assistantsConfigured, latestAssistantOutput, runAssistant } from "./assistants-runtime";
import type { AssistantActor } from "./assistants-runtime";
import { readNetworkRoyaltyStatements } from "./finance-runtime";
import { getDirectory } from "./directory";
import { getPermissionData } from "./permission-source";

const subjectFor = (actor: AssistantActor): { type: string; id: string } => ({ type: "debt_portfolio", id: actor.territoryId ?? "network" });
const today = () => new Date().toISOString().slice(0, 10);

/** Everything below is computed from invoices and payments the actor is allowed to see (loaded through the advertising service). */
async function loadVisibleFinance(actor: AdvertisingActorContext) {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();
  try {
    const data = await loadAdvertisingData(db);
    const rows = listAdvertisers(actor, permissions, data); // enforces advertiser.view and the actor's territory scope
    const visible = new Set(rows.map((row) => row.advertiser.id));
    const nameOf = new Map(rows.map((row) => [row.advertiser.id, row.organisation.name]));
    return { data, rows, visible, nameOf };
  } finally {
    await sql.end();
  }
}

function paymentHistory(data: Awaited<ReturnType<typeof loadVisibleFinance>>["data"], visible: Set<string>): Record<string, PaymentHistory> {
  const lastPaid = new Map<string, string>();
  for (const allocation of data.paymentAllocations) {
    const current = lastPaid.get(allocation.invoiceId);
    if (!current || allocation.allocatedAt > current) lastPaid.set(allocation.invoiceId, allocation.allocatedAt);
  }
  const history: Record<string, PaymentHistory> = {};
  for (const invoice of data.invoices) {
    if (!visible.has(invoice.advertiserId) || invoice.status !== "paid" || !invoice.dueDate) continue;
    const paidOn = lastPaid.get(invoice.id);
    if (!paidOn) continue;
    const entry = (history[invoice.advertiserId] ??= { paidOnTime: 0, paidLate: 0 });
    if (paidOn.slice(0, 10) > invoice.dueDate) entry.paidLate += 1;
    else entry.paidOnTime += 1;
  }
  return history;
}

export type DebtPanel = {
  ranked: RankedDebt[];
  totals: ReturnType<typeof agedDebtTotals>;
  matches: Array<MatchSuggestion & { customerName: string; amountMinor: number; receivedOn: string }>;
  chase?: { runId: string; createdAt: Date; output: ChaseNotesOutput };
  canAssist: boolean;
  canAllocate: boolean;
  aiConfigured: boolean;
};

export async function readDebtPanel(actor: AssistantActor): Promise<DebtPanel> {
  const { data, visible, nameOf } = await loadVisibleFinance(actor);
  const permissions = await getPermissionData();
  const can = (module: string, action: string) =>
    evaluatePermission({ userId: actor.userId, module, action, context: { organisationId: actor.organisationId ?? undefined, territoryId: actor.territoryId ?? undefined } }, permissions).allowed;

  const invoices = data.invoices.filter((invoice) => visible.has(invoice.advertiserId) && !invoice.deletedAt && ["issued", "part_paid"].includes(String(invoice.status)));
  const ranked = rankAgedDebt(
    invoices.map((invoice) => ({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, customerKey: invoice.advertiserId, customerName: nameOf.get(invoice.advertiserId) ?? "Advertiser", balanceMinor: invoice.balanceMinor, dueDate: invoice.dueDate ?? null })),
    paymentHistory(data, visible),
    new Date(),
    15
  );

  const payments = data.payments.filter((payment) => visible.has(payment.advertiserId) && !payment.deletedAt && payment.unallocatedMinor > 0);
  const matches = suggestPaymentMatches(
    payments.map((payment) => ({ id: payment.id, customerKey: payment.advertiserId, amountMinor: payment.unallocatedMinor, receivedOn: payment.receivedDate, reference: payment.externalReference ?? null })),
    invoices.map((invoice) => ({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, customerKey: invoice.advertiserId, balanceMinor: invoice.balanceMinor, dueDate: invoice.dueDate ?? null }))
  ).map((match) => {
    const payment = payments.find((candidate) => candidate.id === match.paymentId)!;
    return { ...match, customerName: nameOf.get(payment.advertiserId) ?? "Advertiser", amountMinor: payment.unallocatedMinor, receivedOn: payment.receivedDate };
  });

  const chase = await latestAssistantOutput<ChaseNotesOutput>(actor, chaseNotesTask, subjectFor(actor)).catch(() => undefined);
  return {
    ranked,
    totals: agedDebtTotals(ranked),
    matches,
    chase: chase ? { runId: chase.run.id, createdAt: chase.run.createdAt, output: chase.output } : undefined,
    canAssist: can("finance", "ai_assist"),
    canAllocate: can("advertiser.payment", "allocate"),
    aiConfigured: assistantsConfigured()
  };
}

export async function generateChaseNotes(actor: AssistantActor) {
  const panel = await readDebtPanel(actor);
  return runAssistant(actor, chaseNotesTask, { debts: panel.ranked }, subjectFor(actor));
}

/**
 * Accept one suggested match. This is the existing, permissioned allocation: the same checks as allocating by
 * hand apply (permission, scope, amounts within the payment and the invoice balance), it is audited, and the
 * allocation records that it came from a suggestion. The suggestion is recomputed here from live balances, so a
 * stale page cannot apply something that is no longer true.
 */
export async function acceptSuggestedMatch(actor: AssistantActor, input: { paymentId: string }) {
  const permissions = await getPermissionData();
  const { db, sql } = createDb();
  try {
    return await db.transaction(async (tx) => {
      const data = await loadAdvertisingData(tx);
      const rows = listAdvertisers(actor as AdvertisingActorContext, permissions, data);
      const visible = new Set(rows.map((row) => row.advertiser.id));
      const payments = data.payments.filter((payment) => visible.has(payment.advertiserId) && payment.unallocatedMinor > 0 && !payment.deletedAt);
      const invoices = data.invoices.filter((invoice) => visible.has(invoice.advertiserId) && !invoice.deletedAt && ["issued", "part_paid"].includes(String(invoice.status)));
      const suggestion = suggestPaymentMatches(
        payments.map((payment) => ({ id: payment.id, customerKey: payment.advertiserId, amountMinor: payment.unallocatedMinor, receivedOn: payment.receivedDate, reference: payment.externalReference ?? null })),
        invoices.map((invoice) => ({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, customerKey: invoice.advertiserId, balanceMinor: invoice.balanceMinor, dueDate: invoice.dueDate ?? null }))
      ).find((candidate) => candidate.paymentId === input.paymentId);
      if (!suggestion) throw new Error("There is no longer a suggested match for that payment.");

      const before = snapshotAdvertisingData(data);
      const audit = {
        record: (event: { action: string; actorUserId?: string | null; entityType: string; entityId?: string | null; organisationId?: string | null; territoryId?: string | null; payload?: Record<string, unknown> }) =>
          recordAuditEvent(tx, {
            action: event.action,
            actor: { type: "human", userId: event.actorUserId ?? actor.userId },
            entity: { type: event.entityType, id: event.entityId ?? undefined },
            scope: { organisationId: event.organisationId ?? undefined, territoryId: event.territoryId ?? undefined },
            after: { ...event.payload, source: "assistant_suggestion", basis: suggestion.basis, confidence: suggestion.confidence }
          }).then(() => undefined)
      };

      for (const allocation of suggestion.allocations) {
        await allocatePayment(actor as AdvertisingActorContext, permissions, audit, data, { id: randomUUID(), paymentId: suggestion.paymentId, invoiceId: allocation.invoiceId, amountMinor: allocation.amountMinor, allocatedAt: today(), status: "applied", metadata: { source: "assistant_suggestion", basis: suggestion.basis } }, randomUUID(), { newId: randomUUID });
      }
      await persistAdvertisingChanges(tx, before, data);
      return suggestion;
    });
  } finally {
    await sql.end();
  }
}

// ---- Royalty review ----------------------------------------------------------------------------------------

export type RoyaltyPanel = {
  flags: RoyaltyAnomaly[];
  notes?: { runId: string; createdAt: Date; approvalState: string; requestedByUserId: string | null; output: RoyaltyNotesOutput };
  canAssist: boolean;
  aiConfigured: boolean;
};

const royaltySubject = { type: "royalty_review", id: "network" };

/** Network royalty statements only (the actor must hold the network royalty view): territory users never see other territories' figures. */
export async function readRoyaltyPanel(actor: AssistantActor): Promise<RoyaltyPanel> {
  // Comparing territories needs the network-wide view: a territory user only ever sees their own statements, not a comparison.
  const networkViewer = evaluatePermission({ userId: actor.userId, module: "finance.royalty_statement", action: "view" }, await getPermissionData()).allowed;
  if (!networkViewer) throw new Error("The royalty review needs the network royalty view.");
  const statements = await readNetworkRoyaltyStatements({ userId: actor.userId, organisationId: actor.organisationId ?? "", territoryId: actor.territoryId ?? undefined }); // throws unless the actor holds the network royalty view
  const directory = getDirectory();
  const names = new Map((await directory.listTerritories()).map((territory) => [territory.id, territory.name]));
  const flags = detectRoyaltyAnomalies(statements.map((statement) => ({ id: statement.id, territoryId: statement.territoryId, territoryName: names.get(statement.territoryId) ?? "Territory", status: statement.status, periodStart: statement.periodStart, periodEnd: statement.periodEnd, calculatedRoyaltyMinor: statement.calculatedRoyaltyMinor, adjustmentsMinor: statement.adjustmentsMinor, grossRevenueMinor: statement.grossRevenueMinor })));
  const permissions = await getPermissionData();
  const notes = await latestAssistantOutput<RoyaltyNotesOutput>(actor, royaltyNotesTask, royaltySubject).catch(() => undefined);
  return {
    flags,
    notes: notes ? { runId: notes.run.id, createdAt: notes.run.createdAt, approvalState: notes.run.approvalState, requestedByUserId: notes.run.actorUserId, output: notes.output } : undefined,
    canAssist: evaluatePermission({ userId: actor.userId, module: "finance", action: "ai_assist", context: { organisationId: actor.organisationId ?? undefined, territoryId: actor.territoryId ?? undefined } }, permissions).allowed,
    aiConfigured: assistantsConfigured()
  };
}

export async function generateRoyaltyNotes(actor: AssistantActor) {
  const panel = await readRoyaltyPanel(actor);
  return runAssistant(actor, royaltyNotesTask, { flags: panel.flags }, royaltySubject);
}

