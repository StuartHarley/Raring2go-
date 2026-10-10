"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { Route } from "next";
import { CommandPalette } from "@raring2go/ui";
import type { Command } from "@raring2go/ui";

export type PaletteDestination = {
  id: string;
  label: string;
  group: string;
  href: { pathname: string; query: Record<string, string> };
};

function toUrl(href: PaletteDestination["href"]) {
  const query = new URLSearchParams(href.query).toString();
  return (query ? `${href.pathname}?${query}` : href.pathname) as Route;
}

/**
 * ⌘K / Ctrl+K quick navigation over the destinations this person is allowed to see, plus a
 * search command that hands anything else to global search. The list is the same
 * permission-filtered navigation the sidebar renders, so the palette can never show a route
 * the shell would hide.
 */
export function ShellCommandPalette({ destinations, searchHref }: { destinations: PaletteDestination[]; searchHref: PaletteDestination["href"] }) {
  const router = useRouter();

  const commands = useMemo<Command[]>(
    () => [
      ...destinations.map((destination) => ({
        id: destination.id,
        label: destination.label,
        hint: destination.group,
        keywords: [destination.group, destination.id.replace(/-/g, " ")],
        run: () => router.push(toUrl(destination.href))
      })),
      {
        id: "command-search-records",
        label: "Search records…",
        hint: "Find franchisees, advertisers, editions or content",
        keywords: ["find", "lookup", "global search"],
        run: () => router.push(toUrl(searchHref))
      },
      {
        id: "command-sign-out",
        label: "Sign out",
        hint: "End this session",
        keywords: ["logout", "log out", "leave"],
        run: () => router.push("/sign-out" as Route)
      }
    ],
    [destinations, router, searchHref]
  );

  return <CommandPalette commands={commands} label="Go to a page or search" />;
}

/** The visible way in for people who do not know the shortcut; it just replays ⌘K. */
export function CommandPaletteButton() {
  return (
    <button
      type="button"
      className="app-topbar__search"
      onClick={() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true }));
      }}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <span>Go to…</span>
      <kbd aria-hidden="true">⌘K</kbd>
    </button>
  );
}
