import Link from "next/link";
import type { Route } from "next";
import { AccessStateError, grantableScopes } from "@raring2go/access";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readRoleDetail } from "../../../../../lib/access-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { addGrantAction, deleteRoleAction, removeGrantAction } from "../actions";
import { resultMessages } from "../messages";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Role" };

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const scopeLabels: Record<string, string> = {
  own_record: "Own records only",
  own_organisation: "Own organisation",
  own_territory: "Own territory",
  network: "Whole network",
  system: "System"
};

export default async function RoleDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);

  let loaded;
  try {
    const shell = await requireShellPermission(request, { module: "roles", action: "view" });
    loaded = await readRoleDetail({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, id);
  } catch (error) {
    if (error instanceof AccessStateError) {
      return (
        <AppShell request={request}>
          <section className="app-panel">
            <h2>Role not found</h2>
            <p>
              <Link href={"/app/roles" as Route}>Back to roles</Link>
            </p>
          </section>
        </AppShell>
      );
    }
    return protectedOutcome(error, request);
  }

  const { role, catalogue, canManage } = loaded;
  const resultParam = Array.isArray(search.result) ? search.result[0] : search.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  const back = `/app/roles${query.toString() ? `?${query.toString()}` : ""}` as Route;

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">{role.isSystem ? "Built-in role" : "Custom role"}</p>
        <h2>{role.name}</h2>
        {role.description ? <p>{role.description}</p> : null}
        <p>
          {role.grantCount} permissions · held by {role.assignmentCount} {role.assignmentCount === 1 ? "person" : "people"}. <Link href={back}>Back to roles</Link>
        </p>
        {banner ? (
          <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>
            {banner.text}
          </p>
        ) : null}
        {role.isSystem ? <p className="muted">Built-in roles can only be changed by Super Admin, because changing one changes access for everyone who holds it.</p> : null}
      </section>

      <section className="app-panel audit-table" aria-label="Permissions in this role">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Permission</th>
                <th>Reach</th>
                <th>What it allows</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {role.grants.length === 0 ? (
                <tr>
                  <td colSpan={4}>This role grants nothing yet.</td>
                </tr>
              ) : (
                role.grants.map((grant) => (
                  <tr key={`${grant.permissionId}:${grant.scope}`}>
                    <td>
                      <code>
                        {grant.module}.{grant.action}
                      </code>
                    </td>
                    <td>{scopeLabels[grant.scope] ?? grant.scope}</td>
                    <td>{grant.description ?? ""}</td>
                    <td>
                      {canManage ? (
                        <form action={removeGrantAction.bind(null, request, role.id, grant.permissionId, grant.scope)}>
                          <button type="submit">Remove</button>
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
      </section>

      {canManage ? (
        <section className="app-panel franchise-panel" aria-label="Add a permission">
          <form action={addGrantAction.bind(null, request, role.id)} className="franchise-form">
            <h3>Add a permission</h3>
            <label>
              Permission
              <select name="permissionId" required>
                {catalogue.map((permission) => (
                  <option key={permission.id} value={permission.id}>
                    {permission.module}.{permission.action}
                    {permission.description ? ` — ${permission.description}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              How far it reaches
              <select name="scope" defaultValue="own_territory">
                {grantableScopes.map((scope) => (
                  <option key={scope} value={scope}>
                    {scopeLabels[scope]}
                  </option>
                ))}
              </select>
            </label>
            <div className="franchise-actions">
              <button type="submit">Add permission</button>
            </div>
          </form>
          {!role.isSystem && role.assignmentCount === 0 ? (
            <form action={deleteRoleAction.bind(null, request, role.id)}>
              <button type="submit">Delete this role</button>
            </form>
          ) : null}
        </section>
      ) : null}
    </AppShell>
  );
}
