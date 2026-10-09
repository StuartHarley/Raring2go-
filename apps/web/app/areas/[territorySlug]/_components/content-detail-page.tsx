import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";
import type { PublicContentSection } from "@raring2go/public";
import { readPublicContentDetail } from "../../../../lib/public-runtime";
import { toggleSavedContentAction } from "../preferences/actions";
import { JsonLd, PublicNav, siteUrl } from "./PublicNav";
import { Track } from "./Track";

type Params = { territorySlug: string; itemSlug: string };
type PageProps = { params: Promise<Params> };

const sectionLabels: Record<PublicContentSection, string> = {
  "whats-on": "What's On",
  activities: "Activities",
  offers: "Offers",
  competitions: "Competitions"
};

/** One page implementation for every content section; each route file binds its own section. */
export function contentDetailPage(section: PublicContentSection) {
  async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { territorySlug, itemSlug } = await params;
    const detail = await readPublicContentDetail(territorySlug, section, itemSlug, siteUrl());
    if (!detail) return { title: "Not found | Raring2go!", robots: { index: false } };

    return {
      title: detail.seoTitle,
      description: detail.item.summary,
      alternates: { canonical: `${siteUrl()}${detail.canonicalPath}` },
      // A page with no real body is reachable but not offered to search engines.
      robots: detail.indexable ? undefined : { index: false, follow: true }
    };
  }

  async function ContentDetailPage({ params }: PageProps) {
    const { territorySlug, itemSlug } = await params;
    const detail = await readPublicContentDetail(territorySlug, section, itemSlug, siteUrl());
    if (!detail) notFound();

    const { item, territory } = detail;
    const sponsored = section === "offers" || section === "competitions";

    return (
      <main className="public-site public-season-autumn">
        <JsonLd data={detail.structuredData} />
        <Track eventType="content_viewed" territorySlug={territory.slug} path={detail.canonicalPath} entityType="content" entityId={item.id} />
        <PublicNav slug={territory.slug} />
        <article>
          <section className="public-hero public-hero-compact">
            <div>
              <p className="public-kicker">
                <Link href={`/areas/${territory.slug}/${section}` as Route}>{sectionLabels[section]}</Link>
                {sponsored ? " · Sponsored" : ""}
              </p>
              <h1>{detail.headline}</h1>
              <p>{item.summary}</p>
              {item.startDate || item.location ? (
                <p>
                  {item.startDate ? <time dateTime={item.startDate}>{item.startDate}</time> : null}
                  {item.startDate && item.location ? " · " : ""}
                  {item.location}
                </p>
              ) : null}
              <form action={toggleSavedContentAction.bind(null, territory.slug, item.id, true, detail.canonicalPath)}>
                <button type="submit" className="public-button">Save for later</button>
              </form>
            </div>
          </section>
          <section className="public-section">
            {detail.body.length > 0 ? (
              detail.body.map((paragraph, index) => <p key={index}>{paragraph}</p>)
            ) : (
              <p className="public-empty">More details will appear here soon.</p>
            )}
          </section>
        </article>
        {detail.related.length > 0 ? (
          <section className="public-section">
            <div className="public-section-heading">
              <p className="public-kicker">More like this</p>
              <h2>You might also like</h2>
            </div>
            <div className="public-card-grid">
              {detail.related.map((related) => (
                <Link key={related.id} href={related.href as Route} className="public-card">
                  <span>{related.type}</span>
                  <h3>{related.title}</h3>
                  <p>{related.summary}</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    );
  }

  return { generateMetadata, ContentDetailPage };
}
