import type { AdvertiserTask } from "@raring2go/advertising";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { formatCount, formatDate } from "../../../../../lib/format";
import { Actions, EmptyState, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { changeTaskAction, createTaskAction } from "../actions";

// An ISO day string, compared as text against each task's due day to spot the late ones.
const today = () => new Date().toISOString().slice(0, 10);

/** The follow-ups owed to this advertiser. Viewing needs only access to the advertiser; changing needs the CRM edit permission, re-checked on the server. */
export function TasksPanel({ request, advertiserId, tasks, opportunities, canManage }: { request: RequestedShellContext; advertiserId: string; tasks: AdvertiserTask[]; opportunities: Array<{ id: string; title: string }>; canManage: boolean }) {
  const now = today();
  const open = tasks.filter((task) => task.status === "open");
  const closed = tasks.filter((task) => task.status !== "open");
  return (
    <Panel eyebrow="Tasks" title="Follow-ups" intro={formatCount(open.length, "open task")} id="tasks">
      {open.length === 0 ? (
        <EmptyState title="Nothing is owed to this advertiser right now">
          {canManage ? "Add a task below when you promise them something." : "Tasks appear here when someone on the team adds one."}
        </EmptyState>
      ) : (
        <RecordList>
          {open.map((task) => {
            const late = Boolean(task.dueOn && task.dueOn < now);
            return (
              <RecordCard
                key={task.id}
                title={task.title}
                status={late ? "overdue" : "open"}
                tone={late ? "danger" : "info"}
                lines={[task.dueOn ? `${late ? "Overdue: was due" : "Due"} ${formatDate(task.dueOn)}` : "No due date", task.notes ?? null]}
              >
                {canManage ? (
                  <Actions>
                    <form action={changeTaskAction.bind(null, request, advertiserId, task.id, "complete")}>
                      <button type="submit" className="r2-button r2-button--primary">
                        Mark done
                      </button>
                    </form>
                    <form action={changeTaskAction.bind(null, request, advertiserId, task.id, "cancel")}>
                      <button type="submit" className="r2-button r2-button--secondary">
                        Cancel
                      </button>
                    </form>
                  </Actions>
                ) : null}
              </RecordCard>
            );
          })}
        </RecordList>
      )}
      {closed.length > 0 ? (
        <details>
          <summary>{closed.length} done or cancelled</summary>
          <RecordList>
            {closed.map((task) => (
              <RecordCard key={task.id} title={task.title} status={task.status}>
                {canManage ? (
                  <form action={changeTaskAction.bind(null, request, advertiserId, task.id, "reopen")}>
                    <button type="submit" className="r2-button r2-button--secondary">
                      Reopen
                    </button>
                  </form>
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        </details>
      ) : null}
      {canManage ? (
        <form action={createTaskAction.bind(null, request, advertiserId)} className="franchise-form">
          <h3>Add a task</h3>
          <label>
            What needs doing
            <input name="title" required maxLength={200} />
          </label>
          <label>
            Due
            <input name="dueOn" type="date" />
          </label>
          {opportunities.length > 0 ? (
            <label>
              About
              <select name="opportunityId" defaultValue="">
                <option value="">The advertiser in general</option>
                {opportunities.map((opportunity) => (
                  <option key={opportunity.id} value={opportunity.id}>{opportunity.title}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Notes
            <textarea name="notes" rows={2} maxLength={2000} />
          </label>
          <button type="submit" className="r2-button r2-button--primary">
            Add task
          </button>
        </form>
      ) : null}
    </Panel>
  );
}
