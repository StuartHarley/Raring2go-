import type { PermissionData } from "@raring2go/permissions";
import type { PrivacyRequestRecord } from "@raring2go/security";
import { requireShellPermission } from "../../../../lib/app-shell";
import { can, readPrivacyRequests } from "../../../../lib/privacy-runtime";
import type { PrivacyActorContext } from "../../../../lib/privacy-runtime";
import { formatDate } from "../../../../lib/format";
import { Actions, EmptyState, Metrics, Notice, PageHeader, Panel, StatusBadge, Table } from "../../../../lib/page-ui";
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
      {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}
      <PageHeader
        eyebrow="Privacy"
        title="Data-subject requests"
        intro="Subscribers asking for a copy of the data held about them, or for it to be erased. Each one is due within one month."
      />

      <Panel>
        <Metrics
          items={[
            { label: "Open", value: open.length, tone: open.length > 0 ? "warning" : "success" },
            { label: "Overdue", value: overdue.length, tone: overdue.length > 0 ? "danger" : "success" }
          ]}
        />
      </Panel>

      {can(permissions, context, "create") ? (
        <Panel
          eyebrow="New"
          title="Open a request"
          intro="Subscribers are shared across territories, so only Head Office handles these. An erasure needs a second person to approve it; afterwards only the suppression entry that stops them being emailed again remains."
        >
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
            <Actions>
              <button type="submit" className="r2-button r2-button--primary">
                Open request
              </button>
            </Actions>
          </form>
        </Panel>
      ) : null}

      <Panel eyebrow="Requests" title="All requests">
        {requests.length === 0 ? (
          <EmptyState title="No requests yet">Requests you open appear here with their deadline and outcome.</EmptyState>
        ) : (
          <Table caption="Data-subject requests with their deadlines and outcomes">
            <thead>
              <tr>
                <th scope="col">Opened</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Due</th>
                <th scope="col">Outcome</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((entry) => {
                const isOverdue = entry.status === "requested" && entry.dueAt.getTime() < now;
                return (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.createdAt)}</td>
                    <td>{kindLabels[entry.kind]}</td>
                    <td>
                      <StatusBadge
                        status={statusLabels[entry.status]}
                        tone={entry.status === "requested" ? (isOverdue ? "danger" : "warning") : entry.status === "completed" ? "success" : "neutral"}
                      />
                    </td>
                    <td>
                      {formatDate(entry.dueAt)}
                      {isOverdue ? " (overdue)" : ""}
                    </td>
                    <td>{describeOutcome(entry)}</td>
                    <td>{actionsFor(entry, permissions, context, request, query)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
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
    return (
      <a className="r2-button r2-button--secondary" href={`/app/privacy/${entry.id}/export${query}`}>
        Download data (JSON)
      </a>
    );
  }
  if (entry.kind === "erasure" && entry.status === "requested" && can(permissions, context, "decide")) {
    if (entry.requestedByUserId === context.userId) return <span>Waiting for a second person to approve</span>;
    return (
      <Actions>
        <form action={decideAction.bind(null, request, entry.id, "approve")}>
          <input name="note" type="text" maxLength={500} placeholder="Note (optional)" aria-label="Decision note" />
          <button type="submit" className="r2-button r2-button--danger">
            Approve and erase
          </button>
        </form>
        <form action={decideAction.bind(null, request, entry.id, "reject")}>
          <button type="submit" className="r2-button r2-button--secondary">
            Reject
          </button>
        </form>
      </Actions>
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
