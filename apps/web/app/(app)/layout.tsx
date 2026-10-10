import Link from "next/link";
import type { Route } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { navigationGroups, resolveShell } from "../../lib/app-shell";
import { safeReturnTo, sessionCookieName } from "../../lib/auth-runtime";
import { initials } from "../../lib/format";
import { parseWorkingContext, workingContextCookieName } from "../../lib/working-context";
import { signOutAction } from "../sign-in/actions";
import { BrandMark } from "./BrandMark";
import { clearContextAction, switchContextAction } from "./context-actions";
import { Disclosure } from "./Disclosure";
import { MobileSidebarToggle } from "./MobileSidebarToggle";
import { OutcomePanel } from "./OutcomePanel";
import { CommandPaletteButton, ShellCommandPalette } from "./ShellCommandPalette";
import { SidebarNav } from "./SidebarNav";

/**
 * The operator shell, rendered once by the layout so it stays put while pages load: brand mark
 * and grouped navigation on the left; the working context, quick navigation (⌘K) and the account
 * menu with sign-out along the top. The working context comes from a cookie (query parameters
 * on a deep link are copied into it by the proxy), so links need no parameters. Pages still
 * prove their own permission before showing anything.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const context = parseWorkingContext(cookieStore.get(workingContextCookieName)?.value);
  const shell = await resolveShell({
    sessionToken: cookieStore.get(sessionCookieName)?.value,
    sessionKey: headerStore.get("x-r2-session-key") ?? undefined,
    ...context
  });

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
                <form action={clearContextAction}>
                  <button type="submit" className="r2-button r2-button--primary">
                    Go to my default context
                  </button>
                </form>
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

  const active = shell.activeContext;
  const contextName = active.territoryName ?? active.organisationName;
  const contextDetail = active.territoryName ? active.organisationName : "Network view";
  const canSwitch = shell.availableContexts.length > 1;
  const destinations = shell.navigation.map((item) => ({ id: item.id, label: item.label, group: item.group, href: { pathname: item.href, query: {} } }));

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
          <SidebarNav groups={navigationGroups} items={destinations} />
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
                        <form action={switchContextAction}>
                          <input type="hidden" name="organisationId" value={context.organisationId} />
                          {context.territoryId ? <input type="hidden" name="territoryId" value={context.territoryId} /> : null}
                          <button type="submit" className="app-menu__choice" aria-current={current ? "true" : undefined}>
                            {context.territoryName ?? context.organisationName}
                            <small>{context.territoryName ? context.organisationName : "Network view"}</small>
                          </button>
                        </form>
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
                  <Link href={"/app/search" as Route}>Search records</Link>
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
      <ShellCommandPalette destinations={destinations} searchHref={{ pathname: "/app/search", query: {} }} />
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
