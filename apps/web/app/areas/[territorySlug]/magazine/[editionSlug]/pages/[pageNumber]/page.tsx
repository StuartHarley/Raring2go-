import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";
import { readPublicMagazinePage } from "../../../../../../../lib/public-runtime";
import { PublicNav, siteUrl } from "../../../../_components/PublicNav";
import { Track } from "../../../../_components/Track";

type PageProps = { params: Promise<{ territorySlug: string; editionSlug: string; pageNumber: string }> };

function parsePageNumber(value: string) {
  return /^[1-9]\d{0,3}$/.test(value) ? Number(value) : undefined;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { territorySlug, editionSlug, pageNumber } = await params;
  const number = parsePageNumber(pageNumber);
  const view = number ? await readPublicMagazinePage(territorySlug, editionSlug, number) : undefined;
  if (!view) return { title: "Not found | Raring2go!", robots: { index: false } };

  return {
    title: `${view.page.title} | ${view.edition.title}`,
    alternates: { canonical: `${siteUrl()}/areas/${view.territory.slug}/magazine/${view.edition.slug}/pages/${view.page.pageNumber}` }
  };
}

export default async function MagazinePageView({ params }: PageProps) {
  const { territorySlug, editionSlug, pageNumber } = await params;
  const number = parsePageNumber(pageNumber);
  const view = number ? await readPublicMagazinePage(territorySlug, editionSlug, number) : undefined;
  if (!view) notFound();

  const base = `/areas/${view.territory.slug}/magazine/${view.edition.slug}`;

  return (
    <main className="public-site public-season-autumn">
      <Track eventType="magazine_opened" territorySlug={view.territory.slug} path={`${base}/pages/${view.page.pageNumber}`} entityType="edition" />
      <PublicNav slug={view.territory.slug} />
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">
            <Link href={base as Route}>{view.edition.title}</Link> · Page {view.page.pageNumber} of {view.edition.pageCount}
          </p>
          <h1>{view.page.title}</h1>
        </div>
      </section>
      <section className="public-section">
        {view.content ? (
          <Link href={view.content.href as Route} className="public-card">
            <span>{view.content.type}</span>
            <h3>{view.content.title}</h3>
            <p>{view.content.summary}</p>
          </Link>
        ) : (
          <p className="public-empty">This page is advertising or layout and has no article online.</p>
        )}
        <nav aria-label="Magazine pages">
          {view.previous ? <Link href={`${base}/pages/${view.previous.pageNumber}` as Route}>Previous: {view.previous.title}</Link> : null}
          {view.previous && view.next ? " · " : null}
          {view.next ? <Link href={`${base}/pages/${view.next.pageNumber}` as Route}>Next: {view.next.title}</Link> : null}
        </nav>
      </section>
    </main>
  );
}
