import type { AdvertiserTask } from "@raring2go/advertising";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { changeTaskAction, createTaskAction } from "../actions";

const today = () => new Date().toISOString().slice(0, 10);

/** The follow-ups owed to this advertiser. Viewing needs only access to the advertiser; changing needs the CRM edit permission, re-checked on the server. */
export function TasksPanel({ request, advertiserId, tasks, opportunities, canManage }: { request: RequestedShellContext; advertiserId: string; tasks: AdvertiserTask[]; opportunities: Array<{ id: string; title: string }>; canManage: boolean }) {
  const now = today();
  const open = tasks.filter((task) => task.status === "open");
  const closed = tasks.filter((task) => task.status !== "open");
  return (
    <section id="tasks" className="app-panel franchise-panel" aria-label="Tasks">
      <p className="eyebrow">Tasks</p>
      <h2>Follow-ups ({open.length} open)</h2>
      {open.length === 0 ? <p>Nothing is owed to this advertiser right now.</p> : null}
      <div className="franchise-list">
        {open.map((task) => {
          const late = Boolean(task.dueOn && task.dueOn < now);
          return (
            <div key={task.id}>
              <strong>{task.title}</strong>
              <span className={late ? "error" : "muted"}>{task.dueOn ? `${late ? "Overdue: " : "Due "}${task.dueOn}` : "No due date"}</span>
              {task.notes ? <span>{task.notes}</span> : null}
              {canManage ? (
                <>
                  <form action={changeTaskAction.bind(null, request, advertiserId, task.id, "complete")}><button type="submit">Mark done</button></form>
                  <form action={changeTaskAction.bind(null, request, advertiserId, task.id, "cancel")}><button type="submit">Cancel</button></form>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {closed.length > 0 ? (
        <details>
          <summary>{closed.length} done or cancelled</summary>
          <div className="franchise-list">
            {closed.map((task) => (
              <div key={task.id}>
                <strong>{task.title}</strong>
                <span className="muted">{task.status}</span>
                {canManage ? <form action={changeTaskAction.bind(null, request, advertiserId, task.id, "reopen")}><button type="submit">Reopen</button></form> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {canManage ? (
        <form action={createTaskAction.bind(null, request, advertiserId)} className="franchise-form">
          <h3>Add a task</h3>
          <label>What needs doing<input name="title" required maxLength={200} /></label>
          <label>Due<input name="dueOn" type="date" /></label>
          {opportunities.length > 0 ? (
            <label>About
              <select name="opportunityId" defaultValue="">
                <option value="">The advertiser in general</option>
                {opportunities.map((opportunity) => (<option key={opportunity.id} value={opportunity.id}>{opportunity.title}</option>))}
              </select>
            </label>
          ) : null}
          <label>Notes<textarea name="notes" rows={2} maxLength={2000} /></label>
          <button type="submit">Add task</button>
        </form>
      ) : null}
    </section>
  );
}
