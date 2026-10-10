"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import type { Route } from "next";

type NavItem = {
  id: string;
  label: string;
  group: string;
  href: { pathname: string; query: Record<string, string> };
};

type NavGroup = { id: string; label: string };

const STORAGE_KEY = "raring2go.nav.open-groups";

/**
 * One simple line icon per navigation group, so the sidebar scans by shape as well as by word.
 * Groups, not items, carry icons: thirty item icons would be noise, seven group icons are a map.
 */
function GroupIcon({ group }: { group: string }) {
  const paths: Record<string, React.ReactNode> = {
    today: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    portal: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
      </>
    ),
    franchise: (
      <>
        <path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    commercial: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" />
      </>
    ),
    publishing: (
      <>
        <path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3V5Z" />
        <path d="M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7V5Z" />
      </>
    ),
    marketing: (
      <>
        <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
        <path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" />
      </>
    ),
    finance: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M14.5 8.5a2.5 2.5 0 0 0-4.5 1.5v6M8 12h5M8 16h7" />
      </>
    ),
    administration: (
      <>
        <path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h12M20 17h0" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="9" cy="12" r="2" />
        <circle cx="18" cy="17" r="2" />
      </>
    )
  };

  return (
    <svg aria-hidden="true" className="app-nav-group__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[group] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

const CHANGE_EVENT = "raring2go:nav-groups";

/** The stored preference as a raw string, so React can compare snapshots cheaply; null means "no preference". */
function readStoredRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseOpenGroups(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : undefined;
  } catch {
    return undefined;
  }
}

function storeOpenGroups(groups: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // Private windows and blocked storage simply do not remember the choice.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * Grouped navigation with collapsible sections. The group holding the current page is always
 * open; the others open or close on request and the choice is remembered per browser. Only the
 * single longest-matching href is marked current, so a parent route (e.g. /app/audience) never
 * lights up alongside a more specific child route also in the nav (e.g. /app/audience/segments).
 */
export function SidebarNav({ groups, items }: { groups: NavGroup[]; items: NavItem[] }) {
  const pathname = usePathname();

  // My Today ("/app") is a prefix of everything, so it only counts when it is the page itself;
  // on a page outside the nav (a denial, a record page of a hidden area) nothing lights up.
  const activeId = items
    .filter((item) => pathname === item.href.pathname || (item.href.pathname !== "/app" && pathname.startsWith(`${item.href.pathname}/`)))
    .sort((a, b) => b.href.pathname.length - a.href.pathname.length)[0]?.id;
  const activeGroup = items.find((item) => item.id === activeId)?.group;

  // The server snapshot is "no preference" (every group open), so server and first client render
  // agree; the stored preference takes over right after hydration without a mismatch.
  const storedRaw = useSyncExternalStore(subscribe, readStoredRaw, () => null);
  const openGroups = parseOpenGroups(storedRaw);

  function isOpen(groupId: string) {
    if (groupId === activeGroup) return true;
    if (openGroups === undefined) return true;
    return openGroups.includes(groupId);
  }

  function toggle(groupId: string, open: boolean) {
    const visibleGroupIds = groups.filter((group) => items.some((item) => item.group === group.id)).map((group) => group.id);
    const current = openGroups ?? visibleGroupIds;
    const next = open ? Array.from(new Set([...current, groupId])) : current.filter((id) => id !== groupId);
    storeOpenGroups(next);
  }

  return (
    <nav aria-label="Sections">
      {groups.map((group) => {
        const groupItems = items.filter((item) => item.group === group.id);
        if (groupItems.length === 0) {
          return null;
        }

        const open = isOpen(group.id);

        return (
          <section key={group.id} className="app-nav-group" aria-labelledby={`nav-${group.id}`} data-active={group.id === activeGroup || undefined}>
            <button
              type="button"
              id={`nav-${group.id}`}
              className="app-nav-group__toggle"
              aria-expanded={open}
              aria-controls={`nav-${group.id}-items`}
              onClick={() => toggle(group.id, !open)}
            >
              <GroupIcon group={group.id} />
              <span>{group.label}</span>
              <svg aria-hidden="true" className="app-nav-group__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div id={`nav-${group.id}-items`} className="app-nav-group__items" hidden={!open}>
              {groupItems.map((item) => (
                <Link key={item.id} href={item.href as unknown as Route} aria-current={item.id === activeId ? "page" : undefined}>
                  {item.label}
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </nav>
  );
}
