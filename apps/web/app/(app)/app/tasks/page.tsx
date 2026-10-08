import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { hasAutomationCapability, readTasksAndApprovals } from "../../../../lib/automation-runtime";
import type { AutomationActorContext } from "../../../../lib/automation-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { completeTaskAction, decideApprovalAction } from "./actions";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  task_done: { tone: "success", text: "Task marked as done." },
  approved: { tone: "success", text: "Approved. The workflow will continue shortly." },
  rejected: { tone: "success", text: "Rejected. The workflow has been stopped." },
  not_allowed: { tone: "error", text: "You do not have permission to action that item." },
  wrong_state: { tone: "error", text: "That item has already been dealt with. Refresh to see the latest." }
};

const formatDate = (value: Date | null) => (value ? value.toLocaleDateString("en-GB") : "No due date");

export default async function TasksPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const result = await load(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { context, tasks, approvals, notifications } = result;
  const resultParam = Array.isArray(params.result) ? params.result[0] : params.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const today = new Date();

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Today</p>
        <h2>Tasks &amp; approvals</h2>
        <p>Work created automatically by workflows, such as follow-ups after a signed agreement, a confirmed booking or an overdue invoice.</p>
        <div className="franchise-metrics">
          <article>
            <span>Waiting for your approval</span>
            <strong>{approvals.length}</strong>
          </article>
          <article>
            <span>Open tasks</span>
            <strong>{tasks.length}</strong>
          </article>
          <article>
            <span>Overdue tasks</span>
            <strong>{tasks.filter((task) => task.dueDate && task.dueDate < today).length}</strong>
          </article>
        </div>
        {banner ? (
          <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>
            {banner.text}
          </p>
        ) : null}
      </section>

      <section className="app-panel franchise-panel" aria-label="Approvals">
        <p className="eyebrow">Approvals</p>
        <h2>Needs a decision</h2>
        <div className="franchise-list">
          {approvals.length === 0 ? (
            <div>
              <strong>Nothing is waiting for a decision.</strong>
            </div>
          ) : (
            approvals.map((approval) => (
              <div key={approval.id}>
                <strong>{approval.title}</strong>
                <span>
                  {approval.description ?? "A workflow is paused until this is decided."}
                  {approval.expiresAt ? ` Expires ${formatDate(approval.expiresAt)}.` : ""}
                </span>
                {hasAutomationCapability(context, "approvalDecide") ? (
                  <form className="franchise-form">
                    <label>
                      Note (optional)
                      <input name="note" maxLength={500} />
                    </label>
                    <div className="franchise-actions">
                      <button type="submit" formAction={decideApprovalAction.bind(null, request, approval.id, "approved")}>
                        Approve
                      </button>
                      <button type="submit" formAction={decideApprovalAction.bind(null, request, approval.id, "rejected")}>
                        Reject
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="app-panel franchise-panel" aria-label="Tasks">
        <p className="eyebrow">Tasks</p>
        <h2>Open tasks</h2>
        <div className="franchise-list">
          {tasks.length === 0 ? (
            <div>
              <strong>No open tasks.</strong>
            </div>
          ) : (
            tasks.map((task) => (
              <div key={task.id}>
                <strong>{task.title}</strong>
                <span>
                  {task.assigneeScope === "hq" ? "Head Office" : "Territory team"} · Due {formatDate(task.dueDate)}
                  {task.dueDate && task.dueDate < today ? " · Overdue" : ""}
                </span>
                {task.link ? <a href={task.link}>Open related record</a> : null}
                {hasAutomationCapability(context, "taskComplete") ? (
                  <form action={completeTaskAction.bind(null, request, task.id)}>
                    <button type="submit">Mark done</button>
                  </form>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="app-panel franchise-panel" aria-label="Notifications">
        <p className="eyebrow">Recent</p>
        <h2>Notifications</h2>
        <div className="franchise-list">
          {notifications.length === 0 ? (
            <div>
              <strong>No notifications yet.</strong>
            </div>
          ) : (
            notifications.map((note) => (
              <div key={note.id}>
                <strong>{note.title}</strong>
                <span>
                  {note.body ?? ""} {note.createdAt.toLocaleString("en-GB")}
                </span>
                {note.link ? <a href={note.link}>Open</a> : null}
              </div>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "automation.task", action: "view" });
    const context: AutomationActorContext = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    return { context, ...(await readTasksAndApprovals(context)) };
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
