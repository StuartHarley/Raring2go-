"use client";

import { useState } from "react";

/**
 * Below the existing 760px breakpoint where .app-shell collapses to one
 * column, the full ~20-link nav would otherwise render inline above the
 * page content every time - this hides it behind a toggle on narrow
 * screens only (the toggle button itself is display:none above 760px,
 * so desktop is completely unaffected).
 */
export function MobileSidebarToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="app-nav-toggle"
        aria-expanded={open}
        aria-controls="app-sidebar-nav"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "✕ Close menu" : "☰ Menu"}
      </button>
      <div id="app-sidebar-nav" className="app-sidebar-content" data-open={open}>
        {children}
      </div>
    </>
  );
}
