import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Route } from "next";
import { readPublicCommercialDiscovery, territoryFromSlug } from "../../../../lib/public-runtime";

type PageProps = {
  params: Promise<{ territorySlug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const territory = territoryFromSlug((await params).territorySlug);

  return {
    title: territory ? `Local Businesses in ${territory.name} | Raring2go!` : "Local Businesses | Raring2go!",
    description: territory
      ? `Family-friendly local businesses around ${territory.name}.`
      : "Family-friendly local businesses from Raring2go!"
  };
}

export default async function BusinessesPage({ params }: PageProps) {
  const discovery = await readPublicCommercialDiscovery((await params).territorySlug, "businesses");

  if (!discovery) {
    notFound();
  }

  return (
    <main className="public-site public-season-autumn">
      <header className="public-nav">
        <Link href={`/areas/${discovery.territory.slug}` as Route} className="public-logo">Raring2go!</Link>
        <nav aria-label="Public navigation">
          <Link href={`/areas/${discovery.territory.slug}/whats-on` as Route}>What&apos;s On</Link>
          <Link href={`/areas/${discovery.territory.slug}/activities` as Route}>Activities</Link>
          <Link href={`/areas/${discovery.territory.slug}/offers` as Route}>Offers</Link>
          <Link href={`/areas/${discovery.territory.slug}/competitions` as Route}>Competitions</Link>
          <Link href={`/areas/${discovery.territory.slug}/businesses` as Route}>Businesses</Link>
        </nav>
      </header>
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">Raring2go! {discovery.territory.name}</p>
          <h1>{discovery.heading}</h1>
          <p>Active advertiser records presented as public local business cards, without leaking private CRM details.</p>
        </div>
      </section>
      <section className="public-section">
        <div className="public-section-heading">
          <p className="public-kicker">Local businesses</p>
          <h2>{discovery.placements.length} active public records</h2>
        </div>
        <div className="public-card-grid">
          {discovery.emptyState ? <p className="public-empty">{discovery.emptyState}</p> : null}
          {discovery.placements.map((placement) => (
            <Link key={placement.id} href={placement.href as Route} className="public-card public-sponsored">
              <span>{placement.label}</span>
              <h3>{placement.title}</h3>
              <p>{placement.summary}</p>
              <small>{placement.tags?.join(", ") || "Family-friendly"}</small>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
