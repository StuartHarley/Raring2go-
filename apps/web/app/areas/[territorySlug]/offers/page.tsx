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
    title: territory ? `Offers in ${territory.name} | Raring2go!` : "Offers | Raring2go!",
    description: territory
      ? `Family offers and sponsored local recommendations around ${territory.name}.`
      : "Family offers and sponsored local recommendations from Raring2go!"
  };
}

export default async function OffersPage({ params }: PageProps) {
  const discovery = await readPublicCommercialDiscovery((await params).territorySlug, "offers");

  if (!discovery) {
    notFound();
  }

  return (
    <main className="public-site public-season-autumn">
      <CommercialHeader slug={discovery.territory.slug} />
      <section className="public-hero public-hero-compact">
        <div>
          <p className="public-kicker">Raring2go! {discovery.territory.name}</p>
          <h1>{discovery.heading}</h1>
          <p>Approved local offers and sponsored family recommendations, clearly labelled and scoped to this area.</p>
        </div>
      </section>
      <CommercialGrid discovery={discovery} />
    </main>
  );
}

function CommercialHeader({ slug }: { slug: string }) {
  return (
    <header className="public-nav">
      <Link href={`/areas/${slug}` as Route} className="public-logo">Raring2go!</Link>
      <nav aria-label="Public navigation">
        <Link href={`/areas/${slug}/whats-on` as Route}>What&apos;s On</Link>
        <Link href={`/areas/${slug}/activities` as Route}>Activities</Link>
        <Link href={`/areas/${slug}/offers` as Route}>Offers</Link>
        <Link href={`/areas/${slug}/competitions` as Route}>Competitions</Link>
        <Link href={`/areas/${slug}/businesses` as Route}>Businesses</Link>
      </nav>
    </header>
  );
}

function CommercialGrid({
  discovery
}: {
  discovery: NonNullable<Awaited<ReturnType<typeof readPublicCommercialDiscovery>>>;
}) {
  return (
    <section className="public-section">
      <div className="public-section-heading">
        <p className="public-kicker">Commercial discovery</p>
        <h2>{discovery.items.length + discovery.placements.length} public placements</h2>
      </div>
      <div className="public-card-grid">
        {discovery.emptyState ? <p className="public-empty">{discovery.emptyState}</p> : null}
        {discovery.items.map((item) => (
          <Link key={item.id} href={item.href as Route} className="public-card public-sponsored">
            <span>Sponsored {item.type}</span>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
          </Link>
        ))}
        {discovery.placements.map((placement) => (
          <Link key={placement.id} href={placement.href as Route} className="public-card public-sponsored">
            <span>{placement.label}</span>
            <h3>{placement.title}</h3>
            <p>{placement.summary}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
