import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";
import type { PublicContentSection } from "@raring2go/public";
import { cookies } from "next/headers";
import { sessionCookieName } from "../../../../lib/auth-runtime";
import { competitionState, hasEnteredCompetition } from "../../../../lib/competition-runtime";
import { enterCompetitionAction } from "../competitions/actions";
import { readPublicContentDetail } from "../../../../lib/public-runtime";
import { toggleSavedContentAction } from "../preferences/actions";
import { JsonLd, PublicNav, siteUrl } from "./PublicNav";
import { Track } from "./Track";

type Params = { territorySlug: string; itemSlug: string };
type PageProps = { params: Promise<Params>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

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
    if (!detail) return { title: { absolute: "Not found | Raring2go!" }, robots: { index: false } };

    return {
      title: { absolute: detail.seoTitle },
      description: detail.item.summary,
      alternates: { canonical: `${siteUrl()}${detail.canonicalPath}` },
      // A page with no real body is reachable but not offered to search engines.
      robots: detail.indexable ? undefined : { index: false, follow: true }
    };
  }

  async function ContentDetailPage({ params, searchParams }: PageProps) {
    const { territorySlug, itemSlug } = await params;
    const query = (await searchParams) ?? {};
    const entryResult = Array.isArray(query.entry) ? query.entry[0] : query.entry;
    const detail = await readPublicContentDetail(territorySlug, section, itemSlug, siteUrl());
    if (!detail) notFound();

    const { item, territory } = detail;
    const sponsored = section === "offers" || section === "competitions";
    const competition = section === "competitions"
      ? { state: competitionState(item.endDate ? item.endDate.slice(0, 10) : null), entered: await hasEnteredCompetition((await cookies()).get(sessionCookieName)?.value, item.id) }
      : null;

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
              {competition ? (
                <div id="enter" aria-label="Enter this competition">
                  {entryResult === "entered" ? <p role="status">You are in. Good luck!</p> : null}
                  {entryResult === "already" ? <p role="status">You have already entered this competition.</p> : null}
                  {entryResult === "closed" ? <p role="alert">Sorry, this competition is not open for entries.</p> : null}
                  {competition.entered ? (
                    <p>You have entered this competition.</p>
                  ) : competition.state === "open" ? (
                    <form action={enterCompetitionAction.bind(null, territory.slug, item.id, `${detail.canonicalPath}#enter`)}>
                      <button type="submit" className="public-button">Enter this competition</button>
                      <p><small>You need to be signed in. We keep your entry until the draw and for 90 days after, then delete it. Entering does not sign you up to emails.</small></p>
                    </form>
                  ) : (
                    <p>{competition.state === "closed" ? "This competition has closed." : "Entries are not open yet."}</p>
                  )}
                </div>
              ) : null}
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
