"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type OverlayProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Optional footer, usually the confirm and cancel buttons. */
  footer?: ReactNode;
};

/**
 * Shared behaviour for modal and drawer: a labelled dialog that moves focus in when it opens, keeps Tab inside
 * it, closes on Escape or a click on the backdrop, and returns focus to whatever opened it. Content behind it is
 * not reachable while it is open (aria-modal plus the focus trap).
 */
function Overlay({ open, onClose, title, children, footer, variant }: OverlayProps & { variant: "modal" | "drawer" }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const firstElement = focusable[0]!;
    const lastElement = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  return (
    <div className={`r2-overlay r2-overlay--${variant}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="r2-overlay__panel" onKeyDown={onKeyDown}>
        <header className="r2-overlay__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="r2-overlay__close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="r2-overlay__body">{children}</div>
        {footer ? <footer className="r2-overlay__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Modal(props: OverlayProps) {
  return <Overlay {...props} variant="modal" />;
}

export function Drawer(props: OverlayProps) {
  return <Overlay {...props} variant="drawer" />;
}
