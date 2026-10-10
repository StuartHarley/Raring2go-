// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotFound from "../not-found";
import { Disclosure } from "./Disclosure";
import { OutcomePanel } from "./OutcomePanel";
import { SidebarNav } from "./SidebarNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/advertisers/00000000-0000-4000-8000-000000000701",
  useRouter: () => ({ push: vi.fn() })
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement;

function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  window.localStorage.clear();
});

const groups = [
  { id: "today", label: "Today" },
  { id: "commercial", label: "Commercial" },
  { id: "finance", label: "Finance" }
];

const items = [
  { id: "today", label: "My Today", group: "today", href: { pathname: "/app", query: {} } },
  { id: "advertisers", label: "Advertisers", group: "commercial", href: { pathname: "/app/advertisers", query: {} } },
  { id: "pipeline", label: "Pipeline", group: "commercial", href: { pathname: "/app/advertisers/pipeline", query: {} } },
  { id: "finance", label: "Royalties", group: "finance", href: { pathname: "/app/finance", query: {} } }
];

describe("SidebarNav", () => {
  it("marks the longest matching destination current, never My Today for a deeper page", () => {
    mount(<SidebarNav groups={groups} items={items} />);
    const current = host.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe("Advertisers");
  });

  it("keeps the active group open, lets other groups collapse, and remembers the choice", () => {
    mount(<SidebarNav groups={groups} items={items} />);
    const financeToggle = host.querySelector<HTMLButtonElement>("#nav-finance")!;
    expect(financeToggle.getAttribute("aria-expanded")).toBe("true");

    act(() => financeToggle.click());
    expect(financeToggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("#nav-finance-items")?.hasAttribute("hidden")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("raring2go.nav.open-groups") ?? "[]")).toEqual(["today", "commercial"]);

    // The group holding the current page cannot be hidden away.
    const commercialToggle = host.querySelector<HTMLButtonElement>("#nav-commercial")!;
    act(() => commercialToggle.click());
    expect(commercialToggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders groups with icons and a labelled nav landmark", () => {
    mount(<SidebarNav groups={groups} items={items} />);
    expect(host.querySelector('nav[aria-label="Sections"]')).not.toBeNull();
    expect(host.querySelectorAll(".app-nav-group__icon")).toHaveLength(3);
  });
});

describe("Disclosure", () => {
  it("opens as a native details element and closes on Escape or a click elsewhere", () => {
    mount(
      <div>
        <button type="button" id="outside">Elsewhere</button>
        <Disclosure summary="Account" label="Account menu">
          <a href="/sign-out">Sign out</a>
        </Disclosure>
      </div>
    );
    const details = host.querySelector<HTMLDetailsElement>("details")!;
    const summary = host.querySelector<HTMLElement>("summary")!;
    expect(summary.getAttribute("aria-label")).toBe("Account menu");

    act(() => summary.click());
    expect(details.open).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(details.open).toBe(false);

    act(() => summary.click());
    expect(details.open).toBe(true);
    act(() => {
      host.querySelector("#outside")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(details.open).toBe(false);
  });
});

describe("dead-end pages", () => {
  it("renders a branded not-found page with a way back", () => {
    const html = renderToString(<NotFound />);
    expect(html).toContain("We can&#x27;t find that page");
    expect(html).toContain('href="/app"');
    expect(html).toContain("brand-mark");
    expect(html).not.toContain("This page could not be found");
  });

  it("renders denial copy in plain words with the technical reason last", () => {
    const html = renderToString(
      <OutcomePanel eyebrow="Access denied" title="You don't have access to this area" message="Ask your administrator." detail="No permission grant matched this request." actions={<a href="/app">Go to My Today</a>} />
    );
    expect(html.indexOf("Ask your administrator.")).toBeLessThan(html.indexOf("No permission grant matched"));
    expect(html).toContain("app-outcome__actions");
  });
});
