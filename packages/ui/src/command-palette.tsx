"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type Command = { id: string; label: string; hint?: string; keywords?: string[]; run: () => void };

/** Case-insensitive match on the label and keywords; every word typed must appear somewhere. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  return commands.filter((command) => {
    const haystack = [command.label, ...(command.keywords ?? [])].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * Quick navigation and actions. Opens with Ctrl/Cmd+K. Follows the combobox + listbox pattern: the input keeps
 * focus, Arrow keys move the active option (announced through `aria-activedescendant`), Enter runs it, Escape
 * closes and returns focus. Commands are supplied by the caller from what the actor may do; the palette never
 * widens access, it only runs what it is given.
 */
export function CommandPalette({ commands, label = "Search commands" }: { commands: Command[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        opener.current = document.activeElement;
        setOpen((current) => !current);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
    else {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  function close() {
    setOpen(false);
    if (opener.current instanceof HTMLElement) opener.current.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (results.length === 0 ? 0 : (current - 1 + results.length) % results.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = results[active];
      if (command) {
        close();
        command.run();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  if (!open) return null;
  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <div className="r2-overlay r2-overlay--modal" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label={label} className="r2-overlay__panel r2-palette">
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          placeholder="Type a command"
        />
        <ul id={listId} role="listbox" aria-label="Commands">
          {results.map((command, index) => (
            <li
              key={command.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => { event.preventDefault(); close(); command.run(); }}
            >
              <span>{command.label}</span>
              {command.hint ? <small>{command.hint}</small> : null}
            </li>
          ))}
        </ul>
        {results.length === 0 ? <p role="status">No commands match.</p> : null}
      </div>
    </div>
  );
}
