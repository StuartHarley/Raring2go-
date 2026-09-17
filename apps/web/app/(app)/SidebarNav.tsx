"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

type NavItem = {
  id: string;
  label: string;
  group: string;
  href: { pathname: string; query: Record<string, string> };
};

type NavGroup = { id: string; label: string };

/**
 * A client component purely so usePathname() can tell one link apart from
 * the rest - the server-rendered shell around it stays untouched. Only the
 * single longest-matching href is ever marked current, so a parent route
 * (e.g. /app/audience) never lights up alongside a more specific child
 * route also in the nav (e.g. /app/audience/segments).
 */
export function SidebarNav({ groups, items }: { groups: NavGroup[]; items: NavItem[] }) {
  const pathname = usePathname();

  const activeId = items
    .filter((item) => pathname === item.href.pathname || pathname.startsWith(`${item.href.pathname}/`))
    .sort((a, b) => b.href.pathname.length - a.href.pathname.length)[0]?.id;

  return (
    <nav>
      {groups.map((group) => {
        const groupItems = items.filter((item) => item.group === group.id);
        if (groupItems.length === 0) {
          return null;
        }

        return (
          <section key={group.id} className="app-nav-group" aria-labelledby={`nav-${group.id}`}>
            <h3 id={`nav-${group.id}`}>{group.label}</h3>
            {groupItems.map((item) => (
              <Link key={item.id} href={item.href as unknown as Route} aria-current={item.id === activeId ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </section>
        );
      })}
    </nav>
  );
}
