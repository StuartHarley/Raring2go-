import { cookies } from "next/headers";
import { AppShell } from "../layout";
import type { RequestedShellContext } from "../../../lib/app-shell";
import { resolveShell } from "../../../lib/app-shell";
import { sessionCookieName } from "../../../lib/auth-runtime";
import { buildMyToday } from "../../../lib/my-today";
import { ProtectedOutcome } from "../../../lib/protected-outcome";
import { RelatedRecords } from "../../../lib/workflow-ui";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AppHome({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const shell = await resolveShell(request);

  if (shell.kind !== "authenticated") {
    return <ProtectedOutcome outcome={shell} />;
  }

  const today = await buildMyToday(shell);

  return (
    <AppShell request={request}>
      <section className="app-panel today-hero">
        <p className="eyebrow">My Today</p>
        <h2>{shell.displayName.split(" ")[0]}, here is what needs attention</h2>
        <p>
          A role-aware operating view across franchise, commercial, publishing
          and marketing work for {shell.activeContext.territoryName ?? shell.activeContext.organisationName}.
        </p>
        <div className="today-metrics">
          {today.metrics.map((metric) => (
            <article key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.detail}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="app-panel today-grid">
        <article>
          <p className="eyebrow">Attention queue</p>
          <h2>Needs a decision</h2>
          <div className="today-list">
            {today.attention.length === 0 ? (
              <p className="empty-state">No urgent cross-module items are visible in this context.</p>
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
        </article>
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
