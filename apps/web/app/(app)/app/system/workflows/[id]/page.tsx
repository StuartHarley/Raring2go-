import type { Route } from "next";
import { JobAccessError } from "@raring2go/workflows";
import { ShellAccessError, requireShellPermission } from "../../../../../../lib/app-shell";
import { knownHooks } from "../../../../../../lib/automation-hooks";
import { hasAutomationCapability, readWorkflowDefinition } from "../../../../../../lib/automation-runtime";
import type { AutomationActorContext } from "../../../../../../lib/automation-runtime";
import { formatCode, formatDateTime, formatLabels } from "../../../../../../lib/format";
import { Actions, Metrics, Notice, PageHeader, Panel, StatusBadge, Table } from "../../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { createDraftAction, saveDraftAction, toggleWorkflowAction } from "./actions";
import { WorkflowDraftEditor } from "./WorkflowDraftEditor";
import { getPermissionData } from "../../../../../../lib/permission-source";
import { protectedOutcome } from "../../../../../../lib/protected-outcome";

export const metadata = { title: "Workflow" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  activated: { tone: "success", text: "Version activated. New events use it straight away; runs already in progress finish on the version they started with." },
  draft_created: { tone: "success", text: "Draft created from the latest version." },
  enabled: { tone: "success", text: "Workflow enabled." },
  disabled: { tone: "success", text: "Workflow disabled. Runs already in progress will finish." },
  not_allowed: { tone: "error", text: "You do not have permission to do that." },
  wrong_state: { tone: "error", text: "That is no longer possible, for example a draft already exists. Refresh and try again." }
};

const SAMPLES: Record<string, string> = {
  "finance.invoice.overdue": JSON.stringify({ invoiceNumber: "INV-1001", customerName: "Example Advertiser", balanceMinor: 25000, currency: "GBP" }, null, 2),
  "franchise.agreement.executed": JSON.stringify({ status: "executed" }, null, 2),
  "advertiser.booking.confirm": JSON.stringify({ status: "confirmed" }, null, 2),
  "marketing.email.campaign.approve": JSON.stringify({ versionId: "00000000-0000-0000-0000-000000000000" }, null, 2)
};

/** "finance.invoice.overdue" → "Finance invoice overdue": dotted event codes read as words. */

export default async function WorkflowDefinitionPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const result = await load(request, id);

  if ("error" in result) {
    // A JobAccessError means the record exists but is outside this actor's scope: shown as a denial, not a crash.
    return protectedOutcome(result.error instanceof JobAccessError ? new ShellAccessError("unauthorised", result.error.message) : result.error, request);
  }

  const { context, permissions, definition, versions } = result;
  const active = versions.find((version) => version.status === "active");
  const draft = versions.find((version) => version.status === "draft");
  const canManage = hasAutomationCapability(permissions, context, "workflowManage");
  const canActivate = hasAutomationCapability(permissions, context, "workflowActivate");
  const resultParam = Array.isArray(search.result) ? search.result[0] : search.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const live = definition.status === "enabled" && Boolean(active);
  const trigger = (active ?? draft)?.triggerEvent;

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Workflows", href: "/app/system/workflows" as Route }, { label: definition.name }]} />

      <PageHeader eyebrow="Workflow" title={definition.name} intro={definition.description} />

      <Panel>
        <Metrics
          items={[
            { label: "Status", value: live ? "Active" : "Paused", tone: live ? "success" : "warning" },
            { label: "Active version", value: active ? `Version ${active.versionNumber}` : "None", tone: active ? "neutral" : "warning" },
            { label: "Trigger", value: trigger ? formatCode(trigger) : "-" }
          ]}
        />
        {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}
        {canActivate || (canManage && !draft) ? (
          <Actions>
            {canActivate ? (
              <form action={toggleWorkflowAction.bind(null, request, definition.id, definition.status !== "enabled")}>
                <button type="submit" className={`r2-button ${definition.status === "enabled" ? "r2-button--secondary" : "r2-button--primary"}`}>
                  {definition.status === "enabled" ? "Disable workflow" : "Enable workflow"}
                </button>
              </form>
            ) : null}
            {canManage && !draft ? (
              <form action={createDraftAction.bind(null, request, definition.id)}>
                <button type="submit" className="r2-button r2-button--secondary">
                  Create draft to edit
                </button>
              </form>
            ) : null}
          </Actions>
        ) : null}
      </Panel>

      {draft && canManage ? (
        <Panel
          eyebrow={`Draft version ${draft.versionNumber}`}
          title="Edit draft"
          intro="Changes here do not affect live runs until you activate the draft. Activating retires the current version."
        >
          <WorkflowDraftEditor
            action={saveDraftAction.bind(null, request, definition.id, draft.id)}
            initial={{ triggerEvent: draft.triggerEvent, settings: draft.settings, conditions: draft.conditions, steps: draft.steps as never, changeNote: draft.changeNote ?? "" }}
            hooks={{ actions: [...knownHooks.actions], guards: [...knownHooks.guards] }}
            sampleHint={SAMPLES[draft.triggerEvent] ?? "{}"}
            runsBase="/app/system/workflows/runs"
          />
        </Panel>
      ) : null}

      <Panel eyebrow="History" title="Versions">
        <Table caption="Versions of this workflow">
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Status</th>
              <th scope="col">Trigger</th>
              <th scope="col">Steps</th>
              <th scope="col">Thresholds</th>
              <th scope="col">Note</th>
              <th scope="col">Activated</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id}>
                <td>Version {version.versionNumber}</td>
                <td>
                  <StatusBadge status={version.status === "active" ? "active" : version.status === "draft" ? "draft" : "retired"} />
                </td>
                <td>{formatCode(version.triggerEvent)}</td>
                <td>{formatLabels(version.steps.map((step) => step.type), " → ")}</td>
                <td>{Object.entries(version.settings).map(([name, value]) => `${name}: ${value}`).join(", ") || "-"}</td>
                <td>{version.changeNote ?? "-"}</td>
                <td>{version.activatedAt ? formatDateTime(version.activatedAt) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, id: string) {
  try {
    const shell = await requireShellPermission(request, { module: "automation.workflow", action: "view" });
    const context: AutomationActorContext = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    return { context, permissions: await getPermissionData(), ...(await readWorkflowDefinition(context, id)) };
  } catch (error) {
    return { error };
  }
}
