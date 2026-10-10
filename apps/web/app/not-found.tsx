import Link from "next/link";
import type { Metadata } from "next";
import { BrandMark } from "./(app)/BrandMark";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="app-outcome app-outcome-not-found">
      <section>
        <BrandMark />
        <p className="eyebrow">Page not found</p>
        <h1>We can&apos;t find that page</h1>
        <p>The link may be out of date, or the record it pointed to may have moved.</p>
        <div className="app-outcome__actions">
          <Link href="/app" className="r2-button r2-button--primary">
            Go to My Today
          </Link>
          <Link href="/app/search" className="r2-button r2-button--secondary">
            Search records
          </Link>
          <Link href="/" className="r2-button r2-button--quiet">
            Raring2go! home
          </Link>
        </div>
      </section>
    </main>
  );
}
