import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";
import { readPublicMagazine, territoryFromSlug } from "../../../../lib/public-runtime";
import { PublicNav } from "../_components/PublicNav";
import { formatCount } from "../../../../lib/format";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);

  return {
    title: { absolute: territory ? `Digital Magazine | Raring2go! ${territory.name}` : "Digital Magazine | Raring2go!" },
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
      <PublicNav slug={magazine.territory.slug} current="magazine" />
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
          <h2>{magazine.edition ? `${formatCount(magazine.edition.pageCount, "page")} to read` : "No edition online yet"}</h2>
        </div>
        {magazine.edition ? (
          <div className="public-magazine-shell">
            <article>
              <span>Digital edition</span>
              <h3><Link href={`/areas/${magazine.territory.slug}/magazine/${magazine.edition.slug}` as Route}>{magazine.edition.title}</Link></h3>
              <p>
                Read the latest edition online and jump straight to the pages you want.
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
