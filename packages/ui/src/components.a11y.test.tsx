// @vitest-environment jsdom
import axe from "axe-core";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CommandPalette, DataTable, Drawer, Modal, filterCommands } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement;

function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

function key(target: Element | Document, init: KeyboardEventInit) {
  act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
}

async function violations(container: Element = document.body) {
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.html}`);
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});

beforeAll(() => {
  // jsdom has no layout; focus handling is what matters here.
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

function Harness({ variant }: { variant: "modal" | "drawer" }) {
  const [open, setOpen] = useState(false);
  const Panel = variant === "modal" ? Modal : Drawer;
  return (
    <>
      <button id="opener" onClick={() => setOpen(true)}>Open</button>
      <Panel open={open} onClose={() => setOpen(false)} title="Edit details" footer={<button id="save">Save</button>}>
        <label>Name <input id="name" /></label>
      </Panel>
    </>
  );
}

describe.each(["modal", "drawer"] as const)("%s", (variant) => {
  it("is a labelled dialog, focuses inside on open, traps Tab, closes on Escape and returns focus", async () => {
    mount(<Harness variant={variant} />);
    const opener = document.getElementById("opener")!;
    opener.focus();
    act(() => opener.click());

    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Edit details");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(await violations()).toEqual([]);

    // Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last.
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button, input")];
    focusable[focusable.length - 1]!.focus();
    key(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
    key(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);

    key(document.activeElement!, { key: "Escape" });
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes from the close button", () => {
    mount(<Harness variant={variant} />);
    act(() => document.getElementById("opener")!.click());
    act(() => (document.querySelector("[aria-label=Close]") as HTMLElement).click());
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});

describe("DataTable", () => {
  const rows = [{ id: "1", name: "Charlie", n: 3 }, { id: "2", name: "Alpha", n: 10 }, { id: "3", name: "Bravo", n: 2 }];
  const columns = [
    { key: "name", header: "Name", render: (row: (typeof rows)[number]) => row.name, sortValue: (row: (typeof rows)[number]) => row.name, rowHeader: true },
    { key: "n", header: "Count", render: (row: (typeof rows)[number]) => row.n, sortValue: (row: (typeof rows)[number]) => row.n }
  ];
  const names = () => [...document.querySelectorAll("tbody th")].map((cell) => cell.textContent);

  it("is an accessible table whose sort buttons work from the keyboard and keep aria-sort current", async () => {
    mount(<DataTable caption="Advertisers" columns={columns} rows={rows} rowKey={(row) => row.id} />);
    expect(await violations()).toEqual([]);
    expect(document.querySelector("caption")?.textContent).toBe("Advertisers");

    const [nameHeader, countHeader] = [...document.querySelectorAll("th[scope=col]")];
    expect(nameHeader!.getAttribute("aria-sort")).toBe("none");
    act(() => nameHeader!.querySelector("button")!.click());
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(nameHeader!.getAttribute("aria-sort")).toBe("ascending");
    act(() => nameHeader!.querySelector("button")!.click());
    expect(names()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(nameHeader!.getAttribute("aria-sort")).toBe("descending");

    // Numbers sort as numbers, not text.
    act(() => countHeader!.querySelector("button")!.click());
    expect(names()).toEqual(["Bravo", "Charlie", "Alpha"]);
    expect(nameHeader!.getAttribute("aria-sort")).toBe("none");
  });

  it("says so when there is nothing to show", async () => {
    mount(<DataTable caption="Empty" columns={columns} rows={[]} rowKey={(row) => (row as { id: string }).id} emptyMessage="No advertisers yet." />);
    expect(document.querySelector("tbody")?.textContent).toBe("No advertisers yet.");
    expect(await violations()).toEqual([]);
  });
});

describe("CommandPalette", () => {
  const run = vi.fn();
  const commands = [
    { id: "a", label: "Go to advertisers", keywords: ["crm"], run: () => run("a") },
    { id: "b", label: "Go to finance", run: () => run("b") },
    { id: "c", label: "Open audit log", hint: "Admin", run: () => run("c") }
  ];
  const input = () => document.querySelector<HTMLInputElement>("[role=combobox]")!;
  const type = (value: string) => act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });

  it("filters by every word in the label or keywords", () => {
    expect(filterCommands(commands, "go fin").map((command) => command.id)).toEqual(["b"]);
    expect(filterCommands(commands, "crm").map((command) => command.id)).toEqual(["a"]);
    expect(filterCommands(commands, "  ").length).toBe(3);
  });

  it("opens with Ctrl+K, follows the combobox pattern, runs with Enter and returns focus on Escape", async () => {
    run.mockClear();
    mount(<><button id="before">Before</button><CommandPalette commands={commands} /></>);
    document.getElementById("before")!.focus();
    expect(document.querySelector("[role=dialog]")).toBeNull();

    key(document, { key: "k", ctrlKey: true });
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute("aria-controls")).toBe(document.querySelector("[role=listbox]")!.id);
    expect(await violations()).toEqual([]);

    const options = () => [...document.querySelectorAll("[role=option]")];
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0]!.id);
    key(input(), { key: "ArrowDown" });
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    key(input(), { key: "ArrowUp" });
    key(input(), { key: "ArrowUp" });
    expect(options()[2]!.getAttribute("aria-selected")).toBe("true");

    type("fin");
    expect(options().map((option) => option.textContent)).toEqual(["Go to finance"]);
    key(input(), { key: "Enter" });
    expect(run).toHaveBeenCalledWith("b");
    expect(document.querySelector("[role=dialog]")).toBeNull();

    key(document, { key: "k", metaKey: true });
    key(input(), { key: "Escape" });
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(document.getElementById("before"));
  });

  it("says when nothing matches and runs nothing on Enter", () => {
    run.mockClear();
    mount(<CommandPalette commands={commands} />);
    key(document, { key: "k", ctrlKey: true });
    type("zzz");
    expect(document.querySelector("[role=status]")?.textContent).toBe("No commands match.");
    key(input(), { key: "Enter" });
    expect(run).not.toHaveBeenCalled();
  });
});
