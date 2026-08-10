import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { resolveShell } from "../../lib/app-shell";
import { safeReturnTo } from "../../lib/auth-runtime";
import type { RequestedShellContext } from "../../lib/app-shell";

type AppLayoutProps = {
  children: React.ReactNode;
};

export default async function AppLayout({ children }: AppLayoutProps) {
  return <>{children}</>;
}

export async function AppShell({
  children,
  request
}: AppLayoutProps & {
  request: RequestedShellContext;
}) {
  const shell = await resolveShell(request);

  if (shell.kind === "unauthenticated") {
    redirect(`/sign-in?returnTo=${encodeURIComponent(safeReturnTo("/app"))}` as Route);
  }

  if (shell.kind !== "authenticated") {
    return (
      <main className={`app-outcome app-outcome-${shell.kind}`}>
        <section>
          <p className="eyebrow">{shell.kind.replace("_", " ")}</p>
          <h1>{shell.title}</h1>
          <p>{shell.message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="app-sidebar" aria-label="Application navigation">
        <div>
          <p className="eyebrow">Raring2go!</p>
          <h1>Business-in-a-Box</h1>
        </div>
        <nav>
          {shell.navigation.map((item) => (
            <Link key={item.id} href={withContext(item.href, request)}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <section className="app-workspace">
        <header className="app-topbar">
          <div>
            <p className="eyebrow">{shell.displayName}</p>
            <h2>{shell.activeContext.organisationName}</h2>
            {shell.activeContext.territoryName ? (
              <p>{shell.activeContext.territoryName}</p>
            ) : (
              <p>Network/system context</p>
            )}
          </div>
          <div className="context-list" aria-label="Available contexts">
            {shell.availableContexts.map((context) => (
              <Link
                key={`${context.organisationId}:${context.territoryId ?? "network"}`}
                href={withContext("/app", {
                  ...request,
                  organisationId: context.organisationId,
                  territoryId: context.territoryId
                })}
              >
                {context.territoryName ?? context.organisationName}
              </Link>
            ))}
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}

function withContext(href: string, request: RequestedShellContext) {
  const query: Record<string, string> = {};

  if (request.sessionKey) {
    query.session = request.sessionKey;
  }

  if (request.organisationId) {
    query.organisationId = request.organisationId;
  }

  if (request.territoryId) {
    query.territoryId = request.territoryId;
  }

  return {
    pathname: href,
    query
  };
}
