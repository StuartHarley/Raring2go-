import Link from "next/link";
import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { explainAccessAsActor, readAccessOverview } from "../../../../lib/access-runtime";
import type { AccessActorContext } from "../../../../lib/access-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { assignRoleAction, createRoleAction, inviteAction, revokeAssignmentAction, revokeInvitationAction } from "./actions";
import { resultMessages } from "./messages";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Roles & permissions" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function RolesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);

  let loaded;
  try {
    const shell = await requireShellPermission(request, { module: "roles", action: "view" });
    const actor: AccessActorContext = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const overview = await readAccessOverview(actor);

    // "Why can't they?": run only when asked, with the module/action typed in and a person picked.
    const subject = first(params.subject);
    const capability = first(params.capability);
    let explanation;
    if (subject && capability && capability.includes(".")) {
      const cut = capability.lastIndexOf(".");
      const [territoryId] = (first(params.at) ?? "").split(":").slice(1);
      const [organisationId] = (first(params.at) ?? "").split(":");
      explanation = await explainAccessAsActor(actor, { userId: subject, module: capability.slice(0, cut), action: capability.slice(cut + 1), organisationId: organisationId || null, territoryId: territoryId || null });
    }
    loaded = { overview, explanation, subject, capability, at: first(params.at) };
  } catch (error) {
    return protectedOutcome(error, request);
  }

  const { overview, explanation } = loaded;
  const { roles, assignments, invitations, organisations, can, checkedAt } = overview;
  const resultParam = first(params.result);
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const live = assignments.filter((assignment) => !assignment.endsAt || assignment.endsAt > checkedAt);
  const pending = invitations.filter((invitation) => invitation.status === "pending" && invitation.expiresAt > checkedAt);
  const query = contextQuery(request);
  const people = Array.from(new Map(live.map((assignment) => [assignment.userId, assignment])).values());

  const whereOptions = organisations.flatMap((organisation) => [
    <option key={organisation.id} value={organisation.id}>
      {organisation.name}
    </option>,
    ...organisation.territories.map((territory) => (
      <option key={`${organisation.id}:${territory.id}`} value={`${organisation.id}:${territory.id}`}>
        {organisation.name} › {territory.name}
      </option>
    ))
  ]);

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Roles &amp; permissions</p>
        <h2>Who can do what</h2>
        <p>
          Access is defined by roles: each holds permissions at a scope (own record, organisation, territory, network or system), and people are given roles for an organisation or territory. Changes take effect without a
          deploy, are audited, and you can never give out more access than you hold yourself. At least one Super Admin always remains.
        </p>
        {banner ? (
          <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>
            {banner.text}
          </p>
        ) : null}
      </section>

      <section className="app-panel audit-table" aria-label="Roles">
        <p className="eyebrow">Roles</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Type</th>
                <th>Permissions</th>
                <th>People</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td>
                    <Link href={`/app/roles/${role.id}${query}` as Route}>{role.name}</Link>
                    {role.description ? <div className="muted">{role.description}</div> : null}
                  </td>
                  <td>{role.isSystem ? "Built-in" : "Custom"}</td>
                  <td>{role.grantCount}</td>
                  <td>{role.assignmentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can.manage ? (
          <form action={createRoleAction.bind(null, request)} className="franchise-form">
            <h3>Create a role</h3>
            <label>
              Name
              <input name="name" type="text" required minLength={2} maxLength={80} />
            </label>
            <label>
              Key (lowercase, used in records)
              <input name="key" type="text" required pattern="[a-z][a-z0-9_-]{2,39}" />
            </label>
            <label>
              Description
              <input name="description" type="text" maxLength={300} />
            </label>
            <div className="franchise-actions">
              <button type="submit">Create role</button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="app-panel audit-table" aria-label="People and their roles">
        <p className="eyebrow">People</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Where</th>
                <th>Ends</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {live.length === 0 ? (
                <tr>
                  <td colSpan={5}>Nobody holds a role yet.</td>
                </tr>
              ) : (
                live.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      {assignment.userName ?? assignment.userEmail}
                      <div className="muted">{assignment.userEmail}</div>
                      {assignment.userStatus !== "active" ? <div className="muted">Account {assignment.userStatus}</div> : null}
                    </td>
                    <td>{assignment.roleName}</td>
                    <td>{[assignment.organisationName, assignment.territoryName].filter(Boolean).join(" › ") || "Network"}</td>
                    <td>{assignment.endsAt ? assignment.endsAt.toLocaleDateString("en-GB") : "No end date"}</td>
                    <td>
                      {can.assign ? (
                        <form action={revokeAssignmentAction.bind(null, request, assignment.id)}>
                          <button type="submit">End role</button>
                        </form>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {can.assign ? (
          <form action={assignRoleAction.bind(null, request)} className="franchise-form">
            <h3>Give someone a role</h3>
            <p className="muted">They must already belong to the organisation: invite them below if they do not.</p>
            <label>
              Their email address
              <input name="email" type="email" required maxLength={254} />
            </label>
            <label>
              Role
              <select name="roleId" required>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Where
              <select name="where" required>
                {whereOptions}
              </select>
            </label>
            <label>
              Ends on (optional)
              <input name="endsAt" type="date" />
            </label>
            <div className="franchise-actions">
              <button type="submit">Give role</button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="app-panel audit-table" aria-label="Invitations">
        <p className="eyebrow">Invitations</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Where</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                <tr>
                  <td colSpan={5}>No pending invitations.</td>
                </tr>
              ) : (
                pending.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.email}</td>
                    <td>{invitation.roleName ?? "Membership only"}</td>
                    <td>{[invitation.organisationName, invitation.territoryName].filter(Boolean).join(" › ")}</td>
                    <td>{invitation.expiresAt.toLocaleDateString("en-GB")}</td>
                    <td>
                      {can.invite ? (
                        <form action={revokeInvitationAction.bind(null, request, invitation.id)}>
                          <button type="submit">Withdraw</button>
                        </form>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {can.invite ? (
          <form action={inviteAction.bind(null, request)} className="franchise-form">
            <h3>Invite someone</h3>
            <label>
              Email address
              <input name="email" type="email" required maxLength={254} />
            </label>
            <label>
              Where
              <select name="where" required>
                {whereOptions}
              </select>
            </label>
            <label>
              Role they receive on accepting
              <select name="roleId" defaultValue="">
                <option value="">None (membership only)</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="franchise-actions">
              <button type="submit">Send invitation</button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="app-panel franchise-panel" aria-label="Explain access">
        <p className="eyebrow">Check access</p>
        <h2>Why can or can&apos;t someone do something?</h2>
        <form method="get" className="franchise-form">
          {request.sessionKey ? <input type="hidden" name="session" value={request.sessionKey} /> : null}
          <label>
            Person
            <select name="subject" defaultValue={loaded.subject ?? ""} required>
              <option value="" disabled>
                Choose…
              </option>
              {people.map((assignment) => (
                <option key={assignment.userId} value={assignment.userId}>
                  {assignment.userName ?? assignment.userEmail}
                </option>
              ))}
            </select>
          </label>
          <label>
            Capability (module.action, for example system.jobs.view)
            <input name="capability" type="text" defaultValue={loaded.capability ?? ""} required pattern="[a-z_.]+\.[a-z_]+" />
          </label>
          <label>
            Where
            <select name="at" defaultValue={loaded.at ?? ""}>
              <option value="">Anywhere (network level)</option>
              {whereOptions}
            </select>
          </label>
          <div className="franchise-actions">
            <button type="submit">Check</button>
          </div>
        </form>
        {explanation ? (
          <p role="status" className={`notice notice--${explanation.allowed ? "success" : "error"}`}>
            {explanation.allowed ? "Allowed. " : "Not allowed. "}
            {explanation.explanation}
          </p>
        ) : null}
      </section>
    </AppShell>
  );
}

function contextQuery(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const text = query.toString();
  return text ? `?${text}` : "";
}
