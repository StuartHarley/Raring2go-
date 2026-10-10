import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";
import { readPublicMagazineEdition } from "../../../../../lib/public-runtime";
import { PublicNav, siteUrl } from "../../_components/PublicNav";
import { Track } from "../../_components/Track";

type PageProps = { params: Promise<{ territorySlug: string; editionSlug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { territorySlug, editionSlug } = await params;
  const view = await readPublicMagazineEdition(territorySlug, editionSlug);
  if (!view) return { title: { absolute: "Not found | Raring2go!" }, robots: { index: false } };

  return {
    title: { absolute: `${view.edition.title} | Raring2go! ${view.territory.name}` },
    description: `Read ${view.edition.title}, the Raring2go digital magazine for ${view.territory.name}.`,
    alternates: { canonical: `${siteUrl()}/areas/${view.territory.slug}/magazine/${view.edition.slug}` }
  };
}

export default async function MagazineEditionPage({ params }: PageProps) {
  const { territorySlug, editionSlug } = await params;
  const view = await readPublicMagazineEdition(territorySlug, editionSlug);
  if (!view) notFound();

  const { territory, edition } = view;

  return (
    <main className="public-site public-season-autumn">
      <Track eventType="magazine_opened" territorySlug={territory.slug} path={`/areas/${territory.slug}/magazine/${edition.slug}`} entityType="edition" entityId={edition.id} />
      <PublicNav slug={territory.slug} />
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">Digital magazine</p>
          <h1>{edition.title}</h1>
          <p>
            Published for {territory.name}. Issue date {edition.issueDate ?? "to be confirmed"}.
          </p>
        </div>
      </section>
      <section className="public-section">
        <div className="public-section-heading">
          <p className="public-kicker">Pages</p>
          <h2>{edition.pages.length} published {edition.pages.length === 1 ? "page" : "pages"}</h2>
        </div>
        <div className="public-card-grid">
          {edition.pages.length === 0 ? <p className="public-empty">Published pages will appear here when they are available online.</p> : null}
          {edition.pages.map((page) => (
            <Link key={page.pageNumber} href={page.href as Route} className="public-card">
              <span>Page {page.pageNumber}</span>
              <h3>{page.title}</h3>
            </Link>
          ))}
        </div>
      </section>
      {view.otherEditions.length > 0 ? (
        <section className="public-section">
          <div className="public-section-heading">
            <p className="public-kicker">Back issues</p>
            <h2>Other editions</h2>
          </div>
          <div className="public-card-grid">
            {view.otherEditions.map((other) => (
              <Link key={other.slug} href={`/areas/${territory.slug}/magazine/${other.slug}` as Route} className="public-card">
                <span>{other.issueDate ?? "Edition"}</span>
                <h3>{other.title}</h3>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
