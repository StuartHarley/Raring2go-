import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { AppShell } from "../layout";
import type { RequestedShellContext } from "../../../lib/app-shell";
import { resolveShell } from "../../../lib/app-shell";
import { sessionCookieName } from "../../../lib/auth-runtime";
import { firstName } from "../../../lib/format";
import { buildMyToday } from "../../../lib/my-today";
import { EmptyState, Metrics, PageHeader, Panel } from "../../../lib/page-ui";
import { ProtectedOutcome } from "../../../lib/protected-outcome";
import { RelatedRecords } from "../../../lib/workflow-ui";

export const metadata = { title: "My Today" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AppHome({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const shell = await resolveShell(request);

  if (shell.kind !== "authenticated") {
    return <ProtectedOutcome outcome={shell} request={request} />;
  }

  // An advertiser's login only ever has the portal: send them straight to it.
  if (shell.navigation.length > 0 && shell.navigation.every((item) => item.group === "portal")) {
    const query = new URLSearchParams();
    if (request.sessionKey) query.set("session", request.sessionKey);
    if (request.organisationId) query.set("organisationId", request.organisationId);
    redirect(`/app/portal${query.toString() ? `?${query.toString()}` : ""}` as Route);
  }

  const today = await buildMyToday(shell);
  const place = shell.activeContext.territoryName ?? shell.activeContext.organisationName;

  return (
    <AppShell request={request} shell={shell}>
      <PageHeader
        eyebrow="My Today"
        title={`${firstName(shell.displayName)}, here is what needs attention`}
        intro={`What is moving across franchise, commercial, publishing and marketing work for ${place} today.`}
      />

      <Panel>
        <Metrics items={today.metrics.map((metric) => ({ label: metric.label, value: metric.value, detail: metric.detail, tone: metric.tone }))} />
      </Panel>

      <section className="today-grid">
        <Panel eyebrow="Attention queue" title="Needs a decision">
          <div className="today-list">
            {today.attention.length === 0 ? (
              <EmptyState title="Nothing needs a decision right now">
                Exceptions from every area you can see will appear here as they happen.
              </EmptyState>
            ) : (
              today.attention.map((item) => (
                <a key={item.id} href={item.href} className={`today-item today-item-${item.priority}`}>
                  <span>{item.area}</span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </a>
              ))
            )}
          </div>
        </Panel>
        <RelatedRecords
          title="Workflow shortcuts"
          records={today.workflows.map((workflow) => ({
            label: "Open",
            title: workflow.label,
            description: workflow.status,
            href: workflow.href
          }))}
        />
      </section>
    </AppShell>
  );
}

export function requestFromSearchParams(
  params: Record<string, string | string[] | undefined>
): RequestedShellContext {
  return {
    sessionKey: first(params.session),
    sessionToken: first(params.sessionToken),
    organisationId: first(params.organisationId),
    territoryId: first(params.territoryId)
  };
}

export async function requestFromSearchParamsAndCookies(
  params: Record<string, string | string[] | undefined>
): Promise<RequestedShellContext> {
  const request = requestFromSearchParams(params);
  const cookieStore = await cookies();

  return {
    ...request,
    sessionToken: request.sessionToken ?? cookieStore.get(sessionCookieName)?.value
  };
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
