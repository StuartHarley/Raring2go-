"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * A native `<details>` menu that also closes when the person clicks elsewhere or presses Escape.
 * Everything inside is ordinary server-rendered markup (links and forms), so the menu works
 * before hydration and needs no JavaScript to open; the client only adds the closing behaviour.
 */
export function Disclosure({
  summary,
  summaryClassName,
  className,
  label,
  children
}: {
  summary: ReactNode;
  summaryClassName?: string;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    function onPointerDown(event: PointerEvent) {
      if (node && node.open && event.target instanceof Node && !node.contains(event.target)) {
        node.open = false;
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && node && node.open) {
        node.open = false;
        node.querySelector<HTMLElement>("summary")?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <details ref={ref} className={["app-menu", className].filter(Boolean).join(" ")}>
      <summary className={summaryClassName} aria-label={label}>
        {summary}
      </summary>
      <div className="app-menu__panel">{children}</div>
    </details>
  );
}
