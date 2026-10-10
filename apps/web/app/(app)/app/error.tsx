"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * A page failed inside the shell: the navigation and top bar from the layout stay, and the
 * content area explains what to do. The error is logged for the server; nobody sees a stack.
 */
export default function AppErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="app-panel app-panel--outcome">
      <div className="app-outcome__panel">
        <p className="eyebrow">Something went wrong</p>
        <h1>We couldn&apos;t load this page</h1>
        <p>
          Nothing you entered has been lost. Try again in a moment, or go back to My Today.
          {error.digest ? ` If it keeps happening, quote reference ${error.digest} to support.` : ""}
        </p>
        <div className="app-outcome__actions">
          <button type="button" className="r2-button r2-button--primary" onClick={() => reset()}>
            Try again
          </button>
          <Link href="/app" className="r2-button r2-button--secondary">
            Go to My Today
          </Link>
        </div>
      </div>
    </section>
  );
}
