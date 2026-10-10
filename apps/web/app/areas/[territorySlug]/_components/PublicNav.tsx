import Link from "next/link";
import type { Route } from "next";

const SECTIONS: Array<{ segment: string; label: string }> = [
  { segment: "whats-on", label: "What's On" },
  { segment: "activities", label: "Activities" },
  { segment: "offers", label: "Offers" },
  { segment: "competitions", label: "Competitions" },
  { segment: "businesses", label: "Businesses" },
  { segment: "for-you", label: "For You" },
  { segment: "magazine", label: "Magazine" },
  { segment: "saved", label: "Saved" }
];

/**
 * The parent-facing header: wordmark plus the section links. On a phone the links become one
 * scrollable row rather than wrapping into three lines, so the hero stays near the top.
 */
export function PublicNav({ slug, current }: { slug: string; current?: string }) {
  return (
    <header className="public-nav">
      <Link href={`/areas/${slug}` as Route} className="public-logo">
        Raring2go!
      </Link>
      <nav aria-label="Sections">
        {SECTIONS.map((section) => (
          <Link key={section.segment} href={`/areas/${slug}/${section.segment}` as Route} aria-current={section.segment === current ? "page" : undefined}>
            {section.label}
          </Link>
        ))}
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
