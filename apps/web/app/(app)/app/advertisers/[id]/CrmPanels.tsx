import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { formatLabel } from "../../../../../lib/format";
import { Panel } from "../../../../../lib/page-ui";
import { addContactAction, logActivityAction, refreshMetricsAction, updateAdvertiserAction } from "../actions";

export type CrmAccess = { edit: boolean; contactManage: boolean; activityRecord: boolean; taskManage: boolean };

const statuses = ["prospect", "active", "paused", "archived"] as const;
const activityTypes = ["note", "call", "meeting", "email"] as const;

/** Staff editing forms. Hiding one is convenience only: every action re-checks permission and area on the server. */
export function CrmPanels({ request, advertiserId, status, notes, access }: { request: RequestedShellContext; advertiserId: string; status: string; notes: string; access: CrmAccess }) {
  if (!access.edit && !access.contactManage && !access.activityRecord) return null;

  return (
    <>
      {access.edit ? (
        <Panel eyebrow="Account" title="Status and notes">
          <form action={updateAdvertiserAction.bind(null, request, advertiserId)} className="franchise-form">
            <label>
              Status
              <select name="status" defaultValue={status}>
                {statuses.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
              </select>
            </label>
            <label>
              Internal notes
              <textarea name="notes" rows={3} maxLength={2000} defaultValue={notes} />
            </label>
            <button type="submit" className="r2-button r2-button--primary">Save</button>
          </form>
          <form action={refreshMetricsAction.bind(null, request, advertiserId)}>
            <p>Average sale value, annual value and relationship state are worked out from this advertiser&apos;s bookings.</p>
            <button type="submit" className="r2-button r2-button--secondary">Recalculate from bookings</button>
          </form>
        </Panel>
      ) : null}

      {access.contactManage ? (
        <Panel eyebrow="Contacts" title="Add a contact">
          <form action={addContactAction.bind(null, request, advertiserId)} className="franchise-form">
            <label>Name<input name="name" required maxLength={120} /></label>
            <label>Email<input name="email" type="email" required maxLength={200} /></label>
            <label>Phone<input name="phone" maxLength={40} /></label>
            <label>Role<input name="role" maxLength={60} placeholder="Owner, marketing manager" /></label>
            <label><input type="checkbox" name="isPrimary" /> Primary contact</label>
            <button type="submit" className="r2-button r2-button--primary">Add contact</button>
          </form>
        </Panel>
      ) : null}

      {access.activityRecord ? (
        <Panel eyebrow="Activity" title="Log activity">
          <form action={logActivityAction.bind(null, request, advertiserId)} className="franchise-form">
            <label>
              Type
              <select name="activityType">
                {activityTypes.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
              </select>
            </label>
            <label>Summary<input name="title" required maxLength={160} /></label>
            <label>Details<textarea name="body" rows={3} maxLength={2000} /></label>
            <button type="submit" className="r2-button r2-button--primary">Log</button>
          </form>
        </Panel>
      ) : null}
    </>
  );
}
