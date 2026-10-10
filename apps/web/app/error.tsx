"use client";

import Link from "next/link";
import { useEffect } from "react";
import { BrandMark } from "./(app)/BrandMark";

/**
 * The branded fallback when a page throws. The error itself is logged for the server; the person
 * only sees that something went wrong and how to carry on, never the stack or message.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="app-outcome app-outcome-error">
      <section>
        <BrandMark />
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
      </section>
    </main>
  );
}
