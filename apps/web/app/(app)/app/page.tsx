import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import type { RequestedShellContext } from "../../../lib/app-shell";
import { resolveShell } from "../../../lib/app-shell";
import { sessionCookieName } from "../../../lib/auth-runtime";
import { parseWorkingContext, workingContextCookieName } from "../../../lib/working-context";
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
    return <ProtectedOutcome outcome={shell} />;
  }

  // An advertiser's login only ever has the portal: send them straight to it.
  if (shell.navigation.length > 0 && shell.navigation.every((item) => item.group === "portal")) {
    redirect("/app/portal" as Route);
  }

  const today = await buildMyToday(shell);
  const place = shell.activeContext.territoryName ?? shell.activeContext.organisationName;

  return (
    <>
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
    </>
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

  const stored = parseWorkingContext(cookieStore.get(workingContextCookieName)?.value);

  return {
    ...request,
    sessionToken: request.sessionToken ?? cookieStore.get(sessionCookieName)?.value,
    // Query parameters win (deep links); otherwise the context the person chose last time.
    organisationId: request.organisationId ?? stored.organisationId,
    territoryId: request.organisationId ? request.territoryId : stored.territoryId,
    contextSource: request.organisationId ? "query" : stored.organisationId ? "stored" : undefined
  };
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
