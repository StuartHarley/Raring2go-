"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";

type Result = { status: "saved" | "refused"; warnings: number };

/**
 * Wraps the page form and saves a second and a half after the editor stops typing. The buttons inside still submit the
 * form normally (with or without script), so autosave is a convenience, never the only way to save.
 */
export function AutosaveForm({ autosave, children, disabled }: { autosave: (formData: FormData) => Promise<Result>; children: ReactNode; disabled?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<{ text: string; failed: boolean }>({ text: "", failed: false });
  const [, startTransition] = useTransition();

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function schedule() {
    if (disabled) return;
    if (timer.current) clearTimeout(timer.current);
    setState({ text: "Unsaved changes", failed: false });
    timer.current = setTimeout(() => {
      if (!form.current) return;
      const data = new FormData(form.current);
      setState({ text: "Saving...", failed: false });
      startTransition(async () => {
        try {
          const result = await autosave(data);
          if (result.status === "saved") setState({ text: `Saved ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}${result.warnings ? ` - ${result.warnings} warning(s), reload to see them` : ""}`, failed: false });
          else setState({ text: "Could not autosave. Use Save to see why.", failed: true });
        } catch {
          setState({ text: "Could not autosave. Check your connection and use Save.", failed: true });
        }
      });
    }, 1500);
  }

  return (
    <form ref={form} onChange={schedule} onInput={schedule} className="franchise-form">
      {children}
      <p role="status" aria-live="polite" className={state.failed ? "muted error" : "muted"}>{state.text}</p>
    </form>
  );
}
