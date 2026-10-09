import { requireShellPermission } from "../../../../lib/app-shell";
import { hasAutomationCapability, readTasksAndApprovals } from "../../../../lib/automation-runtime";
import type { AutomationActorContext } from "../../../../lib/automation-runtime";
import { formatDate, formatDateTime } from "../../../../lib/format";
import { EmptyState, Metrics, PageHeader, Panel } from "../../../../lib/page-ui";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { completeTaskAction, decideApprovalAction } from "./actions";
import { getPermissionData } from "../../../../lib/permission-source";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Tasks & approvals" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  task_done: { tone: "success", text: "Task marked as done." },
  approved: { tone: "success", text: "Approved. The workflow will continue shortly." },
  rejected: { tone: "success", text: "Rejected. The workflow has been stopped." },
  not_allowed: { tone: "error", text: "You do not have permission to action that item." },
  wrong_state: { tone: "error", text: "That item has already been dealt with. Refresh to see the latest." }
};

export default async function TasksPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const result = await load(request);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const { context, permissions, tasks, approvals, notifications } = result;
  const resultParam = Array.isArray(params.result) ? params.result[0] : params.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const today = new Date();
  const overdue = tasks.filter((task) => task.dueDate && task.dueDate < today).length;

  return (
    <AppShell request={request}>
      <PageHeader
        eyebrow="Today"
        title="Tasks & approvals"
        intro="Work created automatically by workflows, such as follow-ups after a signed agreement, a confirmed booking or an overdue invoice."
      />

      <Panel>
        <Metrics
          items={[
            { label: "Waiting for your approval", value: approvals.length, tone: approvals.length > 0 ? "warning" : "neutral" },
            { label: "Open tasks", value: tasks.length, tone: tasks.length > 0 ? "info" : "neutral" },
            { label: "Overdue tasks", value: overdue, tone: overdue > 0 ? "danger" : "success" }
          ]}
        />
        {banner ? (
          <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>
            {banner.text}
          </p>
        ) : null}
      </Panel>

      <Panel eyebrow="Approvals" title="Needs a decision" id="approvals">
        <div className="franchise-list">
          {approvals.length === 0 ? (
            <EmptyState title="Nothing is waiting for a decision">Approvals raised by workflows will appear here with their deadline.</EmptyState>
          ) : (
            approvals.map((approval) => (
              <div key={approval.id}>
                <strong>{approval.title}</strong>
                <span>
                  {approval.description ?? "A workflow is paused until this is decided."}
                  {approval.expiresAt ? ` Expires ${formatDate(approval.expiresAt)}.` : ""}
                </span>
                {hasAutomationCapability(permissions, context, "approvalDecide") ? (
                  <form className="franchise-form">
                    <label>
                      Note (optional)
                      <input name="note" maxLength={500} />
                    </label>
                    <div className="franchise-actions">
                      <button type="submit" className="r2-button r2-button--primary" formAction={decideApprovalAction.bind(null, request, approval.id, "approved")}>
                        Approve
                      </button>
                      <button type="submit" className="r2-button r2-button--secondary" formAction={decideApprovalAction.bind(null, request, approval.id, "rejected")}>
                        Reject
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Panel>

      <Panel eyebrow="Tasks" title="Open tasks" id="tasks">
        <div className="franchise-list">
          {tasks.length === 0 ? (
            <EmptyState title="No open tasks">You are up to date. New tasks arrive as workflows run.</EmptyState>
          ) : (
            tasks.map((task) => {
              const isOverdue = Boolean(task.dueDate && task.dueDate < today);
              return (
                <div key={task.id}>
                  <strong>{task.title}</strong>
                  <span>
                    {task.assigneeScope === "hq" ? "Head Office" : "Territory team"} · Due {formatDate(task.dueDate, "No due date")}
                    {isOverdue ? " · Overdue" : ""}
                  </span>
                  {task.link ? <a href={task.link}>Open related record</a> : null}
                  {hasAutomationCapability(permissions, context, "taskComplete") ? (
                    <form action={completeTaskAction.bind(null, request, task.id)}>
                      <button type="submit" className="r2-button r2-button--secondary">
                        Mark done
                      </button>
                    </form>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </Panel>

      <Panel eyebrow="Recent" title="Notifications" id="notifications">
        <div className="franchise-list">
          {notifications.length === 0 ? (
            <EmptyState title="No notifications yet" />
          ) : (
            notifications.map((note) => (
              <div key={note.id}>
                <strong>{note.title}</strong>
                <span>
                  {note.body ?? ""} {formatDateTime(note.createdAt)}
                </span>
                {note.link ? <a href={note.link}>Open</a> : null}
              </div>
            ))
          )}
        </div>
      </Panel>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "automation.task", action: "view" });
    const context: AutomationActorContext = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    return { context, permissions: await getPermissionData(), ...(await readTasksAndApprovals(context)) };
  } catch (error) {
    return { error };
  }
}
