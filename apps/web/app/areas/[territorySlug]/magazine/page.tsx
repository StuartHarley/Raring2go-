import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";
import { readPublicMagazine, territoryFromSlug } from "../../../../lib/public-runtime";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);

  return {
    title: territory ? `Digital Magazine | Raring2go! ${territory.name}` : "Digital Magazine | Raring2go!",
    description: territory
      ? `Read the published Raring2go digital magazine for ${territory.name}.`
      : "Read published Raring2go digital magazines."
  };
}

export default async function PublicMagazinePage({ params }: PageProps) {
  const magazine = await readPublicMagazine((await params).territorySlug);

  if (!magazine) {
    notFound();
  }

  return (
    <main className="public-site public-season-autumn">
      <header className="public-nav">
        <Link href={`/areas/${magazine.territory.slug}` as Route} className="public-logo">Raring2go!</Link>
        <nav aria-label="Public navigation">
          <Link href={`/areas/${magazine.territory.slug}/whats-on` as Route}>What&apos;s On</Link>
          <Link href={`/areas/${magazine.territory.slug}/activities` as Route}>Activities</Link>
          <Link href={`/areas/${magazine.territory.slug}/offers` as Route}>Offers</Link>
          <Link href={`/areas/${magazine.territory.slug}/magazine` as Route}>Magazine</Link>
        </nav>
      </header>
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">Digital magazine</p>
          <h1>{magazine.edition?.title ?? "The next local magazine is being prepared"}</h1>
          <p>
            {magazine.edition
              ? `Published for ${magazine.territory.name}. Issue date ${magazine.edition.issueDate ?? "to be confirmed"}.`
              : magazine.emptyState}
          </p>
        </div>
      </section>
      <section className="public-section">
        <div className="public-section-heading">
          <p className="public-kicker">Magazine reader</p>
          <h2>{magazine.edition ? `${magazine.edition.pageCount} page edition` : "No public edition yet"}</h2>
        </div>
        {magazine.edition ? (
          <div className="public-magazine-shell">
            <article>
              <span>Generated digital output · v{magazine.edition.outputVersion}</span>
              <h3>{magazine.edition.title}</h3>
              <p>
                Browse the latest published local edition and jump into page highlights as they become available online.
              </p>
            </article>
            <div className="public-card-grid">
              {magazine.edition.pages.length === 0 ? (
                <p className="public-empty">Published page thumbnails will appear here when page output is available.</p>
              ) : magazine.edition.pages.map((page) => (
                <Link key={page.pageNumber} href={page.href as Route} className="public-card">
                  <span>Page {page.pageNumber}</span>
                  <h3>{page.title}</h3>
                  <p>{page.status}</p>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <p className="public-empty">{magazine.emptyState}</p>
        )}
      </section>
    </main>
  );
}
