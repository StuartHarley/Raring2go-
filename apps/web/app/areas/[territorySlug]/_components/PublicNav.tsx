import Link from "next/link";
import type { Route } from "next";

export function PublicNav({ slug }: { slug: string }) {
  return (
    <header className="public-nav">
      <Link href={`/areas/${slug}` as Route} className="public-logo">Raring2go!</Link>
      <nav aria-label="Public navigation">
        <Link href={`/areas/${slug}/whats-on` as Route}>What&apos;s On</Link>
        <Link href={`/areas/${slug}/activities` as Route}>Activities</Link>
        <Link href={`/areas/${slug}/offers` as Route}>Offers</Link>
        <Link href={`/areas/${slug}/competitions` as Route}>Competitions</Link>
        <Link href={`/areas/${slug}/businesses` as Route}>Businesses</Link>
        <Link href={`/areas/${slug}/magazine` as Route}>Magazine</Link>
        <Link href={`/areas/${slug}/saved` as Route}>Saved</Link>
      </nav>
    </header>
  );
}

/** Structured data goes out only for records the page itself proved are public. */
export function JsonLd({ data }: { data: Record<string, unknown> | undefined }) {
  if (!data) return null;
  // "<" is escaped so no field value can close the script element.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll("<", "\\u003c") }} />;
}

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
