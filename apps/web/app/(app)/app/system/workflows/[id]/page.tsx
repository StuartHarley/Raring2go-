import type { Route } from "next";
import { JobAccessError } from "@raring2go/workflows";
import { ShellAccessError, requireShellPermission } from "../../../../../../lib/app-shell";
import { knownHooks } from "../../../../../../lib/automation-hooks";
import { hasAutomationCapability, readWorkflowDefinition } from "../../../../../../lib/automation-runtime";
import type { AutomationActorContext } from "../../../../../../lib/automation-runtime";
import { Breadcrumbs, StatusBadge } from "../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { createDraftAction, saveDraftAction, toggleWorkflowAction } from "./actions";
import { WorkflowDraftEditor } from "./WorkflowDraftEditor";

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

export default async function WorkflowDefinitionPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const result = await load(request, id);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { context, definition, versions } = result;
  const active = versions.find((version) => version.status === "active");
  const draft = versions.find((version) => version.status === "draft");
  const canManage = hasAutomationCapability(context, "workflowManage");
  const canActivate = hasAutomationCapability(context, "workflowActivate");
  const resultParam = Array.isArray(search.result) ? search.result[0] : search.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Workflows", href: "/app/system/workflows" as Route }, { label: definition.name }]} />

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Workflow</p>
        <h2>{definition.name}</h2>
        <p>{definition.description}</p>
        <div className="franchise-metrics">
          <article>
            <span>Status</span>
            <strong>
              <StatusBadge status={definition.status === "enabled" && active ? "active" : "paused"} />
            </strong>
          </article>
          <article>
            <span>Active version</span>
            <strong>{active ? `v${active.versionNumber}` : "none"}</strong>
          </article>
          <article>
            <span>Trigger</span>
            <strong>{(active ?? draft)?.triggerEvent ?? "-"}</strong>
          </article>
        </div>
        {banner ? (
          <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>
            {banner.text}
          </p>
        ) : null}
        <div className="franchise-actions">
          {canActivate ? (
            <form action={toggleWorkflowAction.bind(null, request, definition.id, definition.status !== "enabled")}>
              <button type="submit">{definition.status === "enabled" ? "Disable workflow" : "Enable workflow"}</button>
            </form>
          ) : null}
          {canManage && !draft ? (
            <form action={createDraftAction.bind(null, request, definition.id)}>
              <button type="submit">Create draft to edit</button>
            </form>
          ) : null}
        </div>
      </section>

      {draft && canManage ? (
        <section className="app-panel franchise-panel" aria-label="Draft editor">
          <p className="eyebrow">Draft v{draft.versionNumber}</p>
          <h2>Edit draft</h2>
          <p>Changes here do not affect live runs until you activate the draft. Activating retires the current version.</p>
          <WorkflowDraftEditor
            action={saveDraftAction.bind(null, request, definition.id, draft.id)}
            initial={{ triggerEvent: draft.triggerEvent, settings: draft.settings, conditions: draft.conditions, steps: draft.steps as never, changeNote: draft.changeNote ?? "" }}
            hooks={{ actions: [...knownHooks.actions], guards: [...knownHooks.guards] }}
            sampleHint={SAMPLES[draft.triggerEvent] ?? "{}"}
            runsBase="/app/system/workflows/runs"
          />
        </section>
      ) : null}

      <section className="app-panel audit-table" aria-label="Versions">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Trigger</th>
                <th>Steps</th>
                <th>Thresholds</th>
                <th>Note</th>
                <th>Activated</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.id}>
                  <td>v{version.versionNumber}</td>
                  <td>
                    <StatusBadge status={version.status === "active" ? "active" : version.status === "draft" ? "draft" : "retired"} />
                  </td>
                  <td>{version.triggerEvent}</td>
                  <td>{version.steps.map((step) => step.type.replace("_", " ")).join(" → ")}</td>
                  <td>{Object.entries(version.settings).map(([name, value]) => `${name}: ${value}`).join(", ") || "-"}</td>
                  <td>{version.changeNote ?? "-"}</td>
                  <td>{version.activatedAt ? version.activatedAt.toLocaleString("en-GB") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, id: string) {
  try {
    const shell = await requireShellPermission(request, { module: "automation.workflow", action: "view" });
    const context: AutomationActorContext = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    return { context, ...(await readWorkflowDefinition(context, id)) };
  } catch (error) {
    return { error };
  }
}

function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError || error instanceof JobAccessError) {
    const kind = error instanceof ShellAccessError ? error.kind : "unauthorised";
    return (
      <main className={`app-outcome app-outcome-${kind}`}>
        <section>
          <p className="eyebrow">{kind.replace("_", " ")}</p>
          <h1>{kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1>
          <p>{error.message}</p>
        </section>
      </main>
    );
  }
  throw error;
}
