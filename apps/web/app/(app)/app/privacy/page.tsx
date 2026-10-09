import type { PermissionData } from "@raring2go/permissions";
import type { PrivacyRequestRecord } from "@raring2go/security";
import { requireShellPermission } from "../../../../lib/app-shell";
import { can, readPrivacyRequests } from "../../../../lib/privacy-runtime";
import type { PrivacyActorContext } from "../../../../lib/privacy-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { decideAction, openRequestAction } from "./actions";
import { getPermissionData } from "../../../../lib/permission-source";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Privacy requests" };

const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  opened: { tone: "success", text: "Request opened. The one-month deadline is shown below." },
  already_open: { tone: "success", text: "There is already an open request of this type for that person, so no duplicate was created." },
  erased: { tone: "success", text: "Erasure approved and carried out." },
  rejected: { tone: "success", text: "Erasure request rejected. Nothing was changed." },
  not_allowed: { tone: "error", text: "You do not have permission to do that." },
  invalid_input: { tone: "error", text: "Enter a valid email address and choose a request type." },
  needs_second_person: { tone: "error", text: "A different person must approve or reject an erasure request: you cannot decide one you raised." },
  wrong_state: { tone: "error", text: "That request has already been decided. Refresh and check its status." }
};

const kindLabels = { export: "Data access (export)", erasure: "Erasure" } as const;
const statusLabels = { requested: "Open", completed: "Completed", rejected: "Rejected" } as const;

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PrivacyRequestsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);

  let loaded;
  try {
    const shell = await requireShellPermission(request, { module: "privacy.request", action: "view" });
    const context: PrivacyActorContext = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    loaded = { context, permissions: await getPermissionData(), ...(await readPrivacyRequests(context)) };
  } catch (error) {
    return protectedOutcome(error, request);
  }

  const { context, permissions, requests, checkedAt } = loaded;
  const resultParam = Array.isArray(params.result) ? params.result[0] : params.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const now = checkedAt.getTime();
  const open = requests.filter((entry) => entry.status === "requested");
  const overdue = open.filter((entry) => entry.dueAt.getTime() < now);
  const query = contextQuery(request);

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Privacy</p>
        <h2>Data-subject requests</h2>
        <p>
          Subscribers can ask for a copy of the data held about them, or for it to be erased. A response is due within one month. Subscribers are shared across territories, so only Head Office handles these. An erasure needs a second
          person to approve it, and what remains afterwards is only the suppression entry that stops them being emailed again.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Open</span>
            <strong>{open.length}</strong>
          </article>
          <article>
            <span>Overdue</span>
            <strong>{overdue.length}</strong>
          </article>
        </div>
        {banner ? (
          <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>
            {banner.text}
          </p>
        ) : null}
      </section>

      {can(permissions, context, "create") ? (
        <section className="app-panel franchise-panel" aria-label="Open a request">
          <p className="eyebrow">New</p>
          <h2>Open a request</h2>
          <form action={openRequestAction.bind(null, request)} className="franchise-form">
            <label>
              Subscriber&apos;s email address
              <input name="email" type="email" required maxLength={254} autoComplete="off" />
            </label>
            <label>
              Request type
              <select name="kind" defaultValue="export">
                <option value="export">Data access: give them a copy of their data</option>
                <option value="erasure">Erasure: delete their personal data</option>
              </select>
            </label>
            <label>
              Note (how their identity was checked, where the request came from)
              <input name="note" type="text" maxLength={500} />
            </label>
            <div className="franchise-actions">
              <button type="submit">Open request</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="app-panel audit-table" aria-label="Requests">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Opened</th>
                <th>Type</th>
                <th>Status</th>
                <th>Due</th>
                <th>Outcome</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={6}>No requests yet.</td>
                </tr>
              ) : (
                requests.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.createdAt.toLocaleDateString("en-GB")}</td>
                    <td>{kindLabels[entry.kind]}</td>
                    <td>{statusLabels[entry.status]}</td>
                    <td>
                      {entry.dueAt.toLocaleDateString("en-GB")}
                      {entry.status === "requested" && entry.dueAt.getTime() < now ? " (overdue)" : ""}
                    </td>
                    <td>{describeOutcome(entry)}</td>
                    <td>{actionsFor(entry, permissions, context, request, query)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

function describeOutcome(entry: PrivacyRequestRecord) {
  const summary = entry.resultSummary;
  if (entry.status === "rejected") return entry.decisionNote ? `Rejected: ${entry.decisionNote}` : "Rejected";
  if (entry.status !== "completed") return "—";
  if (summary.dataHeld === false) return "No data held for this email address.";
  const counts = (summary.erased ?? summary.exported) as Record<string, number> | undefined;
  if (!counts) return "Completed";
  const total = Object.entries(counts)
    .filter(([key]) => key !== "contact" && key !== "hasPreferences")
    .reduce((sum, [, value]) => sum + value, 0);
  return `${entry.kind === "erasure" ? "Erased" : "Exported"}: ${total} related records`;
}

function actionsFor(entry: PrivacyRequestRecord, permissions: PermissionData, context: PrivacyActorContext, request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, query: string) {
  if (entry.kind === "export" && entry.subjectContactId && entry.status !== "rejected" && can(permissions, context, "export")) {
    return <a href={`/app/privacy/${entry.id}/export${query}`}>Download data (JSON)</a>;
  }
  if (entry.kind === "erasure" && entry.status === "requested" && can(permissions, context, "decide")) {
    if (entry.requestedByUserId === context.userId) return <span>Waiting for a second person to approve</span>;
    return (
      <div className="franchise-actions">
        <form action={decideAction.bind(null, request, entry.id, "approve")}>
          <input name="note" type="text" maxLength={500} placeholder="Note (optional)" aria-label="Decision note" />
          <button type="submit">Approve and erase</button>
        </form>
        <form action={decideAction.bind(null, request, entry.id, "reject")}>
          <button type="submit">Reject</button>
        </form>
      </div>
    );
  }
  return "—";
}

function contextQuery(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const text = query.toString();
  return text ? `?${text}` : "";
}
