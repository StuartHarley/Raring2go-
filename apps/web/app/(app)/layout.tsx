import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { navigationGroups, resolveShell } from "../../lib/app-shell";
import type { RequestedShellContext, ResolvedShell } from "../../lib/app-shell";
import { safeReturnTo } from "../../lib/auth-runtime";
import { initials } from "../../lib/format";
import { signOutAction } from "../sign-in/actions";
import { BrandMark } from "./BrandMark";
import { Disclosure } from "./Disclosure";
import { MobileSidebarToggle } from "./MobileSidebarToggle";
import { OutcomePanel } from "./OutcomePanel";
import { CommandPaletteButton, ShellCommandPalette } from "./ShellCommandPalette";
import { SidebarNav } from "./SidebarNav";

type AppLayoutProps = {
  children: React.ReactNode;
};

export default async function AppLayout({ children }: AppLayoutProps) {
  return <>{children}</>;
}

/**
 * The operator shell: brand mark and grouped navigation on the left; the working context, quick
 * navigation (⌘K) and the account menu with sign-out along the top. Pages render inside it after
 * proving their own permission, and pass the request so every link keeps the chosen context.
 */
export async function AppShell({
  children,
  request,
  shell: resolved
}: AppLayoutProps & {
  request: RequestedShellContext;
  /** A shell the page already resolved, so it is not resolved twice. */
  shell?: ResolvedShell;
}) {
  const shell = resolved ?? (await resolveShell(request));

  if (shell.kind === "unauthenticated") {
    redirect(`/sign-in?returnTo=${encodeURIComponent(safeReturnTo("/app"))}` as Route);
  }

  if (shell.kind !== "authenticated") {
    return (
      <main className={`app-outcome app-outcome-${shell.kind}`}>
        <section>
          <BrandMark />
          <OutcomePanel
            eyebrow={shell.kind === "invalid_context" ? "Context unavailable" : "Access denied"}
            title={shell.title}
            message={shell.message}
            actions={
              <>
                <Link href="/app" className="r2-button r2-button--primary">
                  Go to My Today
                </Link>
                <Link href="/sign-out" className="r2-button r2-button--quiet">
                  Sign out
                </Link>
              </>
            }
          />
        </section>
      </main>
    );
  }

  const navItems = shell.navigation.map((item) => ({ ...item, href: withContext(item.href, request) }));
  const searchHref = withContext("/app/search", request);
  const active = shell.activeContext;
  const contextName = active.territoryName ?? active.organisationName;
  const contextDetail = active.territoryName ? active.organisationName : "Network view";
  const canSwitch = shell.availableContexts.length > 1;

  const contextSummary = (
    <>
      <span className="app-context__text">
        <span className="app-context__name">{contextName}</span>
        <span className="app-context__detail">{contextDetail}</span>
      </span>
      {canSwitch ? <Chevron /> : null}
    </>
  );

  return (
    <main className="app-shell">
      <aside className="app-sidebar" aria-label="Application navigation">
        <BrandMark />
        <MobileSidebarToggle>
          <SidebarNav groups={navigationGroups} items={navItems} />
        </MobileSidebarToggle>
      </aside>
      <section className="app-workspace">
        <header className="app-topbar">
          <div className="app-topbar__context">
            {canSwitch ? (
              <Disclosure label="Switch working context" summaryClassName="app-context" className="app-menu--left" summary={contextSummary}>
                <p className="app-menu__title">Switch to</p>
                <ul className="app-menu__list">
                  {shell.availableContexts.map((context) => {
                    const current = context.organisationId === active.organisationId && (context.territoryId ?? null) === (active.territoryId ?? null);
                    return (
                      <li key={`${context.organisationId}:${context.territoryId ?? "network"}`}>
                        <Link
                          href={withContext("/app", {
                            ...request,
                            organisationId: context.organisationId,
                            territoryId: context.territoryId
                          })}
                          aria-current={current ? "true" : undefined}
                        >
                          {context.territoryName ?? context.organisationName}
                          <small>{context.territoryName ? context.organisationName : "Network view"}</small>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Disclosure>
            ) : (
              <div className="app-context app-context--static" aria-label="Working context">
                {contextSummary}
              </div>
            )}
          </div>
          <div className="app-topbar__tools">
            <CommandPaletteButton />
            <Disclosure
              label="Account menu"
              summaryClassName="app-account"
              summary={
                <>
                  <span className="app-account__avatar" aria-hidden="true">
                    {initials(shell.displayName)}
                  </span>
                  <span className="app-account__name">{shell.displayName}</span>
                  <Chevron />
                </>
              }
            >
              <p className="app-menu__title">{shell.displayName}</p>
              <p className="app-menu__meta">
                {contextName}
                {active.territoryName ? ` · ${active.organisationName}` : ""}
              </p>
              <ul className="app-menu__list">
                <li>
                  <Link href={searchHref}>Search records</Link>
                </li>
                <li>
                  <Link href={"/sign-out" as Route}>Sign out of all devices…</Link>
                </li>
              </ul>
              <form action={signOutAction}>
                <button type="submit" className="r2-button r2-button--secondary">
                  Sign out
                </button>
              </form>
            </Disclosure>
          </div>
        </header>
        {children}
      </section>
      <ShellCommandPalette destinations={navItems} searchHref={searchHref} />
    </main>
  );
}

function Chevron() {
  return (
    <svg aria-hidden="true" className="app-menu__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
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
