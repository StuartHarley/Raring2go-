import { recordAuditEvent } from "@raring2go/audit";
import { advertiserInvoices, createDb, fixtureIds, organisations } from "@raring2go/db";
import {
  insertDomainEvents,
  insertOnboardingProgrammeGraph,
  loadFranchiseData,
  startOnboardingFromExecutedAgreement,
  updateFranchiseRecord
} from "@raring2go/franchise";
import type { FranchiseActorContext } from "@raring2go/franchise";
import type { PermissionData } from "@raring2go/permissions";
import { emitWorkflowEvent, PermanentJobError, defineJobHandler } from "@raring2go/workflows";
import type { EngineHooks, EngineStore, JobHandler } from "@raring2go/workflows";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

/**
 * The workflow engine acts as a real, audited service user holding only the grants
 * its actions need (currently onboardingManage). It is never a human's identity, so
 * the audit trail shows exactly which changes automation made.
 */
export const automationContext: FranchiseActorContext = {
  userId: fixtureIds.users.workflowAutomation,
  organisationId: fixtureIds.organisations.hq
};

export const automationPermissionData: PermissionData = {
  roleAssignments: [
    {
      id: "fixture_assignment_automation",
      userId: fixtureIds.users.workflowAutomation,
      roleId: fixtureIds.roles.automation,
      organisationId: fixtureIds.organisations.hq
    }
  ],
  rolePermissions: [
    {
      roleId: fixtureIds.roles.automation,
      permission: { id: fixtureIds.permissions.onboardingManage, module: "franchise.onboarding", action: "manage" },
      scope: "network"
    }
  ]
};

export const OVERDUE_INVOICE_EVENT = "finance.invoice.overdue";
export const SCAN_OVERDUE_INVOICES_KIND = "workflows.scan_overdue_invoices";

export const scanOverdueInvoicesIdempotencyKey = (now: Date) => `${SCAN_OVERDUE_INVOICES_KIND}:${now.toISOString().slice(0, 10)}`;

export const engineHooks: EngineHooks = {
  actions: {
    /**
     * Starts onboarding for the executed agreement that triggered the run. The domain
     * service is itself idempotent (keyed by franchise + agreement), so a retried step
     * returns the existing programme instead of creating a second one.
     */
    "franchise.start_onboarding": async ({ run }) => {
      if (!run.subjectId) {
        throw new PermanentJobError("The triggering event has no agreement to start onboarding for.", "no_subject");
      }

      const { db, sql: client } = createDb();
      try {
        return await db.transaction(async (tx) => {
          const data = await loadFranchiseData(tx);
          const agreement = (data.franchiseAgreements ?? []).find((candidate) => candidate.id === run.subjectId);
          if (!agreement) throw new PermanentJobError(`Agreement ${run.subjectId} no longer exists.`, "agreement_not_found");

          const result = await startOnboardingFromExecutedAgreement(
            automationContext,
            automationPermissionData,
            { record: (input) => recordAuditEvent(tx, { ...input, context: { ...input.context, jobId: run.id } }).then(() => undefined) },
            data,
            agreement.id
          );

          if (result.duplicate) return { onboardingProgrammeId: result.programme.id, alreadyStarted: true };

          await insertOnboardingProgrammeGraph(tx, result.programme, result.tasks);
          await insertDomainEvents(tx, data.domainEvents ?? []);
          await updateFranchiseRecord(tx, agreement.franchiseId, data.franchises.find((franchise) => franchise.id === agreement.franchiseId)!);
          return { onboardingProgrammeId: result.programme.id, alreadyStarted: false };
        });
      } finally {
        await client.end();
      }
    }
  },
  guards: {
    /** Credit-control stages stop as soon as the invoice is paid, credited or voided. */
    "invoice.still_unpaid": async ({ run }) => {
      if (!run.subjectId) return false;
      const { db, sql: client } = createDb();
      try {
        const [invoice] = await db.select().from(advertiserInvoices).where(eq(advertiserInvoices.id, run.subjectId));
        return Boolean(invoice && !invoice.deletedAt && ["issued", "part_paid"].includes(invoice.status) && invoice.balanceMinor > 0);
      } finally {
        await client.end();
      }
    }
  }
};

export const knownHooks = {
  actions: new Set(Object.keys(engineHooks.actions)),
  guards: new Set(Object.keys(engineHooks.guards))
};

/**
 * Daily scan: overdue invoices have no audit event (nothing "happens" when a due date
 * passes), so this emits them. The event key includes the due date, so each invoice
 * fires once per due date, and a re-issued/extended invoice can fire again.
 */
export function createOverdueInvoiceScanner(store: EngineStore): JobHandler {
  return defineJobHandler({
    kind: SCAN_OVERDUE_INVOICES_KIND,
    maxAttempts: 3,
    handle: async ({ now }) => {
      const at = now();
      const today = at.toISOString().slice(0, 10);
      const { db, sql: client } = createDb();
      try {
        const rows = await db
          .select({ invoice: advertiserInvoices, customerName: organisations.name })
          .from(advertiserInvoices)
          .innerJoin(organisations, eq(organisations.id, advertiserInvoices.customerOrganisationId))
          .where(
            and(
              inArray(advertiserInvoices.status, ["issued", "part_paid"]),
              lt(advertiserInvoices.dueDate, new Date(`${today}T00:00:00Z`)),
              sql`${advertiserInvoices.balanceMinor} > 0`,
              isNull(advertiserInvoices.deletedAt)
            )
          );

        let emitted = 0;
        for (const { invoice, customerName } of rows) {
          const { created } = await emitWorkflowEvent(
            store,
            {
              eventKey: `scan:invoice-overdue:${invoice.id}:${invoice.dueDate?.toISOString().slice(0, 10)}`,
              type: OVERDUE_INVOICE_EVENT,
              source: "scanner",
              organisationId: invoice.issuerOrganisationId,
              territoryId: invoice.territoryId,
              subjectType: "advertiser_invoice",
              subjectId: invoice.id,
              payload: {
                invoiceNumber: invoice.invoiceNumber,
                customerName,
                advertiserId: invoice.advertiserId,
                balanceMinor: invoice.balanceMinor,
                totalMinor: invoice.totalMinor,
                currency: invoice.currency,
                dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null
              },
              occurredAt: at
            },
            at
          );
          if (created) emitted += 1;
        }
        return { overdueInvoices: rows.length, emitted };
      } finally {
        await client.end();
      }
    }
  });
}
