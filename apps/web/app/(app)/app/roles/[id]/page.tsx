import type { Route } from "next";
import { AccessStateError, grantableScopes } from "@raring2go/access";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { readRoleDetail } from "../../../../../lib/access-runtime";
import { formatCount, formatLabel } from "../../../../../lib/format";
import { Actions, EmptyState, FactList, LinkButton, Notice, PageHeader, Panel, Table } from "../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
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
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  const back = `/app/roles${query.toString() ? `?${query.toString()}` : ""}` as Route;

  let loaded;
  try {
    const shell = await requireShellPermission(request, { module: "roles", action: "view" });
    loaded = await readRoleDetail({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, id);
  } catch (error) {
    if (error instanceof AccessStateError) {
      return (
        <AppShell request={request}>
          <Breadcrumbs items={[{ label: "Roles & permissions", href: back }, { label: "Role not found" }]} />
          <PageHeader
            eyebrow="Roles & permissions"
            title="Role not found"
            intro="This role does not exist or is not visible from your current context."
            actions={
              <LinkButton href={back} variant="secondary">
                Back to roles
              </LinkButton>
            }
          />
        </AppShell>
      );
    }
    return protectedOutcome(error, request);
  }

  const { role, catalogue, canManage } = loaded;
  const resultParam = Array.isArray(search.result) ? search.result[0] : search.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Roles & permissions", href: back }, { label: role.name }]} />
      <PageHeader eyebrow={role.isSystem ? "Built-in role" : "Custom role"} title={role.name} intro={role.description ?? "What this role lets people do, and how far that reaches."}>
        <FactList
          items={[
            { label: "Type", value: role.isSystem ? "Built-in" : "Custom" },
            { label: "Permissions", value: role.grantCount },
            { label: "Held by", value: formatCount(role.assignmentCount, "person", "people") }
          ]}
        />
      </PageHeader>
      {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}
      {role.isSystem ? <Notice tone="info">Built-in roles can only be changed by Super Admin, because changing one changes access for everyone who holds it.</Notice> : null}

      <Panel eyebrow="Permissions" title="Permissions in this role">
        {role.grants.length === 0 ? (
          <EmptyState title="This role grants nothing yet">{canManage ? "Add a permission below to give it something to do." : "Someone who manages roles can add permissions to it."}</EmptyState>
        ) : (
          <Table caption="What this role allows, and how far each permission reaches">
            <thead>
              <tr>
                <th scope="col">Permission</th>
                <th scope="col">Reach</th>
                <th scope="col">What it allows</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {role.grants.map((grant) => (
                <tr key={`${grant.permissionId}:${grant.scope}`}>
                  <th scope="row">
                    <code>
                      {grant.module}.{grant.action}
                    </code>
                  </th>
                  <td>{scopeLabels[grant.scope] ?? formatLabel(grant.scope)}</td>
                  <td>{grant.description ?? ""}</td>
                  <td>
                    {canManage ? (
                      <form action={removeGrantAction.bind(null, request, role.id, grant.permissionId, grant.scope)}>
                        <button type="submit" className="r2-button r2-button--secondary">
                          Remove
                        </button>
                      </form>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {canManage ? (
        <Panel eyebrow="Change this role" title="Add a permission">
          <form action={addGrantAction.bind(null, request, role.id)} className="franchise-form">
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
                    {scopeLabels[scope] ?? formatLabel(scope)}
                  </option>
                ))}
              </select>
            </label>
            <Actions>
              <button type="submit" className="r2-button r2-button--primary">
                Add permission
              </button>
            </Actions>
          </form>
          {!role.isSystem && role.assignmentCount === 0 ? (
            <form action={deleteRoleAction.bind(null, request, role.id)}>
              <Actions>
                <button type="submit" className="r2-button r2-button--danger">
                  Delete this role
                </button>
              </Actions>
            </form>
          ) : null}
        </Panel>
      ) : null}
    </AppShell>
  );
}
