import type { EngineStore } from "./store";
import { validateWorkflowVersion } from "./validate";
import type { KnownHooks } from "./validate";
import type { WorkflowCondition, WorkflowSettings, WorkflowStep } from "./types";

export type BuiltinWorkflow = {
  key: string;
  name: string;
  description: string;
  triggerEvent: string;
  conditions: WorkflowCondition[];
  settings: WorkflowSettings;
  steps: WorkflowStep[];
};

/** The core lifecycle workflows shipped with the platform (AUT-001). */
export const builtinWorkflows: BuiltinWorkflow[] = [
  {
    key: "franchise.agreement_signed",
    name: "Franchise agreement signed",
    description: "When an agreement is fully executed, start onboarding exactly once and make sure Head Office follows it up.",
    triggerEvent: "franchise.agreement.executed",
    conditions: [],
    settings: { kickoffDays: 3 },
    steps: [
      { type: "notify", audience: "hq", title: "Franchise agreement executed", body: "A franchise agreement was fully signed. Onboarding is being started automatically.", link: "/app/franchisees" },
      { type: "run_action", action: "franchise.start_onboarding" },
      { type: "create_task", title: "Confirm the onboarding kick-off is booked", assignee: "hq", dueInDays: { setting: "kickoffDays" }, link: "/app/franchisees" }
    ]
  },
  {
    key: "advertising.booking_confirmed",
    name: "Advertiser booking confirmed",
    description: "When a booking is confirmed, ask the territory to collect artwork and check the invoice was raised.",
    triggerEvent: "advertiser.booking.confirm",
    conditions: [],
    settings: { artworkDays: 2, invoiceDays: 1 },
    steps: [
      { type: "notify", audience: "territory", title: "Booking confirmed", body: "A booking was confirmed. Artwork and invoicing follow-ups have been created.", link: "/app/advertisers" },
      { type: "create_task", title: "Request artwork and copy from the advertiser", assignee: "territory", dueInDays: { setting: "artworkDays" }, link: "/app/advertisers" },
      { type: "create_task", title: "Check the invoice for this booking has been issued", assignee: "territory", dueInDays: { setting: "invoiceDays" }, link: "/app/finance" }
    ]
  },
  {
    key: "finance.invoice_overdue",
    name: "Overdue invoice credit control",
    description: "Staged credit control: territory chases first, Head Office is told if it is still unpaid, and a credit-hold decision is requested last. Each stage re-checks the invoice is still unpaid.",
    triggerEvent: "finance.invoice.overdue",
    conditions: [{ field: "event.payload.balanceMinor", op: "gt", value: 0 }],
    settings: { firstReminderDays: 3, escalateAfterDays: 7, holdDecisionAfterDays: 14, approvalExpiryDays: 14 },
    steps: [
      { type: "create_task", title: "Chase overdue invoice {{event.payload.invoiceNumber}} ({{event.payload.customerName}})", assignee: "territory", dueInDays: { setting: "firstReminderDays" }, link: "/app/finance" },
      { type: "wait", days: { setting: "escalateAfterDays" } },
      { type: "guard", check: "invoice.still_unpaid" },
      { type: "notify", audience: "hq", title: "Invoice {{event.payload.invoiceNumber}} is still unpaid", body: "Unpaid {{settings.escalateAfterDays}} days after going overdue. The territory has been chasing.", link: "/app/finance" },
      { type: "wait", days: { setting: "holdDecisionAfterDays" } },
      { type: "guard", check: "invoice.still_unpaid" },
      { type: "request_approval", approver: "hq", title: "Place {{event.payload.customerName}} on credit hold for {{event.payload.invoiceNumber}}?", description: "The invoice has been overdue for over {{settings.holdDecisionAfterDays}} days.", expiresInDays: { setting: "approvalExpiryDays" } },
      { type: "create_task", title: "Apply the approved credit hold for {{event.payload.invoiceNumber}}", assignee: "hq", dueInDays: 1, link: "/app/finance" }
    ]
  },
  {
    key: "marketing.newsletter_approved",
    name: "Newsletter approved",
    description: "When a newsletter campaign is approved, tell Head Office and ask for a pre-send review. This does not gate the send; send approval rules live on the campaign itself.",
    triggerEvent: "marketing.email.campaign.approve",
    conditions: [],
    settings: { reviewDays: 1 },
    steps: [
      { type: "notify", audience: "hq", title: "A newsletter campaign was approved", link: "/app/newsletters" },
      { type: "create_task", title: "Review the approved newsletter before its send window", assignee: "hq", dueInDays: { setting: "reviewDays" }, link: "/app/newsletters" }
    ]
  }
];

/**
 * Installs the built-in workflows. Idempotent and non-destructive: a definition that
 * already has any version is left exactly as an administrator last configured it.
 */
export async function ensureBuiltinWorkflows(store: EngineStore, hooks: KnownHooks, now: Date = new Date()) {
  const installed: string[] = [];

  for (const workflow of builtinWorkflows) {
    const definition = await store.upsertDefinition({ key: workflow.key, name: workflow.name, description: workflow.description }, now);
    if ((await store.listVersions(definition.id)).length > 0) continue;

    const validated = validateWorkflowVersion(workflow, hooks);
    if (!validated.ok) {
      throw new Error(`Built-in workflow ${workflow.key} is invalid: ${validated.errors.join(" ")}`);
    }

    const version = await store.createVersion(definition.id, { ...validated.value, changeNote: "Built-in default" }, null, now);
    await store.activateVersion(version.id, null, now);
    installed.push(workflow.key);
  }

  return installed;
}
